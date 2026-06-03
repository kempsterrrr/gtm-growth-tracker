import { describe, it, expect } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import Database from "better-sqlite3";
import { NextRequest } from "next/server";
import type { PypiPackageSummary, PypiDownloadRow } from "@/lib/types/api";

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
    "INSERT INTO tracked_packages (registry, name, display_name) VALUES ('pypi', 'our-pkg', 'Ours')"
  )
  .run();
sqlite
  .prepare(
    "INSERT INTO tracked_packages (registry, name, display_name, competitor) VALUES ('pypi', 'rival-pkg', 'Rival', 'Acme')"
  )
  .run();
const ourId = (
  sqlite.prepare("SELECT id FROM tracked_packages WHERE name='our-pkg'").get() as { id: number }
).id;
const rivalId = (
  sqlite.prepare("SELECT id FROM tracked_packages WHERE name='rival-pkg'").get() as { id: number }
).id;
const insert = sqlite.prepare(
  "INSERT INTO pypi_downloads (package_id, date, downloads, category) VALUES (?, ?, ?, 'overall')"
);
for (let d = 1; d <= 3; d++) {
  insert.run(ourId, daysAgoIso(d), 10);
  insert.run(rivalId, daysAgoIso(d), 999);
}

describe("GET /api/metrics/pypi (seeded temp DB)", () => {
  it("excludes competitor-attributed packages from the default list", async () => {
    const res = await GET(new NextRequest("http://localhost/api/metrics/pypi"));
    const body = (await res.json()) as PypiPackageSummary[];
    expect(res.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0].name).toBe("our-pkg");
    expect(body[0].downloadsLast7d).toBe(30);
  });

  it("still serves a competitor package's series by id (compare overlay reads it)", async () => {
    const res = await GET(
      new NextRequest(`http://localhost/api/metrics/pypi?packageId=${rivalId}`)
    );
    const body = (await res.json()) as PypiDownloadRow[];
    expect(body).toHaveLength(3);
    expect(body[0].downloads).toBe(999);
  });
});
