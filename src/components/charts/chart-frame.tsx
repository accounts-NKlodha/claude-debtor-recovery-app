"use client";

import * as React from "react";

/** Accessible wrapper: role=img + summary, with a <details> data-table fallback. */
export function ChartFrame({
  title,
  summary,
  table,
  height = 240,
  children,
}: {
  title: string;
  summary: string;
  table: { columns: string[]; rows: (string | number)[][] };
  height?: number;
  children: React.ReactNode;
}) {
  return (
    <figure className="m-0 flex flex-col gap-2">
      <div role="img" aria-label={`${title}. ${summary}`} style={{ width: "100%", height }}>
        {children}
      </div>
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none">View data for {title}</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr>
                {table.columns.map((c) => (
                  <th key={c} className="border-b border-border py-1 pr-4 font-medium">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((cell, j) => (
                    <td key={j} className="border-b border-border py-1 pr-4">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
