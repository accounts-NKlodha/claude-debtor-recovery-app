import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const authorizeStaffMutation = vi.fn();
vi.mock("@/lib/auth/session", () => ({ authorizeStaffMutation: (...a: unknown[]) => authorizeStaffMutation(...a) }));
const recordActivationGate = vi.fn();
vi.mock("@/server/repo", () => ({ getRepo: () => ({ recordActivationGate }) }));

beforeEach(() => {
  authorizeStaffMutation.mockReset();
  recordActivationGate.mockReset();
  authorizeStaffMutation.mockResolvedValue({ actorId: "staff-1", actorRole: "staff" });
});

const form = (o: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(o)) fd.set(k, v);
  return fd;
};
const IDLE = { result: null, error: null };

describe("recordActivationGateAction", () => {
  it("rejects without a session and never touches the repository", async () => {
    authorizeStaffMutation.mockRejectedValue(new Error("no session"));
    const { recordActivationGateAction } = await import("./activation");
    const r = await recordActivationGateAction(IDLE, form({ caseId: "c1", gate: "client_certification", reason: "x" }));
    expect(r.error).toBe("You do not have permission to perform this action.");
    expect(recordActivationGate).not.toHaveBeenCalled();
  });

  it("validates input before authorizing (missing case / unknown gate / empty reason)", async () => {
    const { recordActivationGateAction } = await import("./activation");
    expect((await recordActivationGateAction(IDLE, form({ gate: "client_certification", reason: "x" }))).error).toBe("Missing case.");
    expect((await recordActivationGateAction(IDLE, form({ caseId: "c1", gate: "age_gate", reason: "x" }))).error).toBe("Unknown activation gate.");
    expect((await recordActivationGateAction(IDLE, form({ caseId: "c1", gate: "client_certification", reason: "  " }))).error).toMatch(/reason is required/);
    expect(authorizeStaffMutation).not.toHaveBeenCalled();
  });

  it("the 60-day age gate is not recordable through the action", async () => {
    const { recordActivationGateAction } = await import("./activation");
    expect((await recordActivationGateAction(IDLE, form({ caseId: "c1", gate: "age_gate", reason: "waive" }))).result).toBeNull();
    expect(recordActivationGate).not.toHaveBeenCalled();
  });

  it("passes the authenticated actor (never a browser-supplied identity) and returns a typed result", async () => {
    recordActivationGate.mockResolvedValue({ case: { status: "active" }, gates: { missing: [] }, activated: true });
    const { recordActivationGateAction } = await import("./activation");
    const r = await recordActivationGateAction(IDLE, form({ caseId: "c1", gate: "client_certification", reason: " Certified by email ", actorId: "forged" }));
    expect(r).toEqual({ result: { status: "active", activated: true, missing: [] }, error: null });
    expect(recordActivationGate).toHaveBeenCalledWith("c1", "client_certification", "Certified by email", { actorId: "staff-1", actorRole: "staff" });
  });

  it("returns repository errors instead of throwing", async () => {
    recordActivationGate.mockRejectedValue(new Error("already active"));
    const { recordActivationGateAction } = await import("./activation");
    expect((await recordActivationGateAction(IDLE, form({ caseId: "c1", gate: "client_certification", reason: "x" }))).error).toBe("already active");
  });
});
