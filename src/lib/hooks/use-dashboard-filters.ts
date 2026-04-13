"use client";

import { useState, useCallback, useMemo } from "react";

export type Persona = "all" | "marketing" | "sales" | "engineering" | "gtm";

export function useDashboardFilters() {
  const [dateRange, setDateRange] = useState("30");
  const [persona, setPersona] = useState<Persona>("all");

  const dateParams = useMemo(() => {
    if (dateRange === "all") return {};

    const days = parseInt(dateRange);
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    return {
      startDate: startDate.toISOString().split("T")[0],
      endDate: endDate.toISOString().split("T")[0],
    };
  }, [dateRange]);

  const buildQueryString = useCallback(
    (extra?: Record<string, string>) => {
      const params = new URLSearchParams();
      if (dateParams.startDate) params.set("startDate", dateParams.startDate);
      if (dateParams.endDate) params.set("endDate", dateParams.endDate);
      if (extra) {
        for (const [k, v] of Object.entries(extra)) {
          params.set(k, v);
        }
      }
      return params.toString();
    },
    [dateParams]
  );

  return {
    dateRange,
    setDateRange,
    persona,
    setPersona,
    dateParams,
    buildQueryString,
  };
}
