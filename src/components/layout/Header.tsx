"use client";

import { Select } from "@/components/ui/select";

const dateRangeOptions = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "365", label: "Last year" },
  { value: "all", label: "All time" },
];

const personaOptions = [
  { value: "all", label: "All Metrics" },
  { value: "marketing", label: "Marketing" },
  { value: "sales", label: "Sales" },
  { value: "engineering", label: "Engineering" },
  { value: "gtm", label: "GTM" },
];

interface HeaderProps {
  title: string;
  dateRange: string;
  onDateRangeChange: (range: string) => void;
  persona: string;
  onPersonaChange: (persona: string) => void;
}

export function Header({
  title,
  dateRange,
  onDateRangeChange,
  persona,
  onPersonaChange,
}: HeaderProps) {
  return (
    <header className="flex items-center justify-between border-b px-6 py-4">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      <div className="flex items-center gap-3">
        <Select
          options={personaOptions}
          value={persona}
          onChange={(e) => onPersonaChange(e.target.value)}
          className="w-36"
        />
        <Select
          options={dateRangeOptions}
          value={dateRange}
          onChange={(e) => onDateRangeChange(e.target.value)}
          className="w-36"
        />
      </div>
    </header>
  );
}
