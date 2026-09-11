/**
 * Provider-neutral adapter interfaces (PRD §16). Concrete implementations live
 * in src/adapters/<name>/. MVP ships mock implementations; real providers
 * (AiSensy, Gmail, GST/MSME runner) drop in behind the same interface with no
 * call-site change.
 *
 * Every operation returns AdapterResult — never throws for domain outcomes.
 * Callers retry a `retryable_failure` exactly once with the same idempotency
 * key, then raise one urgent task (invariant: no duplicate sends/filings).
 */

import type { AdapterOutcome, Channel } from "./enums";
import type { Paise, Timestamp, UUID } from "./types";

export interface AdapterResult<T = unknown> {
  outcome: AdapterOutcome;
  /** provider-side identifier when one exists (message id, diary no, ref). */
  providerRef: string | null;
  /** stable, non-sensitive error code; never contains PII or portal secrets. */
  errorCode: string | null;
  /** storage keys / hashes of screenshots, PDFs, payloads captured. */
  evidenceRefs: string[];
  /** what the orchestrator should do next, human-readable. */
  nextAction: string | null;
  data?: T;
}

export interface SendMessageInput {
  idempotencyKey: string;
  caseId: UUID;
  channel: Channel;
  to: string;
  templateKey?: string;
  templateVersion?: number;
  subject?: string;
  body: string;
  /** attach a secure expiring link rather than a raw file (PRD §8). */
  secureLinkDocumentIds?: UUID[];
}

export interface MessagingAdapter {
  readonly name: string;
  send(input: SendMessageInput): Promise<AdapterResult<{ providerMessageId: string }>>;
  /** normalise a provider webhook payload into a delivery/read/bounce update. */
  parseWebhook(raw: unknown): {
    providerMessageId: string;
    status: "sent" | "delivered" | "read" | "bounced" | "failed";
    at: Timestamp;
  } | null;
}

export interface OcrExtractionField {
  key: string;
  value: string;
  confidence: number; // 0..1
  sourcePage: number | null;
  sourceRegion: [number, number, number, number] | null;
}

export interface OcrAdapter {
  readonly name: string;
  extractInvoice(input: {
    idempotencyKey: string;
    documentStorageKey: string;
    mimeType: string;
  }): Promise<AdapterResult<{ fields: OcrExtractionField[] }>>;
}

export interface ReplyClassifierAdapter {
  readonly name: string;
  /** AI may classify + draft; it must not decide eligibility/payment/settlement. */
  classify(input: { text: string; caseSummary: string }): Promise<
    AdapterResult<{
      classification: import("./enums").ReplyClassification;
      confidence: number;
      draftReply: string | null;
    }>
  >;
}

/** GST "Communication Between Taxpayers" compose flow (PRD §11). Assist-capped. */
export interface GstPortalAdapter {
  readonly name: string;
  prepare(input: {
    idempotencyKey: string;
    caseId: UUID;
    recipientGstin: string;
    subject: string; // <= 50 chars, validated by caller
    action: "payment_not_received" | "others";
    remarks: string; // <= 200 chars
    attachmentStorageKeys: string[]; // <= 4, each <= 5MB, jpeg/pdf
    invoiceRecordCount: number; // <= 50
  }): Promise<AdapterResult<{ manifestHash: string }>>;
  /** opens controlled browser session prefilled; human solves CAPTCHA + Send. */
  openAssistedSession(idempotencyKey: string): Promise<AdapterResult<{ sessionUrl: string }>>;
  /** called after operator confirms Send; must capture reference + screenshot. */
  captureResult(idempotencyKey: string): Promise<
    AdapterResult<{ referenceNumber: string; filedAt: Timestamp }>
  >;
}

/** MSME ODR seven-stage Main Case Filing wizard (PRD §12). */
export type MsmeStage =
  | "claimant"
  | "respondent"
  | "advocate"
  | "statement_of_claim"
  | "documents"
  | "checklist"
  | "preview";

export interface MsmePortalAdapter {
  readonly name: string;
  saveStage(input: {
    idempotencyKey: string;
    caseId: UUID;
    stage: MsmeStage;
    payload: Record<string, unknown>;
  }): Promise<AdapterResult<{ resumeToken: string }>>;
  buildPreview(idempotencyKey: string): Promise<AdapterResult<{ previewPdfKey: string; previewHash: string }>>;
  captureAcknowledgement(idempotencyKey: string): Promise<
    AdapterResult<{ diaryNumber: string; petitionPdfKey: string; submittedAt: Timestamp }>
  >;
}

export interface CalendarAdapter {
  readonly name: string;
  upsertEvent(input: {
    idempotencyKey: string;
    caseId: UUID;
    title: string;
    startsAt: Timestamp;
    kind: "promise" | "hearing";
  }): Promise<AdapterResult<{ eventId: string }>>;
}

export interface PaymentGatewayAdapter {
  readonly name: string;
  createRequest(input: {
    idempotencyKey: string;
    caseId: UUID;
    amount: Paise;
  }): Promise<AdapterResult<{ requestId: string; payUrl: string }>>;
  parseWebhook(raw: unknown): { requestId: string; amount: Paise; paidAt: Timestamp } | null;
}
