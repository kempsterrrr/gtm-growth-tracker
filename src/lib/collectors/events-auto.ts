import { getDb } from "../db/client";
import { trackedRepos, events } from "../db/schema";
import { getReleases } from "../api-clients/github-client";
import { sql } from "drizzle-orm";

export async function collectAutoEvents() {
  const db = getDb();
  const repos = db.select().from(trackedRepos).all();

  if (repos.length === 0) {
    console.log("[events-auto] No repos to scan for releases");
    return;
  }

  for (const repo of repos) {
    try {
      console.log(`[events-auto] Scanning releases for ${repo.owner}/${repo.name}...`);
      const releases = await getReleases(repo.owner, repo.name);

      let newCount = 0;
      for (const release of releases) {
        if (release.draft) continue;

        const releaseDate = release.published_at?.split("T")[0];
        if (!releaseDate) continue;

        // Check if we already have this event
        const existing = db
          .select()
          .from(events)
          .where(
            sql`${events.category} = 'release' AND ${events.source} = 'auto' AND ${events.repoId} = ${repo.id} AND json_extract(${events.metadata}, '$.tag') = ${release.tag_name}`
          )
          .get();

        if (!existing) {
          const title = release.name || release.tag_name;
          db.insert(events)
            .values({
              date: releaseDate,
              title: `${repo.owner}/${repo.name} ${title}`,
              description: release.body?.slice(0, 500) || null,
              category: "release",
              source: "auto",
              repoId: repo.id,
              metadata: JSON.stringify({
                tag: release.tag_name,
                url: release.html_url,
                prerelease: release.prerelease,
              }),
            })
            .run();
          newCount++;
        }
      }

      console.log(
        `[events-auto] ${repo.owner}/${repo.name}: ${releases.length} releases found, ${newCount} new events created`
      );
    } catch (err) {
      console.error(`[events-auto] Error scanning ${repo.owner}/${repo.name}:`, err);
    }
  }
}
