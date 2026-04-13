export type EventCategory =
  | "release"
  | "dependency_added"
  | "blog_post"
  | "conference"
  | "upstream_inclusion"
  | "custom";

export type EventSource = "auto" | "manual";

export interface TrackedEvent {
  id: number;
  date: string;
  title: string;
  description: string | null;
  category: EventCategory;
  source: EventSource;
  repoId: number | null;
  packageId: number | null;
  metadata: string | null;
  createdAt: string;
}

export interface CreateEventInput {
  date: string;
  title: string;
  description?: string;
  category: EventCategory;
  repoId?: number;
  packageId?: number;
  metadata?: Record<string, unknown>;
}

export const EVENT_CATEGORY_COLORS: Record<EventCategory, string> = {
  release: "#5427C8",          // ar.io primary purple
  dependency_added: "#22c55e", // green
  blog_post: "#7C5CE7",       // lighter purple
  conference: "#f97316",      // orange
  upstream_inclusion: "#A78BFA", // lavender purple
  custom: "#6B6B78",          // muted
};

export const EVENT_CATEGORY_LABELS: Record<EventCategory, string> = {
  release: "Release",
  dependency_added: "New Dependent",
  blog_post: "Blog Post",
  conference: "Conference",
  upstream_inclusion: "Upstream Inclusion",
  custom: "Custom",
};
