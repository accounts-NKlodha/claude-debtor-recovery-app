import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type = "text", ...props }, ref) => (
  <input
    ref={ref}
    type={type}
    className={cn(
      "flex h-9 w-full rounded-md border border-input bg-card px-3 py-1 text-sm text-foreground shadow-xs transition-[border-color,box-shadow] placeholder:text-muted-foreground/80 hover:border-[color-mix(in_srgb,var(--input),var(--foreground)_15%)] focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring/40 aria-[invalid=true]:border-danger disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";
