/**
 * TanStack Start adapter for src/app/page.tsx -- the role-aware landing
 * redirect (M1 Batch 1). Supersedes the M0 boot-test placeholder (accepted
 * as PASS; no longer needed once real routes exist to prove the toolchain
 * against). Redirect decided server-side in beforeLoad so it happens before
 * any render, same as every other guard on this branch.
 */
import { createFileRoute, redirect } from "@tanstack/react-router";
import { getLandingRedirect } from "@/lib/root-landing.functions";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    const { to } = await getLandingRedirect();
    throw redirect({ to });
  },
});
