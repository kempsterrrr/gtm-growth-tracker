"use client";

import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Bar,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Legend,
} from "recharts";
import { EVENT_CATEGORY_COLORS } from "@/lib/types/events";
import type { EventCategory } from "@/lib/types/events";

interface MetricSeries {
  key: string;
  label: string;
  color: string;
  type: "line" | "bar" | "area";
}

interface ChartEvent {
  date: string;
  title: string;
  category: EventCategory;
  description?: string;
}

interface TimeSeriesChartProps {
  data: Array<Record<string, string | number>>;
  metrics: MetricSeries[];
  events?: ChartEvent[];
  height?: number;
  showLegend?: boolean;
}

function formatXAxisDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatTooltipValue(value: number) {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return value.toLocaleString();
}

interface TooltipPayloadEntry {
  name: string;
  value: number;
  color: string;
  dataKey: string;
}

function CustomTooltip({
  active,
  payload,
  label,
  events,
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string;
  events?: ChartEvent[];
}) {
  if (!active || !payload || !label) return null;

  const dayEvents = events?.filter((e) => e.date === label) || [];

  return (
    <div className="bg-popover text-popover-foreground border rounded-lg p-3 shadow-lg text-sm">
      <p className="font-medium mb-1">
        {new Date(label).toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric",
        })}
      </p>
      {payload.map((entry, i) => (
        <div key={i} className="flex items-center gap-2">
          <div
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-muted-foreground">{entry.name}:</span>
          <span className="font-medium">{formatTooltipValue(entry.value)}</span>
        </div>
      ))}
      {dayEvents.length > 0 && (
        <div className="mt-2 pt-2 border-t">
          {dayEvents.map((event, i) => (
            <div key={i} className="flex items-center gap-2">
              <div
                className="w-2 h-2 rounded-full"
                style={{
                  backgroundColor: EVENT_CATEGORY_COLORS[event.category],
                }}
              />
              <span className="text-xs">{event.title}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function TimeSeriesChart({
  data,
  metrics,
  events,
  height = 350,
  showLegend = true,
}: TimeSeriesChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
        <XAxis
          dataKey="date"
          tickFormatter={formatXAxisDate}
          tick={{ fontSize: 12 }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tickFormatter={(v) => formatTooltipValue(v)}
          tick={{ fontSize: 12 }}
          tickLine={false}
          axisLine={false}
          width={60}
        />
        <Tooltip content={<CustomTooltip events={events} />} />
        {showLegend && <Legend />}

        {metrics.map((metric) => {
          switch (metric.type) {
            case "bar":
              return (
                <Bar
                  key={metric.key}
                  dataKey={metric.key}
                  name={metric.label}
                  fill={metric.color}
                  opacity={0.8}
                  radius={[2, 2, 0, 0]}
                />
              );
            case "area":
              return (
                <Area
                  key={metric.key}
                  dataKey={metric.key}
                  name={metric.label}
                  stroke={metric.color}
                  fill={metric.color}
                  fillOpacity={0.1}
                  strokeWidth={2}
                />
              );
            case "line":
            default:
              return (
                <Line
                  key={metric.key}
                  dataKey={metric.key}
                  name={metric.label}
                  stroke={metric.color}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              );
          }
        })}

        {events?.map((event, i) => (
          <ReferenceLine
            key={`event-${i}`}
            x={event.date}
            stroke={EVENT_CATEGORY_COLORS[event.category]}
            strokeDasharray="4 4"
            strokeWidth={1.5}
            label={{
              value: event.title.length > 20 ? event.title.slice(0, 20) + "..." : event.title,
              position: "top",
              fill: EVENT_CATEGORY_COLORS[event.category],
              fontSize: 10,
            }}
          />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
