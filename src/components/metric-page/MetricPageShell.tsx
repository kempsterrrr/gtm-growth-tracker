"use client";

import type { ReactNode } from "react";
import { Header } from "@/components/layout/Header";
import { MetricCard } from "@/components/charts/MetricCard";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import type { ShellStatus } from "./use-metric-page";

export interface CardDef {
  title: string;
  value: string | number;
  delta?: number;
  description?: string;
  icon?: ReactNode;
  /** Persona gating etc.; defaults to true. */
  show?: boolean;
}

interface MetricPageShellProps<E extends { id: number }> {
  title: string;
  dateRange: string;
  onDateRangeChange: (range: string) => void;
  persona: string;
  onPersonaChange: (persona: string) => void;
  entities: E[] | null;
  selected: string;
  onSelect: (id: string) => void;
  entityLabel: (entity: E) => string;
  status: ShellStatus;
  error: string | null;
  onRetry: () => void;
  emptyMessage: string;
  cards: CardDef[];
  /** Grid columns for the card row (Tailwind needs literal classes). */
  cardColumns?: 3 | 4 | 5;
  /** Chart area — rendered only when status is "ready". */
  children: ReactNode;
}

const GRID = {
  3: "grid grid-cols-2 md:grid-cols-3 gap-4",
  4: "grid grid-cols-2 md:grid-cols-4 gap-4",
  5: "grid grid-cols-2 md:grid-cols-5 gap-4",
} as const;

/** Shared "detail loaded but series empty" notice for chart areas. */
export function EmptyNotice({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center h-48 text-muted-foreground">
      {message}
    </div>
  );
}

export function MetricPageShell<E extends { id: number }>({
  title,
  dateRange,
  onDateRangeChange,
  persona,
  onPersonaChange,
  entities,
  selected,
  onSelect,
  entityLabel,
  status,
  error,
  onRetry,
  emptyMessage,
  cards,
  cardColumns = 4,
  children,
}: MetricPageShellProps<E>) {
  const visibleCards = cards.filter((c) => c.show !== false);

  return (
    <div className="flex flex-col h-full">
      <Header
        title={title}
        dateRange={dateRange}
        onDateRangeChange={onDateRangeChange}
        persona={persona}
        onPersonaChange={onPersonaChange}
      />

      <div className="flex-1 p-6 space-y-6">
        {status === "error" && (
          <div className="flex flex-col items-center justify-center h-48 gap-3">
            <p className="text-sm text-destructive">Failed to load data: {error}</p>
            <Button size="sm" variant="outline" onClick={onRetry}>
              Retry
            </Button>
          </div>
        )}

        {status === "loading" && (
          <div className="flex items-center justify-center h-48 text-muted-foreground">
            Loading...
          </div>
        )}

        {status === "empty" && <EmptyNotice message={emptyMessage} />}

        {status === "ready" && entities && (
          <>
            <Select
              options={entities.map((e) => ({ value: String(e.id), label: entityLabel(e) }))}
              value={selected}
              onChange={(e) => onSelect(e.target.value)}
              className="w-64"
            />

            {visibleCards.length > 0 && (
              <div className={GRID[cardColumns]}>
                {visibleCards.map((c) => (
                  <MetricCard
                    key={c.title}
                    title={c.title}
                    value={c.value}
                    delta={c.delta}
                    description={c.description}
                    icon={c.icon}
                  />
                ))}
              </div>
            )}

            {children}
          </>
        )}
      </div>
    </div>
  );
}
