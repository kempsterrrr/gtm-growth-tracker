import { describe, it, expect } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import Database from "better-sqlite3";
import { NextRequest } from "next/server";
import type { NpmPackageSummary, DownloadRow, CompetitorEntitySummary } from "@/lib/types/api";

process.env.DATABASE_PATH = path.join(
  mkdtempSync(path.join(tmpdir(), "gtm-route-test-")),
  "test.db"
);

const { runMigrations } = await import("@/lib/db/migrate");
const { daysAgoIso } = await import("@/lib/dates");
const { GET } = await import("./route");

runMigrations();

const sqlite = new Database(process.env.DATABASE_PATH!);
sqlite
  .prepare(
    "INSERT INTO tracked_packages (registry, name, display_name) VALUES ('npm', 'demo-pkg', 'Demo')"
  )
  .run();
const pkgId = (
  sqlite.prepare("SELECT id FROM tracked_packages WHERE name='demo-pkg'").get() as { id: number }
).id;
// Last-7-days window: 100/day; previous window: 50/day. Day 7 belongs to both
// windows in the route's existing query (gte 7 / lte 7) — seed days 1–6 and
// 8–13 so the expectation is exact.
const insert = sqlite.prepare(
  "INSERT INTO npm_downloads (package_id, date, downloads) VALUES (?, ?, ?)"
);
for (let d = 1; d <= 6; d++) insert.run(pkgId, daysAgoIso(d), 100);
for (let d = 8; d <= 13; d++) insert.run(pkgId, daysAgoIso(d), 50);

// A competitor-attributed package: must be invisible to the default list but
// still served by id (the compare overlay in #20 reads it).
sqlite
  .prepare(
    "INSERT INTO tracked_packages (registry, name, display_name, competitor) VALUES ('npm', 'rival-pkg', 'Rival', 'Acme')"
  )
  .run();
const rivalId = (
  sqlite.prepare("SELECT id FROM tracked_packages WHERE name='rival-pkg'").get() as { id: number }
).id;
for (let d = 1; d <= 6; d++) insert.run(rivalId, daysAgoIso(d), 999);

describe("GET /api/metrics/npm (seeded temp DB)", () => {
  it("returns package summaries matching the contract, with windowed growth", async () => {
    const res = await GET(new NextRequest("http://localhost/api/metrics/npm"));
    const body = (await res.json()) as NpmPackageSummary[];

    expect(res.status).toBe(200);
    expect(body).toHaveLength(1);
    const summary = body[0];
    expect(summary.name).toBe("demo-pkg");
    expect(summary.displayName).toBe("Demo");
    expect(summary.downloadsLast7d).toBe(600);
    expect(summary.growthPercent7d).toBe(100); // 600 vs 300
    // exactly the contract keys — nothing extra leaks, nothing missing
    expect(Object.keys(summary).sort()).toEqual(
      ["displayName", "downloadsLast7d", "growthPercent7d", "id", "name"].sort()
    );
  });

  it("returns the time series for a packageId", async () => {
    const res = await GET(new NextRequest(`http://localhost/api/metrics/npm?packageId=${pkgId}`));
    const body = (await res.json()) as DownloadRow[];
    expect(body.length).toBe(12);
    expect(body[0]).toEqual({ date: daysAgoIso(13), downloads: 50 });
  });

  it("excludes competitor-attributed packages from the default list but serves them by id", async () => {
    const listRes = await GET(new NextRequest("http://localhost/api/metrics/npm"));
    const list = (await listRes.json()) as NpmPackageSummary[];
    expect(list.map((p) => p.name)).not.toContain("rival-pkg");

    const detailRes = await GET(
      new NextRequest(`http://localhost/api/metrics/npm?packageId=${rivalId}`)
    );
    const detail = (await detailRes.json()) as DownloadRow[];
    expect(detail.length).toBe(6);
  });

  it("lists competitor packages (with competitor name) under ?competitors=1", async () => {
    const res = await GET(new NextRequest("http://localhost/api/metrics/npm?competitors=1"));
    const body = (await res.json()) as CompetitorEntitySummary[];
    expect(body).toEqual([
      { id: rivalId, name: "rival-pkg", displayName: "Rival", competitor: "Acme" },
    ]);
  });
});
