"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface ChipOption<T extends string> {
  value: T;
  label: string;
  count?: number;
}

/** Count-badged quick-filter row, reused on Today/Cases/Communications. */
export function ChipFilterRow<T extends string>({
  options,
  value,
  onChange,
  "aria-label": ariaLabel,
}: {
  options: ChipOption<T>[];
  value: T;
  onChange: (v: T) => void;
  "aria-label": string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={ariaLabel}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          aria-pressed={value === opt.value}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring",
            value === opt.value
              ? "border-transparent bg-primary text-primary-foreground"
              : "border-border bg-card text-foreground hover:bg-muted",
          )}
        >
          {opt.label}
          {opt.count !== undefined ? (
            <span
              className={cn(
                "rounded-full px-1.5 text-[11px] tabular-nums",
                value === opt.value ? "bg-primary-foreground/20" : "bg-muted text-muted-foreground",
              )}
            >
              {opt.count}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
