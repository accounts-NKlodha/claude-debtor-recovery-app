import type { GstEvidence } from "./gst-evidence";

/** The assisted-filing panel's phase. "filed" is terminal: the operator must
 * not be offered the open-session / record-filing controls again. */
export type GstSession = "idle" | "opening" | "open" | "sent" | "filing" | "filed";
export type GstLocalSession = Exclude<GstSession, "filed">;

/**
 * Combines what happened in this page visit (`local`) with what is durably
 * recorded (`evidence`). Persisted evidence can only ever move the phase
 * forward: a reload must never show "Not started" when a session was opened or
 * a filing recorded, and an in-page action still takes effect immediately
 * before the next data refresh lands.
 */
export function deriveGstSession(input: {
  local: GstLocalSession;
  localFilingSucceeded: boolean;
  evidence: GstEvidence;
}): GstSession {
  if (input.evidence.filedAt || input.localFilingSucceeded) return "filed";
  if (input.local === "idle" && input.evidence.sessionOpenedAt) return "open";
  return input.local;
}

function day(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" });
}

export interface GstEvidenceRow {
  label: string;
  value: string;
  done: boolean;
}

/** The right-hand "Evidence gate" rows for the current phase. */
export function gstEvidenceRows(input: {
  session: GstSession;
  manifestValid: boolean;
  attachmentCount: number;
  typedReference: string;
  evidence: GstEvidence;
  caseStatus: string;
  nextScheduledAt: string | null;
}): GstEvidenceRow[] {
  const { session, evidence } = input;
  const filed = session === "filed";
  const referenceEntry = session === "sent" || session === "filing";

  const reference = filed
    ? { value: evidence.referenceNumber ?? "Filed — reference not readable", done: Boolean(evidence.referenceNumber) }
    : referenceEntry
      ? { value: input.typedReference || "Awaiting entry", done: Boolean(input.typedReference) }
      : { value: "Pending", done: false };

  const timer = filed
    ? {
        value:
          input.caseStatus === "gst_notification_filed" && input.nextScheduledAt
            ? `Running · evaluates ${day(input.nextScheduledAt)}`
            : evidence.filedAt
              ? `Started ${day(evidence.filedAt)}`
              : "Starting…",
        done: true,
      }
    : { value: session === "filing" ? "Starting…" : "Not started", done: false };

  return [
    { label: "Manifest", value: input.manifestValid ? "Locked" : "Pending field fixes", done: input.manifestValid },
    { label: "Attachments", value: `${input.attachmentCount} verified`, done: input.attachmentCount > 0 },
    {
      label: "Assisted session",
      value:
        session === "idle"
          ? "Not opened"
          : session === "opening"
            ? "Preparing…"
            : evidence.sessionOpenedAt
              ? `Opened ${day(evidence.sessionOpenedAt)}`
              : "Opened",
      done: session !== "idle" && session !== "opening",
    },
    { label: "Reference / screenshot", ...reference },
    { label: "7-day timer", ...timer },
  ];
}
