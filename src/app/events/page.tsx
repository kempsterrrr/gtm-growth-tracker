"use client";

import { useEffect, useState } from "react";
import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useDashboardFilters } from "@/lib/hooks/use-dashboard-filters";
import { Plus, X } from "lucide-react";
import {
  EVENT_CATEGORY_COLORS,
  EVENT_CATEGORY_LABELS,
  type EventCategory,
} from "@/lib/types/events";

interface TrackedEvent {
  id: number;
  date: string;
  title: string;
  description: string | null;
  category: EventCategory;
  source: "auto" | "manual";
  repoId: number | null;
  packageId: number | null;
  metadata: string | null;
  createdAt: string;
}

const CATEGORIES: EventCategory[] = [
  "release",
  "dependency_added",
  "blog_post",
  "conference",
  "upstream_inclusion",
  "custom",
];

export default function EventsPage() {
  const { dateRange, setDateRange, persona, setPersona, buildQueryString } =
    useDashboardFilters();

  const [events, setEvents] = useState<TrackedEvent[]>([]);
  const [filterCategory, setFilterCategory] = useState<string>("");
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);

  // Form state
  const [formDate, setFormDate] = useState(new Date().toISOString().split("T")[0]);
  const [formTitle, setFormTitle] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formCategory, setFormCategory] = useState<EventCategory>("custom");

  async function fetchEvents() {
    setLoading(true);
    const params = new URLSearchParams();
    const dateParams = buildQueryString();
    if (dateParams) {
      const dp = new URLSearchParams(dateParams);
      dp.forEach((v, k) => params.set(k, v));
    }
    if (filterCategory) params.set("category", filterCategory);

    const res = await fetch(`/api/events?${params.toString()}`);
    const data: TrackedEvent[] = await res.json();
    setEvents(data);
    setLoading(false);
  }

  useEffect(() => {
    fetchEvents();
  }, [dateRange, filterCategory, buildQueryString]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: formDate,
        title: formTitle,
        description: formDescription || undefined,
        category: formCategory,
      }),
    });
    setFormTitle("");
    setFormDescription("");
    setShowForm(false);
    fetchEvents();
  }

  async function handleDelete(id: number) {
    await fetch(`/api/events?id=${id}`, { method: "DELETE" });
    fetchEvents();
  }

  return (
    <div className="flex flex-col h-full">
      <Header
        title="Events"
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        persona={persona}
        onPersonaChange={(p) => setPersona(p as typeof persona)}
      />

      <div className="flex-1 p-6 space-y-6">
        {/* Controls */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setFilterCategory("")}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                !filterCategory
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              All
            </button>
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() =>
                  setFilterCategory(filterCategory === cat ? "" : cat)
                }
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  filterCategory === cat
                    ? "text-white"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
                style={
                  filterCategory === cat
                    ? { backgroundColor: EVENT_CATEGORY_COLORS[cat] }
                    : undefined
                }
              >
                {EVENT_CATEGORY_LABELS[cat]}
              </button>
            ))}
          </div>
          <Button size="sm" onClick={() => setShowForm(!showForm)}>
            <Plus className="h-4 w-4" />
            Add Event
          </Button>
        </div>

        {/* Create form */}
        {showForm && (
          <form
            onSubmit={handleSubmit}
            className="border rounded-lg p-4 space-y-4"
          >
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium block mb-1">Date</label>
                <input
                  type="date"
                  value={formDate}
                  onChange={(e) => setFormDate(e.target.value)}
                  className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                  required
                />
              </div>
              <div>
                <label className="text-sm font-medium block mb-1">Category</label>
                <select
                  value={formCategory}
                  onChange={(e) => setFormCategory(e.target.value as EventCategory)}
                  className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                >
                  {CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {EVENT_CATEGORY_LABELS[cat]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium block mb-1">Title</label>
              <input
                type="text"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                placeholder="e.g., Published blog post about SDK v2"
                required
              />
            </div>
            <div>
              <label className="text-sm font-medium block mb-1">
                Description (optional)
              </label>
              <textarea
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm min-h-[80px]"
                placeholder="Additional details..."
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit" size="sm">
                Create Event
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowForm(false)}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}

        {/* Events table */}
        {!loading && events.length > 0 && (
          <div className="border rounded-lg">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left px-4 py-2 font-medium">Date</th>
                    <th className="text-left px-4 py-2 font-medium">Title</th>
                    <th className="text-left px-4 py-2 font-medium">Category</th>
                    <th className="text-left px-4 py-2 font-medium">Source</th>
                    <th className="text-right px-4 py-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) => (
                    <tr key={event.id} className="border-b last:border-0">
                      <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">
                        {event.date}
                      </td>
                      <td className="px-4 py-2">
                        <div className="font-medium">{event.title}</div>
                        {event.description && (
                          <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                            {event.description}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <Badge
                          variant="outline"
                          className="text-xs"
                          style={{
                            borderColor: EVENT_CATEGORY_COLORS[event.category],
                            color: EVENT_CATEGORY_COLORS[event.category],
                          }}
                        >
                          {EVENT_CATEGORY_LABELS[event.category]}
                        </Badge>
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {event.source}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {event.source === "manual" && (
                          <button
                            onClick={() => handleDelete(event.id)}
                            className="text-muted-foreground hover:text-destructive transition-colors"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!loading && events.length === 0 && (
          <div className="flex items-center justify-center h-48 text-muted-foreground">
            No events found. Create manual events or run the data collector to auto-detect releases.
          </div>
        )}
      </div>
    </div>
  );
}
