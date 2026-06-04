import fs from "fs";
import path from "path";
import { parse, stringify } from "yaml";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { trackedRepos, trackedPackages } from "../db/schema";
import { validatePackageName } from "../validation/package-name";
import { DECAY_HALF_LIFE_DAYS, DECAY_MAX_AGE_DAYS, MIN_AGGREGATE_SCORE } from "../decay";

/**
 * THE owner of gtm-config.yaml. The YAML file is the source of truth; the
 * tracked_repos / tracked_packages tables are a projection of it
 * (one-directional: YAML → database, via syncToDatabase). Writes are
 * YAML-first — the projection only runs after a successful file write, so a
 * failed write leaves the database untouched. No other module may read or
 * write the file or parse its YAML.
 *
 * validatePackageName lives in src/lib/validation/ (client components import
 * it for instant form feedback); THIS module is the enforcement point — it is
 * applied on every add and on every parse.
 */

const YAML_HEADER = "# ar.io Growth Tracker Configuration\n\n";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const trackedRepoConfigSchema = z.object({
  owner: z.string().min(1),
  name: z.string().min(1),
  display_name: z.string().optional(),
  competitor: z.string().min(1).optional(),
});

const trackedPackageConfigSchema = z.object({
  name: z.string().min(1),
  display_name: z.string().optional(),
  github_repo: z
    .string()
    .regex(/^[^\s/]+\/[^\s/]+$/, 'must be "owner/name"')
    .optional(),
  competitor: z.string().min(1).optional(),
});

const competitorDomainsSchema = z.object({
  domains: z.array(z.string().min(1)).default([]),
});

/** Recency-scoring knobs (PRD #34) — all three operator-tunable from the
 *  Settings Scoring card. Cross-field rule keeps the event cutoff meaningfully
 *  beyond the half-life. Absent block → the decay module's code defaults. */
const scoringConfigSchema = z
  .object({
    half_life_days: z.number().int().min(7, "half_life_days must be at least 7").default(90),
    max_age_days: z.number().int().default(360),
    min_aggregate_score: z
      .number()
      .min(0, "min_aggregate_score must be between 0 and 5")
      .max(5, "min_aggregate_score must be between 0 and 5")
      .default(1.0),
  })
  .refine((s) => s.max_age_days >= 2 * s.half_life_days, {
    message: "max_age_days must be at least 2× half_life_days",
    path: ["max_age_days"],
  });

export const gtmConfigSchema = z.object({
  github: z
    .object({ repos: z.array(trackedRepoConfigSchema).default([]) })
    .default({ repos: [] }),
  packages: z
    .object({
      npm: z.array(trackedPackageConfigSchema).default([]),
      pypi: z.array(trackedPackageConfigSchema).default([]),
    })
    .default({ npm: [], pypi: [] }),
  competitors: z.record(z.string().min(1), competitorDomainsSchema).optional(),
  scoring: scoringConfigSchema.optional(),
  collection: z.object({ npm_backfill_from: z.string().optional() }).optional(),
});

export type GtmConfig = z.infer<typeof gtmConfigSchema>;
export type TrackedRepoConfig = z.infer<typeof trackedRepoConfigSchema>;
export type TrackedPackageConfig = z.infer<typeof trackedPackageConfigSchema>;
export type ScoringConfig = z.infer<typeof scoringConfigSchema>;
export type PackageRegistry = "npm" | "pypi";

function defaultConfigPath(): string {
  return path.join(process.cwd(), "gtm-config.yaml");
}

