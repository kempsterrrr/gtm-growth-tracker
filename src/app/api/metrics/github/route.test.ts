import { describe, it, expect } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import Database from "better-sqlite3";
import { NextRequest } from "next/server";
import type {
  GithubRepoSummary,
  GithubRepoMetricsResponse,
  CompetitorEntitySummary,
} from "@/lib/types/api";

process.env.DATABASE_PATH = path.join(
  mkdtempSync(path.join(tmpdir(), "gtm-route-test-")),
  "test.db"
);

const { runMigrations } = await import("@/lib/db/migrate");
const { GET } = await import("./route");

runMigrations();

const sqlite = new Database(process.env.DATABASE_PATH!);
sqlite
  .prepare("INSERT INTO tracked_repos (owner, name, display_name) VALUES ('us', 'our-repo', 'Ours')")
  .run();
sqlite
  .prepare(
    "INSERT INTO tracked_repos (owner, name, display_name, competitor) VALUES ('them', 'their-repo', 'Theirs', 'Acme')"
  )
  .run();
const ourId = (
  sqlite.prepare("SELECT id FROM tracked_repos WHERE name='our-repo'").get() as { id: number }
).id;
const theirId = (
  sqlite.prepare("SELECT id FROM tracked_repos WHERE name='their-repo'").get() as { id: number }
).id;
const insert = sqlite.prepare(
  "INSERT INTO github_repo_metrics (repo_id, date, stars, forks, watchers, open_issues, contributors) VALUES (?, ?, ?, ?, ?, ?, ?)"
);
insert.run(ourId, "2026-06-01", 10, 5, 3, 2, 1);
insert.run(theirId, "2026-06-01", 5000, 100, 50, 40, 30);

describe("GET /api/metrics/github (seeded temp DB)", () => {
  it("excludes competitor-attributed repos from the default list", async () => {
    const res = await GET(new NextRequest("http://localhost/api/metrics/github"));
    const body = (await res.json()) as GithubRepoSummary[];
    expect(res.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0].name).toBe("our-repo");
    expect(body[0].stars).toBe(10);
  });

  it("still serves a competitor repo's series by id (compare overlay reads it)", async () => {
    const res = await GET(
      new NextRequest(`http://localhost/api/metrics/github?repoId=${theirId}&metric=stars`)
    );
    const body = (await res.json()) as GithubRepoMetricsResponse;
    expect(body.metrics).toHaveLength(1);
    expect(body.metrics![0].stars).toBe(5000);
  });

  it("lists competitor repos (owner/name + competitor) under ?competitors=1", async () => {
    const res = await GET(new NextRequest("http://localhost/api/metrics/github?competitors=1"));
    const body = (await res.json()) as CompetitorEntitySummary[];
    expect(body).toEqual([
      { id: theirId, name: "them/their-repo", displayName: "Theirs", competitor: "Acme" },
    ]);
  });
});
