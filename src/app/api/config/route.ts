import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { trackedRepos, trackedPackages } from "@/lib/db/schema";
import { sql } from "drizzle-orm";
import { addRepo, addPackage, ConfigError } from "@/lib/config/gtm-config";

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

  try {
    if (type === "repo") {
      // YAML first, then DB projection — handled inside the config module
      addRepo({ owner: data.owner, name: data.name, display_name: data.displayName || undefined });
      const row = db
        .select()
        .from(trackedRepos)
        .where(sql`${trackedRepos.owner} = ${data.owner} AND ${trackedRepos.name} = ${data.name}`)
        .get();
      return NextResponse.json(row, { status: 201 });
    }

    if (type === "package") {
      const name = (data.name ?? "").trim();
      addPackage(data.registry, { name, display_name: data.displayName || undefined });
      const row = db
        .select()
        .from(trackedPackages)
        .where(
          sql`${trackedPackages.registry} = ${data.registry} AND ${trackedPackages.name} = ${name}`
        )
        .get();
      return NextResponse.json(row, { status: 201 });
    }

    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  } catch (err) {
    if (err instanceof ConfigError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
