import * as React from "react";
import { cn } from "@/lib/utils";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  size = "default",
  className,
  children,
}: {
  /** Small uppercase label above the title, e.g. "CLIENT OVERVIEW" or a date. */
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  /** "hero" is for a screen's primary landing header (Today, Overview); larger title. */
  size?: "default" | "hero";
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-4 border-b border-border pb-5", className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          {eyebrow ? (
            <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">{eyebrow}</p>
          ) : null}
          <h1
            className={cn(
              "font-semibold tracking-tight text-foreground",
              size === "hero" ? "text-2xl sm:text-[1.75rem] sm:leading-9" : "text-xl",
            )}
          >
            {title}
          </h1>
          {description ? (
            <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}
