import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { trackedRepos, trackedPackages } from "@/lib/db/schema";
import { sql } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { parse, stringify } from "yaml";
import type { GtmConfig } from "@/lib/types/config";

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
    const result = db
      .insert(trackedPackages)
      .values({
        registry: data.registry,
        name: data.name,
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

  const config: GtmConfig = {
    github: {
      repos: repos.map((r) => ({
        owner: r.owner,
        name: r.name,
        display_name: r.displayName || undefined,
      })),
    },
    packages: {
      npm: packages
        .filter((p) => p.registry === "npm")
        .map((p) => ({
          name: p.name,
          display_name: p.displayName || undefined,
        })),
      pypi: packages
        .filter((p) => p.registry === "pypi")
        .map((p) => ({
          name: p.name,
          display_name: p.displayName || undefined,
        })),
    },
    collection: {
      npm_backfill_from: "2024-01-01",
    },
  };

  const configPath = path.join(process.cwd(), "gtm-config.yaml");
  fs.writeFileSync(configPath, stringify(config));
}
