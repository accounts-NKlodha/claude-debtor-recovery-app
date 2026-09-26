/**
 * Global kill switch (automation.enabled = false) on EVERY external send path.
 * Adapters are faked, so nothing is ever sent; the point is that with the
 * switch engaged no provider adapter (SMTP or AiSensy) is reached, nothing is
 * recorded as sent, the workflow does not advance, and the block is audited.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as mock from "@/lib/mock-data";
import type { MutationActor } from "@/lib/auth/types";
import type { RecoveryCase } from "@/contract/types";
import { WHATSAPP_MESSAGE_KINDS, WHATSAPP_TEMPLATES } from "@/domain/whatsapp-templates";

vi.mock("server-only", () => ({}));

const fakeEmail = { name: "fake-gmail", send: vi.fn(), parseWebhook: () => null };
const fakeWhatsapp = { name: "fake-aisensy", send: vi.fn(), parseWebhook: () => null };
vi.mock("@/adapters", () => ({
  getAdapters: () => ({ email: fakeEmail, whatsapp: fakeWhatsapp }),
  isLiveWhatsAppConfigured: () => true,
}));

import { MemoryRepository } from "./memory";

const repo = new MemoryRepository({ allowLiveWhatsApp: true });
const staff: MutationActor = { actorId: "test-staff-killswitch", actorRole: "staff" };
const admin: MutationActor = { actorId: "test-admin-killswitch", actorRole: "admin" };

const OK = (ref: string | null = null) => ({
  outcome: "success" as const, providerRef: ref, errorCode: null, evidenceRefs: [], nextAction: null, data: { providerMessageId: ref ?? "" },
});

afterEach(() => vi.unstubAllEnvs());
beforeEach(async () => {
  for (const k of WHATSAPP_MESSAGE_KINDS) vi.stubEnv(WHATSAPP_TEMPLATES[k].campaignEnvVar, `Campaign ${k}`);
  fakeEmail.send.mockReset();
  fakeWhatsapp.send.mockReset();
  fakeEmail.send.mockResolvedValue(OK("<e@mail>"));
  fakeWhatsapp.send.mockResolvedValue(OK());
  await repo.setAutomationState(true, "test reset", admin);
  mock.updateOrganisationPaymentDetails("org-1", "acme@okaxis", "Acme Industrial Payee");
});

let seq = 0;
function seed(status: RecoveryCase["status"], over: { mobile?: string | null; email?: string | null; nextScheduledAt?: string | null } = {}) {
  const id = `case-ks-${++seq}`;
  const base = mock.getCase("case-1")!;
  const debtor = mock.getDebtor(base.debtorId)!;
  mock.insertDebtor({
    ...debtor, id: `deb-${id}`, name: "Kill Switch Test Customer",
    mobile: over.mobile !== undefined ? over.mobile : "9876500011",
    email: over.email !== undefined ? over.email : "debtor@example.com",
  });
  mock.insertCase({
    ...base, id, debtorId: `deb-${id}`, status, closedAt: null,
    nextScheduledAt: over.nextScheduledAt === undefined ? null : over.nextScheduledAt,
  });
  const baseInvoice = mock.listInvoicesForCase("case-1")[0];
  mock.insertInvoice({
    ...baseInvoice, id: `inv-${id}`, caseId: id, invoiceNumber: "KS-001", invoiceTotal: 1_000_00,
    outstandingBalance: 1_000_00, dueDate: "2026-09-18",
  });
  return id;
}

const noProviderCalled = () => {
  expect(fakeEmail.send).not.toHaveBeenCalled();
  expect(fakeWhatsapp.send).not.toHaveBeenCalled();
};

describe("kill switch engaged (automation.enabled = false)", () => {
  it("blocks BOTH channels of the initial reminder: no provider call, nothing recorded, case not advanced, block audited", async () => {
    const id = seed("active");
    await repo.setAutomationState(false, "engage kill switch", admin);

    await expect(repo.sendInitialReminder(id, staff)).rejects.toThrow(/kill switch/i);

    noProviderCalled();
    expect(await repo.listCommunicationsForCase(id)).toHaveLength(0);
    expect(mock.getCase(id)!.status).toBe("active");
    const blocked = (await repo.listAuditLog(50)).filter((a) => a.action === "communication.send_blocked" && a.entityId === id);
    expect(blocked.length).toBeGreaterThan(0);
    expect(blocked[0].reason).toMatch(/kill switch engaged/);
  });

  it("blocks an email-only initial reminder (the previously unguarded leg)", async () => {
    const id = seed("active", { mobile: null });
    await repo.setAutomationState(false, "engage kill switch", admin);
    await expect(repo.sendInitialReminder(id, staff)).rejects.toThrow(/kill switch/i);
    noProviderCalled();
    expect(await repo.listCommunicationsForCase(id)).toHaveLength(0);
    expect(mock.getCase(id)!.status).toBe("active");
  });

  it("blocks the WhatsApp follow-up: no provider call, nothing sent, case unchanged", async () => {
    const id = seed("initial_communication_sent", { nextScheduledAt: "2026-09-01T00:00:00Z" });
    const [offer] = (await repo.getWhatsAppOffers(id)).filter((o) => o.kind === "followup_reminder");
    expect(offer.status).toBe("available");
    await repo.setAutomationState(false, "engage kill switch", admin);

    const outcome = await repo.sendWhatsAppMessage(id, { eventKey: offer.eventKey! }, staff).then(
      (r) => r.status,
      () => "rejected",
    );
    expect(outcome).not.toBe("accepted");
    noProviderCalled();
    expect(await repo.listCommunicationsForCase(id)).toHaveLength(0);
    expect(mock.getCase(id)!.status).toBe("initial_communication_sent");
  });

  it("leaves no residue: once re-enabled, the same send goes through normally (no stuck queued record)", async () => {
    const id = seed("active");
    await repo.setAutomationState(false, "engage kill switch", admin);
    await expect(repo.sendInitialReminder(id, staff)).rejects.toThrow();

    await repo.setAutomationState(true, "re-enable", admin);
    const result = await repo.sendInitialReminder(id, staff);
    expect(result.ambiguous).toBe(false);
    expect(fakeEmail.send).toHaveBeenCalledTimes(1);
    expect(fakeWhatsapp.send).toHaveBeenCalledTimes(1);
    expect(result.communications.map((c) => c.deliveryStatus)).toEqual(["sent", "sent"]);
  });
});

describe("automation enabled (automation.enabled = true)", () => {
  it("permits the send and advances the case", async () => {
    const id = seed("active");
    const result = await repo.sendInitialReminder(id, staff);
    expect(fakeEmail.send).toHaveBeenCalledTimes(1);
    expect(fakeWhatsapp.send).toHaveBeenCalledTimes(1);
    expect(result.case.status).not.toBe("active");
  });

  it("idempotency is unchanged: a repeated submission does not re-send", async () => {
    const id = seed("active");
    await repo.sendInitialReminder(id, staff);
    await repo.sendInitialReminder(id, staff).catch(() => undefined);
    expect(fakeEmail.send).toHaveBeenCalledTimes(1);
    expect(fakeWhatsapp.send).toHaveBeenCalledTimes(1);
  });

  it("a disabled switch blocks a repeat too, without touching the already-recorded send", async () => {
    const id = seed("active");
    await repo.sendInitialReminder(id, staff);
    const before = await repo.listCommunicationsForCase(id);
    await repo.setAutomationState(false, "engage kill switch", admin);
    await expect(repo.sendInitialReminder(id, staff)).rejects.toThrow(/kill switch/i);
    expect(await repo.listCommunicationsForCase(id)).toHaveLength(before.length);
    expect(fakeEmail.send).toHaveBeenCalledTimes(1);
  });
});

describe("send-path inventory (drift guard)", () => {
  /** Every place application code reaches a messaging adapter must be a repository send choke point that calls the guard first. */
  it("only the two repository choke points reach an email/WhatsApp adapter, and each is preceded by the guard", () => {
    const root = join(__dirname, "..", "..");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(p);
      }
    };
    walk(root);
    const users = files.filter((f) => /getAdapters\(\)\.(email|whatsapp)/.test(readFileSync(f, "utf8")));
    expect(users.map((f) => f.replace(root, "").replace(/\\/g, "/")).sort()).toEqual([
      "/server/repositories/memory.ts",
      "/server/repositories/supabase.ts",
    ]);
    for (const f of users) {
      const src = readFileSync(f, "utf8");
      const send = src.indexOf("getAdapters().whatsapp : getAdapters().email");
      const guard = src.lastIndexOf("assertSendsPermitted(", send);
      expect(guard, `${f}: guard must precede the adapter call`).toBeGreaterThan(-1);
      // and sendInitialReminder gates before planning any channel
      expect(src).toMatch(/async sendInitialReminder[\s\S]{0,2500}assertSendsPermitted\(/);
    }
  });
});
