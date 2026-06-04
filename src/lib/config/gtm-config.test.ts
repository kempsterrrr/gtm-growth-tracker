import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, chmodSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import Database from "better-sqlite3";

const tmp = mkdtempSync(path.join(tmpdir(), "gtm-config-test-"));
process.env.DATABASE_PATH = path.join(tmp, "test.db");

const { runMigrations } = await import("../db/migrate");
const { readConfig, addRepo, addPackage, syncToDatabase, updateScoring, resolveScoringKnobs, ConfigError } =
  await import("./gtm-config");

runMigrations();
const sqlite = new Database(process.env.DATABASE_PATH!);

const VALID_YAML = `github:
  repos:
    - owner: ar-io
      name: ar-io-node
      display_name: AR.IO Node
packages:
  npm:
    - name: "@ardrive/turbo-sdk"
      display_name: Turbo SDK
  pypi:
    - name: turbo-sdk
collection:
  npm_backfill_from: "2024-01-01"
`;

let n = 0;
function freshConfig(): string {
  const p = path.join(tmp, `config-${n++}.yaml`);
  writeFileSync(p, VALID_YAML);
  return p;
}

const count = (table: string) =>
  (sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

describe("readConfig + round-trip", () => {
  it("parses a valid file and round-trips an added repo through YAML and DB", () => {
    const p = freshConfig();
    const config = readConfig(p);
    expect(config.github.repos[0]).toEqual({
      owner: "ar-io",
      name: "ar-io-node",
      display_name: "AR.IO Node",
    });
    expect(config.collection?.npm_backfill_from).toBe("2024-01-01");

    addRepo({ owner: "octo", name: "demo", display_name: "Demo" }, p);
    expect(readConfig(p).github.repos.map((r) => r.name)).toContain("demo");
    const row = sqlite
      .prepare("SELECT * FROM tracked_repos WHERE owner = 'octo' AND name = 'demo'")
      .get();
    expect(row).toBeTruthy();
  });
});

describe("malformed config", () => {
  it("rejects a wrong-shaped file with a message naming the path", () => {
    const p = path.join(tmp, "bad-shape.yaml");
    writeFileSync(p, "github:\n  repos: not-an-array\n");
    expect(() => readConfig(p)).toThrow(ConfigError);
    expect(() => readConfig(p)).toThrow(/github\.repos/);
  });

  it("rejects unparseable YAML with a useful message", () => {
    const p = path.join(tmp, "broken.yaml");
    writeFileSync(p, "github: [unclosed\n  - {{{\n");
    expect(() => readConfig(p)).toThrow(ConfigError);
    expect(() => readConfig(p)).toThrow(/YAML/i);
  });
});

describe("addPackage validation", () => {
  it("rejects invalid names for both registries and leaves YAML and DB untouched", () => {
    const p = freshConfig();
    const yamlBefore = readFileSync(p, "utf-8");
    const dbBefore = count("tracked_packages");

    expect(() => addPackage("npm", { name: "bad name!!" }, p)).toThrow(ConfigError);
    expect(() => addPackage("pypi", { name: "bad/name" }, p)).toThrow(ConfigError);

    expect(readFileSync(p, "utf-8")).toBe(yamlBefore);
    expect(count("tracked_packages")).toBe(dbBefore);
  });

  it("accepts a valid package and projects it to the DB", () => {
    const p = freshConfig();
    addPackage("npm", { name: "left-pad", display_name: "Left Pad" }, p);
    expect(readConfig(p).packages.npm.map((x) => x.name)).toContain("left-pad");
    const row = sqlite
      .prepare("SELECT * FROM tracked_packages WHERE registry = 'npm' AND name = 'left-pad'")
      .get();
    expect(row).toBeTruthy();
  });
});

describe("write-failure atomicity", () => {
  it("leaves the database unchanged when the YAML write fails", () => {
    const p = freshConfig();
    chmodSync(p, 0o444); // read-only: readConfig succeeds, write throws
    const reposBefore = count("tracked_repos");
    expect(() => addRepo({ owner: "ghost", name: "never" }, p)).toThrow();
    expect(count("tracked_repos")).toBe(reposBefore);
    expect(
      sqlite.prepare("SELECT * FROM tracked_repos WHERE owner = 'ghost'").get()
    ).toBeUndefined();
    chmodSync(p, 0o644);
  });
});

describe("syncToDatabase", () => {
  it("is idempotent across repeated runs", () => {
    const p = freshConfig();
    syncToDatabase(p);
    const repos1 = count("tracked_repos");
    const pkgs1 = count("tracked_packages");
    syncToDatabase(p);
    expect(count("tracked_repos")).toBe(repos1);
    expect(count("tracked_packages")).toBe(pkgs1);
    expect(
      sqlite
        .prepare("SELECT * FROM tracked_repos WHERE owner = 'ar-io' AND name = 'ar-io-node'")
        .get()
    ).toBeTruthy();
  });

  it("skips quietly when the file does not exist", () => {
    expect(() => syncToDatabase(path.join(tmp, "missing.yaml"))).not.toThrow();
  });
});

describe("competitor attribution (entry-level)", () => {
  it("round-trips competitor on repos and packages through YAML and DB projection", () => {
    const p = freshConfig();
    addRepo({ owner: "them", name: "their-repo", competitor: "Acme" }, p);
    addPackage("npm", { name: "acme-sdk", competitor: "Acme" }, p);

    const config = readConfig(p);
    expect(config.github.repos.find((r) => r.name === "their-repo")?.competitor).toBe("Acme");
    expect(config.packages.npm.find((x) => x.name === "acme-sdk")?.competitor).toBe("Acme");

    const repoRow = sqlite
      .prepare("SELECT competitor FROM tracked_repos WHERE owner = 'them' AND name = 'their-repo'")
      .get() as { competitor: string | null };
    expect(repoRow.competitor).toBe("Acme");
    const pkgRow = sqlite
      .prepare("SELECT competitor FROM tracked_packages WHERE registry = 'npm' AND name = 'acme-sdk'")
      .get() as { competitor: string | null };
    expect(pkgRow.competitor).toBe("Acme");
  });

  it("projects one-directionally: removing competitor from YAML nulls the DB column on re-sync", () => {
    const p = path.join(tmp, "one-directional.yaml");
    const withCompetitor = `github:
  repos:
    - owner: flip
      name: flop
      competitor: Acme
`;
    writeFileSync(p, withCompetitor);
    syncToDatabase(p);
    const before = sqlite
      .prepare("SELECT competitor FROM tracked_repos WHERE owner = 'flip' AND name = 'flop'")
      .get() as { competitor: string | null };
    expect(before.competitor).toBe("Acme");

    writeFileSync(p, withCompetitor.replace("      competitor: Acme\n", ""));
    syncToDatabase(p);
    const after = sqlite
      .prepare("SELECT competitor FROM tracked_repos WHERE owner = 'flip' AND name = 'flop'")
      .get() as { competitor: string | null };
    expect(after.competitor).toBeNull();
  });
});

describe("competitors block", () => {
  it("parses a block whose names are used by a repo or a package, defaulting domains", () => {
    const p = path.join(tmp, "block-used.yaml");
    writeFileSync(
      p,
      `github:
  repos:
    - owner: them
      name: their-repo
      competitor: Acme
packages:
  npm: []
  pypi:
    - name: rival-sdk
      competitor: Rival
competitors:
  Acme:
    domains:
      - acme.dev
      - acme.io
  Rival: {}
`
    );
    const config = readConfig(p);
    expect(config.competitors?.Acme?.domains).toEqual(["acme.dev", "acme.io"]);
    expect(config.competitors?.Rival?.domains).toEqual([]);
  });

  it("rejects a block entry referencing a name no entry uses, naming it", () => {
    const p = path.join(tmp, "block-orphan.yaml");
    writeFileSync(
      p,
      `github:
  repos:
    - owner: us
      name: our-repo
competitors:
  Ghost:
    domains:
      - ghost.io
`
    );
    expect(() => readConfig(p)).toThrow(ConfigError);
    expect(() => readConfig(p)).toThrow(/Ghost/);
  });

  it("rejects a scoring block violating field bounds or the cross-field rule, naming it", () => {
    const write = (scoring: string) => {
      const p = path.join(tmp, `scoring-bad-${n++}.yaml`);
      writeFileSync(p, `github:\n  repos: []\npackages:\n  npm: []\n  pypi: []\nscoring:\n${scoring}`);
      return p;
    };
    expect(() => readConfig(write("  half_life_days: 5\n"))).toThrow(/half_life_days/);
    expect(() => readConfig(write("  min_aggregate_score: 9\n"))).toThrow(/min_aggregate_score/);
    expect(() =>
      readConfig(write("  half_life_days: 90\n  max_age_days: 100\n"))
    ).toThrow(/max_age_days/);
  });

  it("round-trips a scoring update YAML-first and fills field defaults", () => {
    const p = freshConfig();
    updateScoring({ half_life_days: 30, max_age_days: 120 }, p);
    const config = readConfig(p);
    expect(config.scoring).toEqual({
      half_life_days: 30,
      max_age_days: 120,
      min_aggregate_score: 1,
    });
    expect(() => updateScoring({ half_life_days: 90, max_age_days: 100 }, p)).toThrow(ConfigError);
  });

  it("resolves knobs from the block, with decay-module defaults when absent", () => {
    expect(resolveScoringKnobs(undefined)).toEqual({
      halfLifeDays: 90,
      maxAgeDays: 360,
      minAggregateScore: 1,
    });
    expect(
      resolveScoringKnobs({ half_life_days: 30, max_age_days: 120, min_aggregate_score: 0.5 })
    ).toEqual({ halfLifeDays: 30, maxAgeDays: 120, minAggregateScore: 0.5 });
  });

  it("accepts competitor entries with no competitors block", () => {
    const p = path.join(tmp, "no-block.yaml");
    writeFileSync(
      p,
      `github:
  repos:
    - owner: them
      name: their-repo
      competitor: Acme
`
    );
    expect(() => readConfig(p)).not.toThrow();
    expect(readConfig(p).competitors).toBeUndefined();
  });
});
