import { describe, expect, it } from "vitest";
import {
  applyReminderDelivered,
  applyReminderDeliveryFailed,
  applyReminderSent,
  buildReminderMessage,
} from "./reminder";
import type { RecoveryCase } from "@/contract/types";

const activeCase: RecoveryCase = {
  id: "case-10",
  organisationId: "org-2",
  debtorId: "deb-4",
  status: "active",
  automationMode: "assist",
  waitingOn: "system",
  automationStartedAt: "2026-09-10T05:30:00.000Z",
  currentStep: "Certification + validation + age gate cleared",
  blocker: null,
  nextScheduledAction: "Send initial reminder at next 11:00 IST window",
  nextScheduledAt: "2026-09-11T05:30:00.000Z",
  eligibilityRoute: null,
  principalOutstanding: 55_00_000,
  recoveredToDate: 0,
  assigneeId: "user-2",
  groupKey: null,
  createdAt: "2026-09-08T05:30:00.000Z",
  activatedAt: "2026-09-10T05:30:00.000Z",
  closedAt: null,
};

describe("buildReminderMessage", () => {
  it("formats an INR amount and invoice reference", () => {
    const msg = buildReminderMessage({
      legalEntityName: "Vertex Polymers LLP",
      debtorName: "Highline Interiors LLP",
      invoiceNumber: "VTX/2026/1305",
      amountPaise: 55_00_000,
    });
    expect(msg).toContain("Vertex Polymers LLP");
    expect(msg).toContain("VTX/2026/1305");
    expect(msg).toMatch(/₹55,000/);
  });
});

describe("reminder workflow bridge", () => {
  it("moves active -> initial_communication_sent on send", () => {
    const { updatedCase } = applyReminderSent(activeCase);
    expect(updatedCase.status).toBe("initial_communication_sent");
    expect(updatedCase.waitingOn).toBe("system");
  });

  it("starts the 24h timer only once delivery is confirmed", () => {
    const sent = applyReminderSent(activeCase).updatedCase;
    const deliveredAt = new Date("2026-09-11T05:30:00.000Z");
    const { updatedCase } = applyReminderDelivered(sent, deliveredAt);
    expect(updatedCase.nextScheduledAt).toBe("2026-09-12T05:30:00.000Z");
  });

  it("pauses escalation and clears the timer when both channels fail", () => {
    const sent = applyReminderSent(activeCase).updatedCase;
    const { updatedCase } = applyReminderDeliveryFailed(sent, true);
    expect(updatedCase.status).toBe("contact_update_required");
    expect(updatedCase.waitingOn).toBe("client");
    expect(updatedCase.nextScheduledAt).toBeNull();
  });
});
