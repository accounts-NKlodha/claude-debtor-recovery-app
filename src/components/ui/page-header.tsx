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
    <div className={cn("flex flex-col gap-4 border-b border-border pb-4", className)}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1.5">
          {eyebrow ? (
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {eyebrow}
            </p>
          ) : null}
          <h1
            className={cn(
              "font-semibold tracking-tight",
              size === "hero" ? "text-2xl sm:text-3xl" : "text-lg",
            )}
          >
            {title}
          </h1>
          {description ? (
            <p className="text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}
