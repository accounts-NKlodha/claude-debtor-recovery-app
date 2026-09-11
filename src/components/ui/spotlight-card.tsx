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
        tone === "primary" && "border-primary/30 bg-accent/40",
        className,
      )}
    >
      <CardContent className="flex flex-col gap-3 p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {eyebrow}
        </p>
        <h3 className="text-base font-semibold tracking-tight">{title}</h3>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        {action || secondaryAction ? (
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {action}
            {secondaryAction}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
