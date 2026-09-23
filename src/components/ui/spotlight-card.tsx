import * as React from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";

/**
 * The recurring "single most important thing to do" card from the approved
 * wireframes (Today's "Next best action", Case's "Next safe action", Client's
 * "Most important action"). One title, one description, one primary CTA.
 */
export function SpotlightCard({
  eyebrow,
  title,
  description,
  action,
  secondaryAction,
  tone = "primary",
  className,
}: {
  eyebrow: string;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  secondaryAction?: React.ReactNode;
  tone?: "primary" | "neutral";
  className?: string;
}) {
  return (
    <Card
      className={cn(
        "relative overflow-hidden",
        tone === "primary" && "border-primary/25 bg-[color-mix(in_srgb,var(--accent)_45%,var(--card))]",
        className,
      )}
    >
      {tone === "primary" ? <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1 bg-primary" /> : null}
      <CardContent className="flex flex-col gap-2 p-5 pl-6">
        <p
          className={cn(
            "text-[11px] font-semibold uppercase tracking-wider",
            tone === "primary" ? "text-primary" : "text-muted-foreground",
          )}
        >
          {eyebrow}
        </p>
        <h3 className="text-base font-semibold tracking-tight text-foreground">{title}</h3>
        {description ? <p className="text-sm leading-relaxed text-muted-foreground">{description}</p> : null}
        {action || secondaryAction ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {action}
            {secondaryAction}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
