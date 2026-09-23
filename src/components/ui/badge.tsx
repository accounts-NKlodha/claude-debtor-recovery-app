import * as React from "react";
import { cn } from "@/lib/utils";

export type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "primary";

const tones: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground ring-border",
  success: "bg-success-bg text-success ring-success/20",
  warning: "bg-warning-bg text-warning ring-warning/25",
  danger: "bg-danger-bg text-danger ring-danger/20",
  info: "bg-info-bg text-info ring-info/20",
  primary: "bg-accent text-accent-foreground ring-accent-foreground/15",
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  icon?: React.ReactNode;
}

export function Badge({ className, tone = "neutral", icon, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset",
        tones[tone],
        className,
      )}
      {...props}
    >
      {icon ? <span className="shrink-0 [&_svg]:h-3 [&_svg]:w-3">{icon}</span> : null}
      {children}
    </span>
  );
}
