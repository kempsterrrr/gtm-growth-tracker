interface CompanyScoreBarProps {
  starCount: number;
  forkCount: number;
  issueCount: number;
  prCount: number;
  commitCount: number;
}

/** THE event-type color scale — ordered by demand significance and drawn
 *  from the chart palette so every surface (bars, charts, legends) agrees. */
export const EVENT_TYPE_SCALE = [
  { key: "issueCount" as const, label: "Issues", color: "var(--chart-1)" },
  { key: "forkCount" as const, label: "Forks", color: "var(--chart-2)" },
  { key: "starCount" as const, label: "Stars", color: "var(--chart-3)" },
  { key: "prCount" as const, label: "PRs", color: "var(--chart-5)" },
  { key: "commitCount" as const, label: "Commits", color: "var(--chart-4)" },
];
const SEGMENTS = EVENT_TYPE_SCALE;

export function CompanyScoreBar(props: CompanyScoreBarProps) {
  const total = SEGMENTS.reduce((s, seg) => s + (props[seg.key] || 0), 0);
  if (total === 0) return <div className="h-2 bg-muted rounded-full" />;

  return (
    <div className="flex h-2 rounded-full overflow-hidden gap-px">
      {SEGMENTS.map((seg) => {
        const value = props[seg.key] || 0;
        if (value === 0) return null;
        const pct = (value / total) * 100;
        return (
          <div
            key={seg.key}
            className="h-full transition-all"
            style={{ width: `${pct}%`, backgroundColor: seg.color }}
            title={`${seg.label}: ${value}`}
          />
        );
      })}
    </div>
  );
}
