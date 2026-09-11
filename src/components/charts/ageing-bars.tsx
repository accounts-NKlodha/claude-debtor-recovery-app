"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatInrCompact } from "@/lib/utils";
import { ChartFrame } from "./chart-frame";

export function AgeingBars({
  data,
}: {
  data: Array<{ bucket: string; amount: number }>;
}) {
  const peak = data.reduce((m, d) => (d.amount > m.amount ? d : m), data[0]);
  return (
    <ChartFrame
      title="Outstanding by ageing bucket"
      summary={`Largest exposure is the ${peak.bucket} day bucket at ${formatInrCompact(peak.amount)}.`}
      table={{
        columns: ["Ageing (days)", "Amount"],
        rows: data.map((d) => [d.bucket, formatInrCompact(d.amount)]),
      }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="bucket"
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            stroke="var(--border)"
          />
          <YAxis
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            tickFormatter={(v: number) => formatInrCompact(v)}
            width={56}
            stroke="var(--border)"
          />
          <Tooltip
            cursor={{ fill: "var(--muted)" }}
            contentStyle={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: 12,
              color: "var(--foreground)",
            }}
            formatter={((v: number) => [formatInrCompact(v), "Outstanding"]) as never}
          />
          <Bar dataKey="amount" fill="var(--primary)" radius={[4, 4, 0, 0]} maxBarSize={48} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
