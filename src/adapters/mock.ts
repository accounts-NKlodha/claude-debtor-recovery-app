/**
 * Mock adapter implementations (PRD §16). These honour the full failure contract
 * so the orchestrator and UI can be exercised end-to-end without any real
 * provider. Swap for AiSensy / Gmail / GST+MSME runners behind the same
 * interfaces from src/contract/adapters.ts — no call-site changes.
 *
 * Determinism: outcomes are driven by the idempotency key so tests are stable.
 *  - key containing "fail-once"  -> retryable_failure the first time, success after
 *  - key containing "fail-hard"  -> permanent_failure
 *  - key containing "drift"      -> drift_detected
 *  - key containing "human"      -> human_action_required
 */

import type {
  AdapterResult,
  CalendarAdapter,
  GstPortalAdapter,
  MessagingAdapter,
  MsmePortalAdapter,
  OcrAdapter,
  PaymentGatewayAdapter,
  ReplyClassifierAdapter,
  SendMessageInput,
} from "@/contract/adapters";
import type { ReplyClassification } from "@/contract/enums";

const seenKeys = new Set<string>();

function ok<T>(data: T, providerRef: string | null = null, evidenceRefs: string[] = []): AdapterResult<T> {
  return { outcome: "success", providerRef, errorCode: null, evidenceRefs, nextAction: null, data };
}

function outcomeForKey(key: string): AdapterResult | null {
  if (key.includes("fail-hard"))
    return {
      outcome: "permanent_failure",
      providerRef: null,
      errorCode: "MOCK_PERMANENT",
      evidenceRefs: [],
      nextAction: "Raise urgent task; do not retry",
    };
  if (key.includes("drift"))
    return {
      outcome: "drift_detected",
      providerRef: null,
      errorCode: "MOCK_UI_DRIFT",
      evidenceRefs: ["mock://screenshot/drift.png"],
      nextAction: "Fail closed; raise urgent portal-drift task",
    };
  if (key.includes("human"))
    return {
      outcome: "human_action_required",
      providerRef: null,
      errorCode: null,
      evidenceRefs: [],
      nextAction: "Operator must complete CAPTCHA / final submit",
    };
  if (key.includes("fail-once") && !seenKeys.has(key)) {
    seenKeys.add(key);
    return {
      outcome: "retryable_failure",
      providerRef: null,
      errorCode: "MOCK_TRANSIENT",
      evidenceRefs: [],
      nextAction: "Retry once with the same idempotency key",
    };
  }
  return null;
}

export const mockWhatsApp: MessagingAdapter = {
  name: "mock-whatsapp",
  async send(input: SendMessageInput) {
    const pre = outcomeForKey(input.idempotencyKey);
    if (pre) return pre as AdapterResult<{ providerMessageId: string }>;
    return ok({ providerMessageId: `wamid.${input.idempotencyKey}` }, `wamid.${input.idempotencyKey}`);
  },
  parseWebhook(raw) {
    const r = raw as { id?: string; status?: string; timestamp?: string };
    if (!r?.id || !r?.status) return null;
    const status = (["sent", "delivered", "read", "bounced", "failed"].includes(r.status)
      ? r.status
      : "sent") as "sent" | "delivered" | "read" | "bounced" | "failed";
    return { providerMessageId: r.id, status, at: r.timestamp ?? new Date().toISOString() };
  },
};

export const mockGmail: MessagingAdapter = {
  name: "mock-gmail",
  async send(input) {
    const pre = outcomeForKey(input.idempotencyKey);
    if (pre) return pre as AdapterResult<{ providerMessageId: string }>;
    return ok(
      { providerMessageId: `<${input.idempotencyKey}@mail.nklodha.in>` },
      `<${input.idempotencyKey}@mail.nklodha.in>`,
    );
  },
  parseWebhook(raw) {
    const r = raw as { messageId?: string; event?: string; ts?: string };
    if (!r?.messageId) return null;
    const map: Record<string, "delivered" | "bounced" | "failed"> = {
      delivered: "delivered",
      bounce: "bounced",
      dropped: "failed",
    };
    return {
      providerMessageId: r.messageId,
      status: map[r.event ?? "delivered"] ?? "delivered",
      at: r.ts ?? new Date().toISOString(),
    };
  },
};

export const mockOcr: OcrAdapter = {
  name: "mock-ocr",
  async extractInvoice(input) {
    const pre = outcomeForKey(input.idempotencyKey);
    if (pre) return pre as AdapterResult<{ fields: never[] }>;
    const lowConf = input.idempotencyKey.includes("lowconf");
    const c = lowConf ? 0.42 : 0.97;
    return ok<{ fields: import("@/contract/adapters").OcrExtractionField[] }>(
      {
        fields: [
          { key: "invoice_number", value: "INV-2045", confidence: c, sourcePage: 1, sourceRegion: [40, 60, 220, 84] },
          { key: "invoice_date", value: "2025-01-12", confidence: c, sourcePage: 1, sourceRegion: null },
          { key: "invoice_total", value: "118000.00", confidence: c, sourcePage: 1, sourceRegion: null },
          { key: "debtor_gstin", value: "29ABCDE1234F1Z5", confidence: c, sourcePage: 1, sourceRegion: null },
        ],
      },
      `ocr-${input.idempotencyKey}`,
      ["mock://ocr/page-1.json"],
    );
  },
};

