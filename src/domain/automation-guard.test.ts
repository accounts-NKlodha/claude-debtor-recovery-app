import { describe, expect, it, vi } from "vitest";
import { AutomationDisabledError, assertAutomationEnabled } from "./automation-guard";

describe("assertAutomationEnabled", () => {
  it("passes when automation is enabled and does not audit", async () => {
    const onBlocked = vi.fn();
    await expect(assertAutomationEnabled(async () => true, onBlocked)).resolves.toBeUndefined();
    expect(onBlocked).not.toHaveBeenCalled();
  });

  it("blocks and audits when the kill switch is engaged", async () => {
    const onBlocked = vi.fn(async () => {});
    await expect(assertAutomationEnabled(async () => false, onBlocked)).rejects.toBeInstanceOf(AutomationDisabledError);
    expect(onBlocked).toHaveBeenCalledWith(expect.stringMatching(/kill switch engaged/));
  });

  it("fails closed when the state cannot be read", async () => {
    const onBlocked = vi.fn(async () => {});
    await expect(
      assertAutomationEnabled(async () => {
        throw new Error("rls hides the row");
      }, onBlocked),
    ).rejects.toThrow(/could not be verified/);
    expect(onBlocked).toHaveBeenCalledWith(expect.stringMatching(/could not be verified/));
  });

  it("still blocks if the audit write itself fails", async () => {
    await expect(
      assertAutomationEnabled(
        async () => false,
        async () => {
          throw new Error("audit down");
        },
      ),
    ).rejects.toBeInstanceOf(AutomationDisabledError);
  });
});
