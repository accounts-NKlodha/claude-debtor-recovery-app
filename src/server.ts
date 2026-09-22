// Node dev/preview entry (Nitro's default Node preset). This is what
// `vite dev` / `vite preview` run locally on this laptop -- separate from
// the Cloudflare Worker entry Nitro generates for a Worker build/deploy.
export default {
  async fetch(request: Request) {
    const { default: handler } = await import("@tanstack/react-start/server-entry");
    return (handler as { fetch: (r: Request) => Promise<Response> }).fetch(request);
  },
};
