"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ResponsiveContainer, LineChart, Line } from "recharts";

interface SparklineCardProps {
  title: string;
  value: string | number;
  data: Array<{ date: string; value: number }>;
  color?: string;
}

export function SparklineCard({
  title,
  value,
  data,
  color = "var(--chart-1)",
}: SparklineCardProps) {
  const formattedValue =
    typeof value === "number" ? value.toLocaleString() : value;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-lg font-bold mb-2">{formattedValue}</div>
        <div className="h-12">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <Line
                type="monotone"
                dataKey="value"
                stroke={color}
                strokeWidth={1.5}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
