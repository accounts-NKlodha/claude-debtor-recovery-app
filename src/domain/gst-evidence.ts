/**
 * Durable GST assisted-filing evidence, reconstructed from the audit events
 * the GST workflow already writes (there is no structured submission record
 * for GST -- external_submissions exists in the schema but nothing writes it).
 *
 * The write side and the read side of the one free-text field involved (the
 * filed reason, which carries the portal reference) live together here, so the
 * format cannot drift apart silently: repositories build the reason with
 * buildGstFiledReason() and evidence is read back with parseGstFiledReference().
 * Only the recognised GST event types are read; nothing else is inferred.
 */

export const GST_AUDIT = {
  prepared: "gst.prepared",
  sessionOpened: "gst.session_opened",
  filed: "gst.filed",
} as const;

export const GST_EVIDENCE_ACTIONS: readonly string[] = Object.values(GST_AUDIT);

export interface GstAuditEvent {
  action: string;
  reason: string | null;
  createdAt: string;
}

export interface GstEvidence {
  /** Latest time the pack was prepared / re-validated. */
  preparedAt: string | null;
  /** Latest time an assisted portal session was opened. */
  sessionOpenedAt: string | null;
  /** First time a filing was recorded (later ones are duplicates). */
  filedAt: string | null;
  /** The portal reference the operator recorded, when it can be read back. */
  referenceNumber: string | null;
  /** How many filings were recorded (more than 1 means a duplicate). */
  filingCount: number;
}

export const EMPTY_GST_EVIDENCE: GstEvidence = {
  preparedAt: null,
  sessionOpenedAt: null,
  filedAt: null,
  referenceNumber: null,
  filingCount: 0,
};

const REFERENCE_SUFFIX = /;\s*reference\s+(\S[^\n]*)$/;

/** The one place the filed-event reason is composed. */
export function buildGstFiledReason(note: string, referenceNumber: string): string {
  return `${note}; reference ${referenceNumber}`;
}

/** Inverse of buildGstFiledReason: the reference, or null when absent. */
export function parseGstFiledReference(reason: string | null | undefined): string | null {
  if (!reason) return null;
  const m = REFERENCE_SUFFIX.exec(reason);
  return m ? m[1].trim() : null;
}

/** Events may arrive in any order. */
export function reconstructGstEvidence(events: readonly GstAuditEvent[]): GstEvidence {
  const byTime = [...events].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const latest = (action: string) => [...byTime].reverse().find((e) => e.action === action)?.createdAt ?? null;
  const filings = byTime.filter((e) => e.action === GST_AUDIT.filed);
  const first = filings[0];
  return {
    preparedAt: latest(GST_AUDIT.prepared),
    sessionOpenedAt: latest(GST_AUDIT.sessionOpened),
    filedAt: first?.createdAt ?? null,
    referenceNumber: first ? parseGstFiledReference(first.reason) : null,
    filingCount: filings.length,
  };
}
