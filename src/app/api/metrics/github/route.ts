import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import {
  trackedRepos,
  githubRepoMetrics,
  githubTrafficClones,
  githubTrafficViews,
} from "@/lib/db/schema";
import { eq, and, gte, lte, desc } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const repoId = searchParams.get("repoId");
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");
  const metric = searchParams.get("metric"); // "stars" | "traffic" | "all"

  const db = getDb();

  // If no repoId, return all repos with latest metrics
  if (!repoId) {
    const repos = db.select().from(trackedRepos).all();

    const summaries = repos.map((repo) => {
      const latest = db
        .select()
        .from(githubRepoMetrics)
        .where(eq(githubRepoMetrics.repoId, repo.id))
        .orderBy(desc(githubRepoMetrics.date))
        .limit(1)
        .get();

      return {
        id: repo.id,
        owner: repo.owner,
        name: repo.name,
        displayName: repo.displayName,
        stars: latest?.stars || 0,
        forks: latest?.forks || 0,
        watchers: latest?.watchers || 0,
        openIssues: latest?.openIssues || 0,
        contributors: latest?.contributors || 0,
      };
    });

    return NextResponse.json(summaries);
  }

  const id = parseInt(repoId);
  const dateFilters = [];
  if (startDate) dateFilters.push(gte(githubRepoMetrics.date, startDate));
  if (endDate) dateFilters.push(lte(githubRepoMetrics.date, endDate));

  const result: Record<string, unknown> = {};

  if (!metric || metric === "stars" || metric === "all") {
    result.metrics = db
      .select({
        date: githubRepoMetrics.date,
        stars: githubRepoMetrics.stars,
        forks: githubRepoMetrics.forks,
        watchers: githubRepoMetrics.watchers,
        openIssues: githubRepoMetrics.openIssues,
        contributors: githubRepoMetrics.contributors,
      })
      .from(githubRepoMetrics)
      .where(and(eq(githubRepoMetrics.repoId, id), ...dateFilters))
      .orderBy(githubRepoMetrics.date)
      .all();
  }

  if (!metric || metric === "traffic" || metric === "all") {
    const cloneDateFilters = [];
    if (startDate) cloneDateFilters.push(gte(githubTrafficClones.date, startDate));
    if (endDate) cloneDateFilters.push(lte(githubTrafficClones.date, endDate));

    result.clones = db
      .select({
        date: githubTrafficClones.date,
        total: githubTrafficClones.clonesTotal,
        unique: githubTrafficClones.clonesUnique,
      })
      .from(githubTrafficClones)
      .where(and(eq(githubTrafficClones.repoId, id), ...cloneDateFilters))
      .orderBy(githubTrafficClones.date)
      .all();

    const viewDateFilters = [];
    if (startDate) viewDateFilters.push(gte(githubTrafficViews.date, startDate));
    if (endDate) viewDateFilters.push(lte(githubTrafficViews.date, endDate));

    result.views = db
      .select({
        date: githubTrafficViews.date,
        total: githubTrafficViews.viewsTotal,
        unique: githubTrafficViews.viewsUnique,
      })
      .from(githubTrafficViews)
      .where(and(eq(githubTrafficViews.repoId, id), ...viewDateFilters))
      .orderBy(githubTrafficViews.date)
      .all();
  }

  return NextResponse.json(result);
}
