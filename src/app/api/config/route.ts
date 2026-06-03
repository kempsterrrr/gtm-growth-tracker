import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { trackedRepos, trackedPackages } from "@/lib/db/schema";
import { sql } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { stringify } from "yaml";
import type { GtmConfig } from "@/lib/types/config";
import { validatePackageName } from "@/lib/validation/package-name";

const YAML_HEADER = "# ar.io Growth Tracker Configuration\n\n";

export async function GET() {
  const db = getDb();

  const repos = db.select().from(trackedRepos).all();
  const packages = db.select().from(trackedPackages).all();

  return NextResponse.json({ repos, packages });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { type, data } = body;
  const db = getDb();

  if (type === "repo") {
    const result = db
      .insert(trackedRepos)
      .values({
        owner: data.owner,
        name: data.name,
        displayName: data.displayName || null,
      })
      .onConflictDoUpdate({
        target: [trackedRepos.owner, trackedRepos.name],
        set: { displayName: sql`excluded.display_name` },
      })
      .returning()
      .get();

    // Update YAML config
    updateYamlConfig();

    return NextResponse.json(result, { status: 201 });
  }

  if (type === "package") {
    const validationError = validatePackageName(data.registry, data.name ?? "");
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const result = db
      .insert(trackedPackages)
      .values({
        registry: data.registry,
        name: data.name.trim(),
        displayName: data.displayName || null,
        repoId: data.repoId || null,
      })
      .onConflictDoUpdate({
        target: [trackedPackages.registry, trackedPackages.name],
        set: {
          displayName: sql`excluded.display_name`,
          repoId: data.repoId ? sql`${data.repoId}` : sql`repo_id`,
        },
      })
      .returning()
      .get();

    updateYamlConfig();

    return NextResponse.json(result, { status: 201 });
  }

  return NextResponse.json({ error: "Invalid type" }, { status: 400 });
}

function updateYamlConfig() {
  const db = getDb();
  const repos = db.select().from(trackedRepos).all();
  const packages = db.select().from(trackedPackages).all();

  const repoById = new Map(repos.map((r) => [r.id, `${r.owner}/${r.name}`]));

  const toPackageEntry = (p: typeof packages[number]) => {
    const githubRepo = p.repoId ? repoById.get(p.repoId) : undefined;
    return {
      name: p.name,
      display_name: p.displayName || undefined,
      github_repo: githubRepo,
    };
  };

  const config: GtmConfig = {
    github: {
      repos: repos.map((r) => ({
        owner: r.owner,
        name: r.name,
        display_name: r.displayName || undefined,
      })),
    },
    packages: {
      npm: packages.filter((p) => p.registry === "npm").map(toPackageEntry),
      pypi: packages.filter((p) => p.registry === "pypi").map(toPackageEntry),
    },
    collection: {
      npm_backfill_from: "2024-01-01",
    },
  };

  const configPath = path.join(process.cwd(), "gtm-config.yaml");
  fs.writeFileSync(configPath, YAML_HEADER + stringify(config));
}