export const mockReplyClassifier: ReplyClassifierAdapter = {
  name: "mock-reply-classifier",
  async classify({ text }) {
    const t = text.toLowerCase();
    let classification: ReplyClassification = "unclear";
    if (/paid|neft|utr|transferred/.test(t)) classification = "payment_made";
    else if (/will pay|by next|promise|shortly/.test(t)) classification = "promise_to_pay";
    else if (/dispute|not our|wrong|deny/.test(t)) classification = "dispute";
    else if (/send.*invoice|copy of|documents?/.test(t)) classification = "document_request";
    else if (/settle|discount|waiver/.test(t)) classification = "settlement_offer";
    return ok({
      classification,
      confidence: classification === "unclear" ? 0.35 : 0.88,
      draftReply:
        classification === "unclear"
          ? null
          : "Thank you for your response. Our team will review and revert shortly.",
    });
  },
};

export const mockGstPortal: GstPortalAdapter = {
  name: "mock-gst-portal",
  async prepare(input) {
    const pre = outcomeForKey(input.idempotencyKey);
    if (pre) return pre as AdapterResult<{ manifestHash: string }>;
    if (input.subject.length > 50 || input.remarks.length > 200 || input.attachmentStorageKeys.length > 4 || input.invoiceRecordCount > 50) {
      return {
        outcome: "permanent_failure",
        providerRef: null,
        errorCode: "GST_FIELD_LIMIT",
        evidenceRefs: [],
        nextAction: "Fix field lengths before preparing",
      };
    }
    return ok({ manifestHash: `sha256:${input.idempotencyKey}` }, null);
  },
  async openAssistedSession(idempotencyKey) {
    return {
      outcome: "human_action_required",
      providerRef: null,
      errorCode: null,
      evidenceRefs: [],
      nextAction: "Operator solves CAPTCHA and presses Send",
      data: { sessionUrl: `mock://gst-session/${idempotencyKey}` },
    };
  },
  async captureResult(idempotencyKey) {
    const pre = outcomeForKey(idempotencyKey);
    if (pre) return pre as AdapterResult<{ referenceNumber: string; filedAt: string }>;
    return ok(
      { referenceNumber: `GST-COMM-${Date.now()}`, filedAt: new Date().toISOString() },
      `GST-COMM-${idempotencyKey}`,
      ["mock://gst/receipt.pdf", "mock://gst/screenshot.png"],
    );
  },
};

export const mockMsmePortal: MsmePortalAdapter = {
  name: "mock-msme-portal",
  async saveStage(input) {
    const pre = outcomeForKey(input.idempotencyKey);
    if (pre) return pre as AdapterResult<{ resumeToken: string }>;
    return ok({ resumeToken: `resume:${input.stage}:${input.idempotencyKey}` }, null);
  },
  async buildPreview(idempotencyKey) {
    return ok(
      { previewPdfKey: `mock://msme/preview-${idempotencyKey}.pdf`, previewHash: `sha256:preview:${idempotencyKey}` },
      null,
      [`mock://msme/preview-${idempotencyKey}.pdf`],
    );
  },
  async captureAcknowledgement(idempotencyKey) {
    const pre = outcomeForKey(idempotencyKey);
    if (pre) return pre as AdapterResult<{ diaryNumber: string; petitionPdfKey: string; submittedAt: string }>;
    return ok(
      {
        diaryNumber: `ODR/2026/${Math.floor(Math.random() * 9000) + 1000}`,
        petitionPdfKey: `mock://msme/petition-${idempotencyKey}.pdf`,
        submittedAt: new Date().toISOString(),
      },
      null,
      [`mock://msme/petition-${idempotencyKey}.pdf`],
    );
  },
};

export const mockCalendar: CalendarAdapter = {
  name: "mock-calendar",
  async upsertEvent(input) {
    return ok({ eventId: `evt-${input.idempotencyKey}` }, `evt-${input.idempotencyKey}`);
  },
};

export const mockPaymentGateway: PaymentGatewayAdapter = {
  name: "mock-payment-gateway",
  async createRequest(input) {
    return ok(
      { requestId: `pr-${input.idempotencyKey}`, payUrl: `mock://pay/${input.idempotencyKey}` },
      `pr-${input.idempotencyKey}`,
    );
  },
  parseWebhook(raw) {
    const r = raw as { requestId?: string; amount?: number; paidAt?: string };
    if (!r?.requestId || typeof r.amount !== "number") return null;
    return { requestId: r.requestId, amount: r.amount, paidAt: r.paidAt ?? new Date().toISOString() };
  },
};

/** Test helper — reset the fail-once memory between test cases. */
export function __resetMockAdapterState() {
  seenKeys.clear();
}
