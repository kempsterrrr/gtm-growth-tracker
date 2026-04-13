import { NextResponse } from "next/server";
import { runMigrations } from "@/lib/db/migrate";
import { collectNpmDownloads } from "@/lib/collectors/npm";
import { collectGithubMetrics } from "@/lib/collectors/github";
import { collectPypiDownloads } from "@/lib/collectors/pypi";
import { collectDependencies } from "@/lib/collectors/deps-dev";
import { collectAutoEvents } from "@/lib/collectors/events-auto";

export async function POST() {
  try {
    runMigrations();

    const results: string[] = [];

    try {
      await collectGithubMetrics();
      results.push("GitHub metrics collected");
    } catch (err) {
      results.push(`GitHub error: ${err instanceof Error ? err.message : String(err)}`);
    }

    try {
      await collectNpmDownloads();
      results.push("npm downloads collected");
    } catch (err) {
      results.push(`npm error: ${err instanceof Error ? err.message : String(err)}`);
    }

    try {
      await collectPypiDownloads();
      results.push("PyPI downloads collected");
    } catch (err) {
      results.push(`PyPI error: ${err instanceof Error ? err.message : String(err)}`);
    }

    try {
      await collectDependencies();
      results.push("Dependencies collected");
    } catch (err) {
      results.push(`Dependencies error: ${err instanceof Error ? err.message : String(err)}`);
    }

    try {
      await collectAutoEvents();
      results.push("Auto events collected");
    } catch (err) {
      results.push(`Events error: ${err instanceof Error ? err.message : String(err)}`);
    }

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      results,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
