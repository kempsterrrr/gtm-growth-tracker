interface CompanyScoreBarProps {
  starCount: number;
  forkCount: number;
  issueCount: number;
  prCount: number;
  commitCount: number;
}

const SEGMENTS = [
  { key: "commitCount" as const, label: "Commits", color: "#5427C8" },
  { key: "prCount" as const, label: "PRs", color: "#7C5CE7" },
  { key: "issueCount" as const, label: "Issues", color: "#22c55e" },
  { key: "forkCount" as const, label: "Forks", color: "#3b82f6" },
  { key: "starCount" as const, label: "Stars", color: "#eab308" },
];

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
