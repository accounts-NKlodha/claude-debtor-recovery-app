"use client";

import * as React from "react";
import { Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";

function readTheme(): "light" | "dark" {
  if (typeof document === "undefined") return "light";
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "light" || attr === "dark") return attr;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function subscribe(cb: () => void) {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

export function ThemeToggle() {
  const theme = React.useSyncExternalStore(subscribe, readTheme, () => "light" as const);
  const [override, setOverride] = React.useState<"light" | "dark" | null>(null);
  const effective = override ?? theme;

  const toggle = () => {
    const next = effective === "dark" ? "light" : "dark";
    setOverride(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("dr-theme", next);
    } catch {
      /* ignore */
    }
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={`Switch to ${effective === "dark" ? "light" : "dark"} theme`}
    >
      {effective === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}
