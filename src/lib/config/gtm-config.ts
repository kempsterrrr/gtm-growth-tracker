import fs from "fs";
import path from "path";
import { parse, stringify } from "yaml";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { trackedRepos, trackedPackages } from "../db/schema";
import { validatePackageName } from "../validation/package-name";

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
});

const trackedPackageConfigSchema = z.object({
  name: z.string().min(1),
  display_name: z.string().optional(),
  github_repo: z
    .string()
    .regex(/^[^\s/]+\/[^\s/]+$/, 'must be "owner/name"')
    .optional(),
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
  collection: z.object({ npm_backfill_from: z.string().optional() }).optional(),
});

export type GtmConfig = z.infer<typeof gtmConfigSchema>;
export type TrackedRepoConfig = z.infer<typeof trackedRepoConfigSchema>;
export type TrackedPackageConfig = z.infer<typeof trackedPackageConfigSchema>;
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
  } else {
    list.push(parsed.data);
  }
  writeConfig(config, configPath); // YAML first
  syncToDatabase(configPath); // projection only after a successful write
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
      .values({ owner: repo.owner, name: repo.name, displayName: repo.display_name || null })
      .onConflictDoUpdate({
        target: [trackedRepos.owner, trackedRepos.name],
        set: { displayName: sql`excluded.display_name` },
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
        .values({ registry, name: pkg.name, displayName: pkg.display_name || null, repoId })
        .onConflictDoUpdate({
          target: [trackedPackages.registry, trackedPackages.name],
          set: {
            displayName: sql`excluded.display_name`,
            repoId: repoId ? sql`${repoId}` : sql`repo_id`,
          },
        })
        .run();
    }
  }

  console.log(
    `[config] Synced ${config.github.repos.length} repos, ${config.packages.npm.length} npm + ${config.packages.pypi.length} pypi packages`
  );
}
