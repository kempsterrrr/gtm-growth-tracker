"use client";

import { useEffect, useState } from "react";
import { useDashboardFilters, type Persona } from "@/lib/hooks/use-dashboard-filters";

export type ShellStatus = "loading" | "error" | "empty" | "ready";

/** Fetch JSON or throw — no silent catches anywhere in the shell. */
export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status} ${res.statusText} (${url})`);
  }
  return res.json() as Promise<T>;
}

export interface MetricPageConfig<D> {
  /** Endpoint returning the entity list. */
  listUrl: string;
  /** Detail endpoints for the selected entity (fetched in parallel). */
  detailUrls: (
    selectedId: string,
    qs: (extra?: Record<string, string>) => string
  ) => string[];
  /** Combine the parallel detail responses into one detail value. */
  combineDetail: (responses: unknown[]) => D;
}

/**
 * THE data flow for a metric page: fetch entity list → auto-select the first
 * entity → fetch its detail (re-keyed on selection + date range) → expose one
 * status union. Status is DERIVED from keyed state, so effects never call
 * setState synchronously and stale responses are ignored by key mismatch.
 * Any fetch failure surfaces as status "error" with a retry affordance.
 *
 * Configs must be module-level constants (stable references) — they appear in
 * effect dependency arrays.
 */
export function useMetricPage<E extends { id: number }, D>(config: MetricPageConfig<D>) {
  const { dateRange, setDateRange, persona, setPersona, buildQueryString } =
    useDashboardFilters();

  const [entities, setEntities] = useState<E[] | null>(null);
  const [selected, setSelected] = useState("");
  const [detail, setDetail] = useState<{ key: string; data: D } | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  const detailKey = `${selected}|${dateRange}`;

  // Entity list
  useEffect(() => {
    let cancelled = false;
    fetchJson<E[]>(config.listUrl)
      .then((data) => {
        if (cancelled) return;
        setEntities(data);
        if (data.length > 0) setSelected((cur) => cur || String(data[0].id));
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError({ key: "list", message: err instanceof Error ? err.message : String(err) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [config, retryToken]);

  // Detail for the selected entity
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    const key = `${selected}|${dateRange}`;
    Promise.all(config.detailUrls(selected, buildQueryString).map((u) => fetchJson<unknown>(u)))
      .then((responses) => {
        if (!cancelled) setDetail({ key, data: config.combineDetail(responses) });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError({ key, message: err instanceof Error ? err.message : String(err) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selected, dateRange, buildQueryString, config, retryToken]);

  const activeError =
    error && (error.key === "list" || error.key === detailKey) ? error.message : null;
  const currentDetail = detail && detail.key === detailKey ? detail.data : null;

  const status: ShellStatus = activeError
    ? "error"
    : entities === null
      ? "loading"
      : entities.length === 0
        ? "empty"
        : currentDetail === null
          ? "loading"
          : "ready";

  const current = entities?.find((e) => String(e.id) === selected);

  const retry = () => {
    setError(null);
    setRetryToken((t) => t + 1);
  };

  return {
    entities,
    selected,
    setSelected,
    current,
    detail: currentDetail,
    status,
    error: activeError,
    retry,
    dateRange,
    setDateRange,
    persona,
    setPersona,
    buildQueryString,
  };
}

export type { Persona };
