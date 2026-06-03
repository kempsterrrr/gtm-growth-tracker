import { describe, it, expect } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import Database from "better-sqlite3";
import type { GithubClient } from "../api-clients/github-client";

process.env.DATABASE_PATH = path.join(
  mkdtempSync(path.join(tmpdir(), "gtm-compdeps-test-")),
  "test.db"
);

const { runMigrations } = await import("../db/migrate");
const { resolveCompetitorDependents } = await import("./competitor-dependents");

runMigrations();

const sqlite = new Database(process.env.DATABASE_PATH!);
sqlite
  .prepare(
    "INSERT INTO tracked_packages (registry, name, display_name, competitor) VALUES ('npm', 'pinata-js', 'Pinata JS', 'Pinata')"
  )
  .run();
sqlite.prepare("INSERT INTO tracked_packages (registry, name) VALUES ('npm', 'our-own-pkg')").run();
const rivalPkgId = (
  sqlite.prepare("SELECT id FROM tracked_packages WHERE name='pinata-js'").get() as { id: number }
).id;
const ownPkgId = (
  sqlite.prepare("SELECT id FROM tracked_packages WHERE name='our-own-pkg'").get() as { id: number }
).id;
const dep = (pkgId: number, name: string, version: string | null) =>
  sqlite
    .prepare(
      "INSERT INTO reverse_dependencies (package_id, dependent_name, dependent_registry, dependent_version, first_seen) VALUES (?, ?, 'npm', ?, '2026-06-01')"
    )
    .run(pkgId, name, version);
dep(rivalPkgId, "acme-app", "1.0.0"); // resolves → org acme → acme.dev
dep(rivalPkgId, "ghost-pkg", null); // no source repo → skipped
dep(rivalPkgId, "solo-tool", "2.0.0"); // org profile 404 → skipped
dep(ownPkgId, "consumer", "1.0.0"); // own package — never touched

const repoByPkg: Record<string, string | null> = {
  "acme-app": "github.com/acme/app",
  "ghost-pkg": null,
  "solo-tool": "github.com/solodev/tool",
};
const fakeGetRepo = async (_registry: string, pkg: string) => repoByPkg[pkg] ?? null;

const fakeGithub = {
  getUserProfile: async (login: string) => {
    if (login === "acme")
      return {
        id: 1,
        login,
        name: "Acme Corp",
        blog: "https://acme.dev",
        email: null,
        company: null,
        bio: null,
        avatar_url: "",
        location: null,
        twitter_username: null,
      };
    throw new Error("404 not found");
  },
} as unknown as GithubClient;

describe("resolveCompetitorDependents", () => {
  it("resolves dependents of competitor packages to companies and records signals", async () => {
    await resolveCompetitorDependents(fakeGetRepo, fakeGithub);

    const company = sqlite
      .prepare("SELECT id, name, domain FROM companies WHERE domain = 'acme.dev'")
      .get() as { id: number; name: string; domain: string } | undefined;
    expect(company).toBeTruthy();

    const signals = sqlite
      .prepare(
        "SELECT company_id, package_id, signal_type, dependent_name FROM company_competitor_signals"
      )
      .all() as Array<{
      company_id: number;
      package_id: number;
      signal_type: string;
      dependent_name: string;
    }>;
    expect(signals).toEqual([
      {
        company_id: company!.id,
        package_id: rivalPkgId,
        signal_type: "depends_on",
        dependent_name: "acme-app",
      },
    ]);
  });

  it("is idempotent across re-runs", async () => {
    await resolveCompetitorDependents(fakeGetRepo, fakeGithub);
    const n = (
      sqlite.prepare("SELECT COUNT(*) AS n FROM company_competitor_signals").get() as { n: number }
    ).n;
    expect(n).toBe(1);
  });
});
