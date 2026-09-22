/**
 * Placeholder ONLY -- the client-facing surface is explicitly out of scope
 * for this vertical slice (M0-R1). This route exists solely so the
 * `_internal` guard's real redirect target ("a client actor is always
 * redirected to /client") resolves to an actual page instead of a 404,
 * which matters for verifying client isolation end-to-end. No client pages
 * are ported here.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/client")({
  component: () => (
    <div style={{ fontFamily: "system-ui", padding: 32 }}>
      <h1>Client area</h1>
      <p>Not yet ported (out of scope for this vertical slice).</p>
    </div>
  ),
});