export function readConfig(configPath = defaultConfigPath()): GtmConfig {
  if (!fs.existsSync(configPath)) {
    throw new ConfigError(`Config file not found: ${configPath}`);
  }
  let raw: unknown;
  try {
    raw = parse(fs.readFileSync(configPath, "utf-8"));
  } catch (err) {
    throw new ConfigError(
      `Invalid YAML in ${path.basename(configPath)}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  const result = gtmConfigSchema.safeParse(raw ?? {});
  if (!result.success) {
    const details = result.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new ConfigError(`Invalid config in ${path.basename(configPath)}: ${details}`);
  }
  const config = result.data;
  // Package-name validation on every parse — every entry path gets it.
  for (const registry of ["npm", "pypi"] as const) {
    for (const pkg of config.packages[registry]) {
      const invalid = validatePackageName(registry, pkg.name);
      if (invalid) {
        throw new ConfigError(
          `Invalid config in ${path.basename(configPath)}: packages.${registry} "${pkg.name}": ${invalid}`
        );
      }
    }
  }
  // Referential integrity: every competitors-block entry must be used by at
  // least one repo or package entry, so typos surface immediately instead of
  // silently disabling employee tagging. Entries without a block are fine —
  // tagging falls back to the org/commit signals.
  if (config.competitors) {
    const used = new Set<string>();
    for (const repo of config.github.repos) {
      if (repo.competitor) used.add(repo.competitor);
    }
    for (const registry of ["npm", "pypi"] as const) {
      for (const pkg of config.packages[registry]) {
        if (pkg.competitor) used.add(pkg.competitor);
      }
    }
    for (const name of Object.keys(config.competitors)) {
      if (!used.has(name)) {
        throw new ConfigError(
          `Invalid config in ${path.basename(configPath)}: competitors block declares "${name}" but no repo or package entry uses it`
        );
      }
    }
  }
  return config;
}

function writeConfig(config: GtmConfig, configPath: string): void {
  fs.writeFileSync(configPath, YAML_HEADER + stringify(config));
}

export function addRepo(repo: TrackedRepoConfig, configPath = defaultConfigPath()): void {
  const parsed = trackedRepoConfigSchema.safeParse(repo);
  if (!parsed.success) {
    throw new ConfigError(
      `Invalid repo: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`
    );
  }
  const config = readConfig(configPath);
  const existing = config.github.repos.find(
    (r) => r.owner === parsed.data.owner && r.name === parsed.data.name
  );
  if (existing) {
    existing.display_name = parsed.data.display_name ?? existing.display_name;
    existing.competitor = parsed.data.competitor ?? existing.competitor;
  } else {
    config.github.repos.push(parsed.data);
  }
  writeConfig(config, configPath); // YAML first
  syncToDatabase(configPath); // projection only after a successful write
}

export function addPackage(
  registry: PackageRegistry,
  pkg: TrackedPackageConfig,
  configPath = defaultConfigPath()
): void {
  const name = (pkg.name ?? "").trim();
  const invalid = validatePackageName(registry, name);
  if (invalid) throw new ConfigError(invalid);
  const parsed = trackedPackageConfigSchema.safeParse({ ...pkg, name });
  if (!parsed.success) {
    throw new ConfigError(
      `Invalid package: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`
    );
  }
  const config = readConfig(configPath);
  const list = config.packages[registry];
  const existing = list.find((p) => p.name === name);
  if (existing) {
    existing.display_name = parsed.data.display_name ?? existing.display_name;
    existing.github_repo = parsed.data.github_repo ?? existing.github_repo;
    existing.competitor = parsed.data.competitor ?? existing.competitor;
  } else {
    list.push(parsed.data);
  }
  writeConfig(config, configPath); // YAML first
  syncToDatabase(configPath); // projection only after a successful write
}

/** YAML-first update of the scoring block (no DB projection — the scoring
 *  step reads the file). Invalid knobs throw ConfigError before any write. */
export function updateScoring(
  scoring: Partial<ScoringConfig>,
  configPath = defaultConfigPath()
): void {
  const parsed = scoringConfigSchema.safeParse(scoring);
  if (!parsed.success) {
    throw new ConfigError(
      `Invalid scoring config: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`
    );
  }
  const config = readConfig(configPath);
  config.scoring = parsed.data;
  writeConfig(config, configPath);
}

/** The decay knobs the scoring step should use: the configured block when
 *  present, the decay module's code defaults otherwise (PRD #34: defaults
 *  produce identical behavior to the unconfigured engine). */
export function resolveScoringKnobs(scoring: ScoringConfig | undefined): {
  halfLifeDays: number;
  maxAgeDays: number;
  minAggregateScore: number;
} {
  return {
    halfLifeDays: scoring?.half_life_days ?? DECAY_HALF_LIFE_DAYS,
    maxAgeDays: scoring?.max_age_days ?? DECAY_MAX_AGE_DAYS,
    minAggregateScore: scoring?.min_aggregate_score ?? MIN_AGGREGATE_SCORE,
  };
}

/** Projects the YAML (source of truth) into tracked_repos / tracked_packages.
 *  Idempotent upserts; a missing file is skipped (fresh deployments), a
 *  malformed file throws ConfigError so the pipeline step records `failed`. */
export function syncToDatabase(configPath = defaultConfigPath()): void {
  if (!fs.existsSync(configPath)) {
    console.log("[config] No gtm-config.yaml found, skipping sync");
    return;
  }
  const config = readConfig(configPath);
  const db = getDb();

  for (const repo of config.github.repos) {
    db.insert(trackedRepos)
      .values({
        owner: repo.owner,
        name: repo.name,
        displayName: repo.display_name || null,
        competitor: repo.competitor || null,
      })
      .onConflictDoUpdate({
        target: [trackedRepos.owner, trackedRepos.name],
        set: {
          displayName: sql`excluded.display_name`,
          competitor: sql`excluded.competitor`,
        },
      })
      .run();
  }

  for (const registry of ["npm", "pypi"] as const) {
    for (const pkg of config.packages[registry]) {
      let repoId: number | null = null;
      if (pkg.github_repo) {
        const [owner, name] = pkg.github_repo.split("/");
        const repo = db
          .select()
          .from(trackedRepos)
          .where(sql`${trackedRepos.owner} = ${owner} AND ${trackedRepos.name} = ${name}`)
          .get();
        if (repo) repoId = repo.id;
      }
      db.insert(trackedPackages)
        .values({
          registry,
          name: pkg.name,
          displayName: pkg.display_name || null,
          repoId,
          competitor: pkg.competitor || null,
        })
        .onConflictDoUpdate({
          target: [trackedPackages.registry, trackedPackages.name],
          set: {
            displayName: sql`excluded.display_name`,
            repoId: repoId ? sql`${repoId}` : sql`repo_id`,
            competitor: sql`excluded.competitor`,
          },
        })
        .run();
    }
  }

  console.log(
    `[config] Synced ${config.github.repos.length} repos, ${config.packages.npm.length} npm + ${config.packages.pypi.length} pypi packages`
  );
}
