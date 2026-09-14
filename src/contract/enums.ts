/**
 * Canonical enums shared across API, workers, and UI.
 * Source of truth for workflow vocabulary (PRD §6, workflow-spec).
 * Changing anything here is a shared-contract change: serialize it, do not
 * parallelise it.
 */

export const CASE_STATUS = [
  "received",
  "under_validation",
  "correction_required",
  "active",
  "initial_communication_sent",
  "contact_update_required",
  "payment_confirmation_required",
  "promise_to_pay",
  "dispute_settlement",
  "gst_eligibility_review",
  "gst_notification_prepared",
  "gst_notification_filed",
  "msme_eligibility_review",
  "msme_odr_filed",
  "msefc_dd",
  "hearing_scheduled",
  "adjourned",
  "recovered",
  "withdrawn",
  "closed",
  "automation_failed",
  "archived",
] as const;
export type CaseStatus = (typeof CASE_STATUS)[number];

/** Client-safe labels (PRD §6). Anything not mapped is shown as "In progress". */
export const CLIENT_SAFE_LABEL: Partial<Record<CaseStatus, string>> = {
  active: "Case approved",
  initial_communication_sent: "Case approved",
  gst_notification_filed: "GST complaint filed",
  msme_odr_filed: "MSME complaint filed",
  dispute_settlement: "Dispute in resolution",
  promise_to_pay: "Payment promised",
  recovered: "Recovered",
  closed: "Closed",
  withdrawn: "Withdrawn",
};

export const WAITING_ON = ["system", "client", "staff", "portal"] as const;
export type WaitingOn = (typeof WAITING_ON)[number];

/** Per-client / per-action automation mode. Portal actions cap at "assist". */
export const AUTOMATION_MODE = ["manual", "prepare", "assist", "automatic"] as const;
export type AutomationMode = (typeof AUTOMATION_MODE)[number];

export const CHANNEL = ["whatsapp", "email", "postal"] as const;
export type Channel = (typeof CHANNEL)[number];

export const COMMUNICATION_DIRECTION = ["outbound", "inbound"] as const;
export type CommunicationDirection = (typeof COMMUNICATION_DIRECTION)[number];

export const DELIVERY_STATUS = [
  "queued",
  "sent",
  "delivered",
  "read",
  "bounced",
  "failed",
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUS)[number];

/** AI reply classification (PRD §8). AI classifies; staff decides. */
export const REPLY_CLASSIFICATION = [
  "payment_made",
  "promise_to_pay",
  "dispute",
  "document_request",
  "settlement_offer",
  "unrelated",
  "unclear",
] as const;
export type ReplyClassification = (typeof REPLY_CLASSIFICATION)[number];

export const PAYMENT_KIND = ["bank", "cash", "tds", "settlement", "credit_note"] as const;
export type PaymentKind = (typeof PAYMENT_KIND)[number];

export const USER_ROLE = ["staff", "admin", "client"] as const;
export type UserRole = (typeof USER_ROLE)[number];

export const ELIGIBILITY_ROUTE = ["gst", "msme", "non_msme_manual"] as const;
export type EligibilityRoute = (typeof ELIGIBILITY_ROUTE)[number];

/** Unified adapter outcome (PRD §16). Every integration returns exactly one. */
export const ADAPTER_OUTCOME = [
  "success",
  "retryable_failure",
  "permanent_failure",
  "human_action_required",
  "drift_detected",
] as const;
export type AdapterOutcome = (typeof ADAPTER_OUTCOME)[number];

export const DD_STATUS = ["preparation_pending", "prepared", "submitted"] as const;
export type DdStatus = (typeof DD_STATUS)[number];

export const HEARING_STATUS = ["scheduled", "adjourned", "completed", "cancelled"] as const;
export type HearingStatus = (typeof HEARING_STATUS)[number];

export const TASK_TYPE = [
  "ocr_low_confidence",
  "missing_invoice_field",
  "client_certification",
  "staff_validation",
  "contact_correction",
  "payment_confirmation",
  "dispute_resolution",
  "settlement_approval",
  "gst_portal_run",
  "msme_portal_run",
  "portal_drift",
  "dd_preparation",
  "hearing_followup",
  "retry_exhausted",
  "policy_gate",
] as const;
export type TaskType = (typeof TASK_TYPE)[number];

export const IST_TZ = "Asia/Kolkata";
export const SCHEDULED_SEND_HOUR_IST = 11;
