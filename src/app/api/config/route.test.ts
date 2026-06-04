import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import Database from "better-sqlite3";
import { NextRequest } from "next/server";
import type { ConfigResponse } from "@/lib/types/api";

const tmp = mkdtempSync(path.join(tmpdir(), "gtm-config-route-test-"));
process.env.DATABASE_PATH = path.join(tmp, "test.db");

const { runMigrations } = await import("@/lib/db/migrate");
const { GET, POST } = await import("./route");

runMigrations(); // resolves the migrations folder from the repo cwd — run BEFORE chdir

// The config module resolves gtm-config.yaml from process.cwd() at call time;
// point cwd at the temp dir so POSTs write a scratch file, not the repo's.
const cwdBefore = process.cwd();
process.chdir(tmp);
writeFileSync(
  path.join(tmp, "gtm-config.yaml"),
  "github:\n  repos: []\npackages:\n  npm: []\n  pypi: []\n"
);
afterAll(() => process.chdir(cwdBefore));

const sqlite = new Database(process.env.DATABASE_PATH!);
sqlite
  .prepare(
    "INSERT INTO tracked_packages (registry, name, display_name, competitor) VALUES ('npm', 'rival-pkg', 'Rival', 'Acme')"
  )
  .run();

describe("/api/config (seeded temp DB)", () => {
  it("GET carries competitor attribution on tracked rows", async () => {
    const res = await GET();
    const body = (await res.json()) as ConfigResponse;
    const rival = body.packages.find((p) => p.name === "rival-pkg");
    expect(rival?.competitor).toBe("Acme");
  });

  it("POST adds a repo with a competitor name (YAML first, DB projection)", async () => {
    const res = await POST(
      new NextRequest("http://localhost/api/config", {
        method: "POST",
        body: JSON.stringify({
          type: "repo",
          data: { owner: "them", name: "their-repo", competitor: "Acme" },
        }),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(res.status).toBe(201);
    const row = (await res.json()) as { competitor: string | null };
    expect(row.competitor).toBe("Acme");
    expect(readFileSync(path.join(tmp, "gtm-config.yaml"), "utf-8")).toContain("competitor: Acme");
  });

  it("GET returns default scoring knobs when no block is configured", async () => {
    const res = await GET();
    const body = (await res.json()) as ConfigResponse;
    expect(body.scoring).toEqual({ halfLifeDays: 90, maxAgeDays: 360, minAggregateScore: 1 });
  });

  it("POST round-trips a scoring update and rejects cross-field violations", async () => {
    const ok = await POST(
      new NextRequest("http://localhost/api/config", {
        method: "POST",
        body: JSON.stringify({
          type: "scoring",
          data: { halfLifeDays: 30, maxAgeDays: 120, minAggregateScore: 0.5 },
        }),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(ok.status).toBe(200);
    expect(readFileSync(path.join(tmp, "gtm-config.yaml"), "utf-8")).toContain(
      "half_life_days: 30"
    );
    const after = (await (await GET()).json()) as ConfigResponse;
    expect(after.scoring).toEqual({ halfLifeDays: 30, maxAgeDays: 120, minAggregateScore: 0.5 });

    const bad = await POST(
      new NextRequest("http://localhost/api/config", {
        method: "POST",
        body: JSON.stringify({
          type: "scoring",
          data: { halfLifeDays: 90, maxAgeDays: 100, minAggregateScore: 1 },
        }),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(bad.status).toBe(400);
    const err = (await bad.json()) as { error: string };
    expect(err.error).toContain("max_age_days");
  });

  it("POST adds a package with a competitor name", async () => {
    const res = await POST(
      new NextRequest("http://localhost/api/config", {
        method: "POST",
        body: JSON.stringify({
          type: "package",
          data: { registry: "npm", name: "acme-sdk", competitor: "Acme" },
        }),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(res.status).toBe(201);
    const row = (await res.json()) as { competitor: string | null };
    expect(row.competitor).toBe("Acme");
  });
});
