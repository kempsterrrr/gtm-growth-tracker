import { getDb } from "../db/client";
import { trackedRepos, githubRepoMetrics, githubTrafficClones, githubTrafficViews } from "../db/schema";
import { getRepo, getTrafficClones, getTrafficViews, getContributorStats } from "../api-clients/github-client";
import { sql } from "drizzle-orm";

export async function collectGithubMetrics() {
  const db = getDb();
  const repos = db.select().from(trackedRepos).all();

  if (repos.length === 0) {
    console.log("[github] No repos to collect");
    return;
  }

  const today = new Date().toISOString().split("T")[0];

  for (const repo of repos) {
    try {
      console.log(`[github] Collecting ${repo.owner}/${repo.name}...`);

      // Fetch repo metadata
      const repoData = await getRepo(repo.owner, repo.name);

      // Fetch contributor count
      let contributorCount: number | null = null;
      try {
        const contributors = await getContributorStats(repo.owner, repo.name);
        contributorCount = contributors.length;
      } catch {
        console.warn(`[github] Could not fetch contributors for ${repo.owner}/${repo.name}`);
      }

      // Upsert repo metrics
      db.insert(githubRepoMetrics)
        .values({
          repoId: repo.id,
          date: today,
          stars: repoData.stargazers_count,
          forks: repoData.forks_count,
          watchers: repoData.subscribers_count,
          openIssues: repoData.open_issues_count,
          contributors: contributorCount,
        })
        .onConflictDoUpdate({
          target: [githubRepoMetrics.repoId, githubRepoMetrics.date],
          set: {
            stars: sql`excluded.stars`,
            forks: sql`excluded.forks`,
            watchers: sql`excluded.watchers`,
            openIssues: sql`excluded.open_issues`,
            contributors: sql`excluded.contributors`,
            collectedAt: sql`datetime('now')`,
          },
        })
        .run();

      console.log(
        `[github] ${repo.owner}/${repo.name}: ${repoData.stargazers_count} stars, ${repoData.forks_count} forks`
      );

      // Fetch and archive traffic data (requires push access)
      try {
        const clones = await getTrafficClones(repo.owner, repo.name);
        for (const c of clones.clones) {
          const cloneDate = c.timestamp.split("T")[0];
          db.insert(githubTrafficClones)
            .values({
              repoId: repo.id,
              date: cloneDate,
              clonesTotal: c.count,
              clonesUnique: c.uniques,
            })
            .onConflictDoUpdate({
              target: [githubTrafficClones.repoId, githubTrafficClones.date],
              set: {
                clonesTotal: sql`excluded.clones_total`,
                clonesUnique: sql`excluded.clones_unique`,
              },
            })
            .run();
        }
        console.log(`[github] ${repo.owner}/${repo.name}: archived ${clones.clones.length} days of clone data`);
      } catch {
        console.warn(`[github] Could not fetch traffic/clones for ${repo.owner}/${repo.name} (requires push access)`);
      }

      try {
        const views = await getTrafficViews(repo.owner, repo.name);
        for (const v of views.views) {
          const viewDate = v.timestamp.split("T")[0];
          db.insert(githubTrafficViews)
            .values({
              repoId: repo.id,
              date: viewDate,
              viewsTotal: v.count,
              viewsUnique: v.uniques,
            })
            .onConflictDoUpdate({
              target: [githubTrafficViews.repoId, githubTrafficViews.date],
              set: {
                viewsTotal: sql`excluded.views_total`,
                viewsUnique: sql`excluded.views_unique`,
              },
            })
            .run();
        }
        console.log(`[github] ${repo.owner}/${repo.name}: archived ${views.views.length} days of view data`);
      } catch {
        console.warn(`[github] Could not fetch traffic/views for ${repo.owner}/${repo.name} (requires push access)`);
      }
    } catch (err) {
      console.error(`[github] Error collecting ${repo.owner}/${repo.name}:`, err);
    }
  }
}
