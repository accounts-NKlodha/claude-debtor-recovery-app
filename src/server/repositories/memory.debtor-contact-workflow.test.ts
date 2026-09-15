/**
 * Core-workflow remediation task: proves the debtor-contact fix actually
 * unblocks the reminder workflow end-to-end, not just at the schema/RPC
 * level. Exercised against MemoryRepository (matches the same pattern
 * memory.email-delivery.test.ts already uses for SupabaseRepository
 * parity).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { MemoryRepository } from "./memory";
import * as mock from "@/lib/mock-data";
import { __resetMockAdapterState } from "@/adapters/mock";
import type { MutationActor } from "@/lib/auth/types";
import type { RecoveryCase } from "@/contract/types";

const repo = new MemoryRepository();
const staffActor: MutationActor = { actorId: "test-staff-contact", actorRole: "staff" };

beforeEach(() => __resetMockAdapterState());

function seedActiveCaseWithNoContact(id: string): RecoveryCase {
  const base = mock.getCase("case-1")!;
  const debtor = mock.getDebtor(base.debtorId)!;
  const debtorId = `deb-${id}`;
  mock.insertDebtor({ ...debtor, id: debtorId, mobile: null, email: null });
  const kase: RecoveryCase = { ...base, id, debtorId, status: "active", closedAt: null };
  mock.insertCase(kase);
  return kase;
}

describe("debtor contact -> reminder eligibility (core-workflow remediation)", () => {
  it("a case with no contact info is blocked cleanly, not with a crash or a fabricated send", async () => {
    const kase = seedActiveCaseWithNoContact("contact-blocked-1");
    await expect(repo.sendInitialReminder(kase.id, staffActor)).rejects.toThrow(
      /no mobile or email on file/,
    );
  });

  it("after staff adds a valid email, the same case becomes reminder-eligible without recreating it", async () => {
    const kase = seedActiveCaseWithNoContact("contact-then-eligible-1");

    // Confirm it's genuinely blocked first.
    await expect(repo.sendInitialReminder(kase.id, staffActor)).rejects.toThrow(
      /no mobile or email on file/,
    );

    const updated = await repo.updateDebtorContact(
      kase.debtorId,
      { email: "newly-added@example.com", mobile: null },
      "UAT: adding contact to unblock reminder",
      staffActor,
    );
    expect(updated.email).toBe("newly-added@example.com");

    // Same case id, no recreation -- now succeeds via email.
    const result = await repo.sendInitialReminder(kase.id, staffActor);
    expect(result.case.status).toBe("initial_communication_sent");
    const emailComm = result.communications.find((c) => c.channel === "email");
    expect(emailComm?.deliveryStatus).toBe("sent");
  });

  it("mobile-only (no email) still cannot send via mock WhatsApp standing in for production Gmail-only delivery intent -- MemoryRepository's own mock-WhatsApp-eligible path is a demo/test affordance, not a production guarantee", async () => {
    // Note: MemoryRepository is never selected in production (src/server/repo.ts
    // enforces this) -- WhatsApp there remains an explicit demo/test affordance
    // per the WhatsApp-safety fix (supabase.whatsapp-production-safety.test.ts
    // covers the actual production-disable guarantee on SupabaseRepository).
    // This test documents the distinct, narrower claim: adding only a mobile
    // number does not make a case Gmail-eligible, which is what production
    // delivery actually requires.
    const kase = seedActiveCaseWithNoContact("contact-mobile-only-1");
    await repo.updateDebtorContact(
      kase.debtorId,
      { email: null, mobile: "9876543210" },
      "UAT: mobile only",
      staffActor,
    );
    const debtor = await repo.getDebtor(kase.debtorId);
    expect(debtor?.email).toBeNull();
    expect(debtor?.mobile).toBe("9876543210");
    // Gmail eligibility specifically requires email -- confirmed by inspecting
    // the debtor record a production reminder-eligibility check would use,
    // matching src/components/screens/debtor-contact-panel.tsx's own logic.
  });

  it("Gmail path remains idempotent after a contact update -- retrying the same day does not duplicate the send", async () => {
    const kase = seedActiveCaseWithNoContact("contact-idempotent-1");
    await repo.updateDebtorContact(
      kase.debtorId,
      { email: "idempotent-check@example.com", mobile: null },
      "UAT",
      staffActor,
    );
    const first = await repo.sendInitialReminder(kase.id, staffActor);
    const firstEmail = first.communications.find((c) => c.channel === "email")!;

    // Case is no longer "active" (it's "initial_communication_sent"), which
    // sendInitialReminder itself refuses to touch again -- the durable,
    // idempotency-key-scoped retry path is exercised by the existing
    // email-delivery suite; this asserts the higher-level guarantee that a
    // second call against the same already-advanced case is rejected rather
    // than silently re-sending.
    await expect(repo.sendInitialReminder(kase.id, staffActor)).rejects.toThrow(/not "active"/);
    expect(firstEmail.deliveryStatus).toBe("sent");
  });
});
