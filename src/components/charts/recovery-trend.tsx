"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatInrCompact } from "@/lib/utils";
import { ChartFrame } from "./chart-frame";

export function RecoveryTrend({
  data,
}: {
  data: Array<{ date: string; recovered: number; newDebt: number }>;
}) {
  const total = data.reduce((s, d) => s + d.recovered, 0);
  return (
    <ChartFrame
      title="30-day recovery trend"
      summary={`Total recovered over the window is ${formatInrCompact(total)}. Daily recovered versus new debt added.`}
      table={{
        columns: ["Date", "Recovered", "New debt"],
        rows: data.map((d) => [d.date, formatInrCompact(d.recovered), formatInrCompact(d.newDebt)]),
      }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="rt-rec" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.25} />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            tickFormatter={(v: string) => v.slice(5)}
            interval="preserveStartEnd"
            stroke="var(--border)"
          />
          <YAxis
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            tickFormatter={(v: number) => formatInrCompact(v)}
            width={56}
            stroke="var(--border)"
          />
          <Tooltip
            contentStyle={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: 12,
              color: "var(--foreground)",
            }}
            formatter={
              ((v: number, n: string) => [
                formatInrCompact(v),
                n === "recovered" ? "Recovered" : "New debt",
              ]) as never
            }
          />
          <Area
            type="monotone"
            dataKey="recovered"
            stroke="var(--primary)"
            strokeWidth={2}
            fill="url(#rt-rec)"
          />
          <Area
            type="monotone"
            dataKey="newDebt"
            stroke="var(--warning)"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            fill="none"
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
