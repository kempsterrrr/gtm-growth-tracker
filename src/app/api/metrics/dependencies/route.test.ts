import { describe, it, expect } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import Database from "better-sqlite3";
import { NextRequest } from "next/server";
import type { DependencySummary, DependencyDetailResponse } from "@/lib/types/api";

process.env.DATABASE_PATH = path.join(
  mkdtempSync(path.join(tmpdir(), "gtm-route-test-")),
  "test.db"
);

const { runMigrations } = await import("@/lib/db/migrate");
const { GET } = await import("./route");

runMigrations();

const sqlite = new Database(process.env.DATABASE_PATH!);
sqlite
  .prepare(
    "INSERT INTO tracked_packages (registry, name, display_name) VALUES ('npm', 'our-pkg', 'Ours')"
  )
  .run();
sqlite
  .prepare(
    "INSERT INTO tracked_packages (registry, name, display_name, competitor) VALUES ('npm', 'rival-pkg', 'Rival', 'Acme')"
  )
  .run();
const ourId = (
  sqlite.prepare("SELECT id FROM tracked_packages WHERE name='our-pkg'").get() as { id: number }
).id;
const rivalId = (
  sqlite.prepare("SELECT id FROM tracked_packages WHERE name='rival-pkg'").get() as { id: number }
).id;
const insertCount = sqlite.prepare(
  "INSERT INTO reverse_dependency_counts (package_id, date, count) VALUES (?, ?, ?)"
);
insertCount.run(ourId, "2026-06-01", 7);
insertCount.run(rivalId, "2026-06-01", 1000);
sqlite
  .prepare(
    "INSERT INTO reverse_dependencies (package_id, dependent_name, dependent_registry, first_seen) VALUES (?, 'consumer-app', 'npm', '2026-05-01')"
  )
  .run(rivalId);

describe("GET /api/metrics/dependencies (seeded temp DB)", () => {
  it("excludes competitor-attributed packages from the default list", async () => {
    const res = await GET(new NextRequest("http://localhost/api/metrics/dependencies"));
    const body = (await res.json()) as DependencySummary[];
    expect(res.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0].name).toBe("our-pkg");
    expect(body[0].dependentCount).toBe(7);
  });

  it("still serves a competitor package's dependents by id (#22 reverse-dep mining reads them)", async () => {
    const res = await GET(
      new NextRequest(`http://localhost/api/metrics/dependencies?packageId=${rivalId}`)
    );
    const body = (await res.json()) as DependencyDetailResponse;
    expect(body.counts).toHaveLength(1);
    expect(body.dependents.map((d) => d.dependentName)).toContain("consumer-app");
  });
});
