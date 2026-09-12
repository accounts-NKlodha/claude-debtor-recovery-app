/** Use configured origin, never Host or forwarded headers, for OAuth redirects. */
export function appOrigin(): string {
  const value = process.env.NEXT_PUBLIC_APP_URL;
  if (!value) throw new Error("NEXT_PUBLIC_APP_URL is required for OAuth");
  const url = new URL(value);
  const local = process.env.NODE_ENV !== "production" &&
    ["localhost", "127.0.0.1"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
      url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("NEXT_PUBLIC_APP_URL must be a secure application origin");
  }
  return url.origin;
}

/** Reject URL forms that browsers can interpret as an external redirect. */
export function safeNext(value: string | null, fallback = "/dashboard"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") ||
      /[\\\s%]/.test(value)) return fallback;
  const url = new URL(value, "https://app.invalid");
  if (url.origin !== "https://app.invalid" || url.pathname.startsWith("/auth/") ||
      url.pathname.startsWith("/sign-in")) return fallback;
  return url.pathname + url.search;
}
