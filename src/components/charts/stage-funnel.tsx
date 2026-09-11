"use client";

import { formatInrCompact } from "@/lib/utils";
import { ChartFrame } from "./chart-frame";

/** Lightweight horizontal funnel — no Recharts funnel dependency needed. */
export function StageFunnel({
  data,
}: {
  data: Array<{ stage: string; cases: number; value: number }>;
}) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <ChartFrame
      title="Recovery stage funnel"
      summary={data.map((d) => `${d.stage}: ${d.cases} cases, ${formatInrCompact(d.value)}`).join("; ")}
      height={data.length * 44}
      table={{
        columns: ["Stage", "Cases", "Value"],
        rows: data.map((d) => [d.stage, d.cases, formatInrCompact(d.value)]),
      }}
    >
      <div className="flex h-full flex-col justify-between gap-1.5">
        {data.map((d) => (
          <div key={d.stage} className="flex items-center gap-3">
            <span className="w-24 shrink-0 text-xs text-muted-foreground">{d.stage}</span>
            <div className="relative h-6 flex-1 rounded-sm bg-muted">
              <div
                className="flex h-full items-center rounded-sm bg-primary/80 px-2 text-[11px] font-medium text-primary-foreground"
                style={{ width: `${Math.max(8, (d.value / max) * 100)}%` }}
              >
                {formatInrCompact(d.value)}
              </div>
            </div>
            <span className="w-14 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
              {d.cases} case{d.cases === 1 ? "" : "s"}
            </span>
          </div>
        ))}
      </div>
    </ChartFrame>
  );
}
