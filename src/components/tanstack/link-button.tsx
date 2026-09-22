/**
 * TanStack Start adapter for src/components/ui/link-button.tsx -- identical
 * markup/behavior, only `next/link`'s <Link href> swapped for TanStack
 * Router's <Link to>. Only exists on the TanStack port branch; the Next.js
 * original is untouched and still used by every existing Next.js page.
 */
import * as React from "react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

type Variant = "primary" | "outline" | "ghost";
const variants: Record<Variant, string> = {
  primary: "bg-primary text-primary-foreground hover:opacity-90",
  outline: "border border-border bg-card text-foreground hover:bg-muted",
  ghost: "text-foreground hover:bg-muted",
};

export function LinkButton({
  href,
  variant = "outline",
  className,
  children,
}: {
  href: string;
  variant?: Variant;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={href}
      className={cn(
        "inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring",
        variants[variant],
        className,
      )}
    >
      {children}
    </Link>
  );
}
