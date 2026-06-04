import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { trackedRepos, trackedPackages } from "@/lib/db/schema";
import { sql } from "drizzle-orm";
import {
  addRepo,
  addPackage,
  updateScoring,
  readConfig,
  resolveScoringKnobs,
  ConfigError,
} from "@/lib/config/gtm-config";
import type { ConfigResponse, ScoringSettings } from "@/lib/types/api";

function currentScoringSettings(): ScoringSettings {
  const configPath = path.join(process.cwd(), "gtm-config.yaml");
  const config = fs.existsSync(configPath) ? readConfig(configPath) : undefined;
  return resolveScoringKnobs(config?.scoring);
}

export async function GET() {
  const db = getDb();

  const repos = db.select().from(trackedRepos).all();
  const packages = db.select().from(trackedPackages).all();

  const payload: ConfigResponse = { repos, packages, scoring: currentScoringSettings() };
  return NextResponse.json(payload);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { type, data } = body;
  const db = getDb();

  try {
    if (type === "repo") {
      // YAML first, then DB projection — handled inside the config module
      addRepo({
        owner: data.owner,
        name: data.name,
        display_name: data.displayName || undefined,
        competitor: data.competitor || undefined,
      });
      const row = db
        .select()
        .from(trackedRepos)
        .where(sql`${trackedRepos.owner} = ${data.owner} AND ${trackedRepos.name} = ${data.name}`)
        .get();
      return NextResponse.json(row, { status: 201 });
    }

    if (type === "package") {
      const name = (data.name ?? "").trim();
      addPackage(data.registry, {
        name,
        display_name: data.displayName || undefined,
        competitor: data.competitor || undefined,
      });
      const row = db
        .select()
        .from(trackedPackages)
        .where(
          sql`${trackedPackages.registry} = ${data.registry} AND ${trackedPackages.name} = ${name}`
        )
        .get();
      return NextResponse.json(row, { status: 201 });
    }

    if (type === "scoring") {
      // YAML-first; invalid knobs throw ConfigError → 400 below.
      updateScoring({
        half_life_days: data.halfLifeDays,
        max_age_days: data.maxAgeDays,
        min_aggregate_score: data.minAggregateScore,
      });
      return NextResponse.json(currentScoringSettings());
    }

    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  } catch (err) {
    if (err instanceof ConfigError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
