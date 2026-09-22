import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";

// Minimal end-to-end proof: a server function actually running server-side
// (not just static client rendering), returning something only computable
// on the server (process.versions.node is undefined in the browser).
const getServerInfo = createServerFn({ method: "GET" }).handler(async () => ({
  runtime: typeof process !== "undefined" && process.versions?.node ? `node ${process.versions.node}` : "non-node runtime",
  now: new Date().toISOString(),
}));

export const Route = createFileRoute("/")({
  component: Home,
  loader: () => getServerInfo(),
});

function Home() {
  const info = Route.useLoaderData();
  return (
    <main style={{ fontFamily: "system-ui", padding: 32 }}>
      <h1>TanStack Start toolchain: booted</h1>
      <p>Server function executed on: {info.runtime}</p>
      <p>Server timestamp: {info.now}</p>
    </main>
  );
}
