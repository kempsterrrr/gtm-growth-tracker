import { Badge } from "@/components/ui/badge";
import type { EngagementEventType } from "@/lib/types/sales-intelligence";

const TYPE_COLORS: Record<EngagementEventType, string> = {
  star: "#eab308",
  fork: "#3b82f6",
  issue: "#22c55e",
  issue_comment: "#22c55e",
  pr: "#a855f7",
  pr_review: "#a855f7",
  commit: "#5427C8",
};

const TYPE_LABELS: Record<EngagementEventType, string> = {
  star: "Star",
  fork: "Fork",
  issue: "Issue",
  issue_comment: "Comment",
  pr: "PR",
  pr_review: "Review",
  commit: "Commit",
};

export function EngagementBadges({ types }: { types: EngagementEventType[] }) {
  const unique = [...new Set(types)];
  return (
    <div className="flex flex-wrap gap-1">
      {unique.map((type) => (
        <Badge
          key={type}
          variant="outline"
          className="text-[10px] px-1.5 py-0"
          style={{ borderColor: TYPE_COLORS[type], color: TYPE_COLORS[type] }}
        >
          {TYPE_LABELS[type]}
        </Badge>
      ))}
    </div>
  );
}
