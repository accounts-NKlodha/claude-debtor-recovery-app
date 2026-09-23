import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "outline" | "ghost" | "danger";
type Size = "sm" | "md" | "lg" | "icon";

const variants: Record<Variant, string> = {
  primary:
    "bg-primary text-primary-foreground shadow-xs hover:bg-[color-mix(in_srgb,var(--primary),black_10%)] disabled:opacity-50",
  secondary:
    "bg-muted text-foreground hover:bg-[color-mix(in_srgb,var(--muted),var(--foreground)_6%)] disabled:opacity-50",
  outline:
    "border border-border bg-card text-foreground shadow-xs hover:bg-muted disabled:opacity-50",
  ghost: "text-foreground hover:bg-muted disabled:opacity-50",
  danger:
    "bg-danger text-white shadow-xs hover:bg-[color-mix(in_srgb,var(--danger),black_10%)] disabled:opacity-50",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-2.5 text-xs gap-1.5",
  md: "h-9 px-3.5 text-sm gap-2",
  lg: "h-10 px-5 text-sm gap-2",
  icon: "h-9 w-9",
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex select-none items-center justify-center rounded-md font-medium transition-[background-color,color,box-shadow,opacity] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed [&_svg]:shrink-0",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = "Button";
