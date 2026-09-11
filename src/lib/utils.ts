import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format integer paise as INR with Indian digit grouping (PRD §9). */
export function formatInr(paise: number, opts: { withSymbol?: boolean } = {}): string {
  const { withSymbol = true } = opts;
  const negative = paise < 0;
  const rupees = Math.abs(paise) / 100;
  const s = rupees.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${negative ? "-" : ""}${withSymbol ? "₹" : ""}${s}`;
}

/** Compact INR for dense tiles: ₹1.2L, ₹3.4Cr. */
export function formatInrCompact(paise: number): string {
  const rupees = paise / 100;
  const abs = Math.abs(rupees);
  if (abs >= 1e7) return `₹${(rupees / 1e7).toFixed(2)}Cr`;
  if (abs >= 1e5) return `₹${(rupees / 1e5).toFixed(2)}L`;
  if (abs >= 1e3) return `₹${(rupees / 1e3).toFixed(1)}K`;
  return `₹${rupees.toFixed(0)}`;
}
