import { describe, expect, it } from "vitest";
import { EMPTY_GST_EVIDENCE, type GstEvidence } from "./gst-evidence";
import { deriveGstSession, gstEvidenceRows } from "./gst-panel-state";

const opened: GstEvidence = { ...EMPTY_GST_EVIDENCE, sessionOpenedAt: "2026-09-25T15:58:00Z" };
const filed: GstEvidence = { ...opened, filedAt: "2026-09-25T16:10:00Z", referenceNumber: "AD0809260001234", filingCount: 1 };

describe("deriveGstSession", () => {
  it("starts idle with no evidence", () => {
    expect(deriveGstSession({ local: "idle", localFilingSucceeded: false, evidence: EMPTY_GST_EVIDENCE })).toBe("idle");
  });
  it("hydrates an opened session after reload instead of 'not started'", () => {
    expect(deriveGstSession({ local: "idle", localFilingSucceeded: false, evidence: opened })).toBe("open");
  });
  it("hydrates a recorded filing as terminal", () => {
    expect(deriveGstSession({ local: "idle", localFilingSucceeded: false, evidence: filed })).toBe("filed");
  });
  it("shows an in-page filing immediately, before the refreshed evidence arrives", () => {
    expect(deriveGstSession({ local: "filing", localFilingSucceeded: true, evidence: EMPTY_GST_EVIDENCE })).toBe("filed");
  });
  it("never moves an in-progress local phase backwards", () => {
    expect(deriveGstSession({ local: "sent", localFilingSucceeded: false, evidence: opened })).toBe("sent");
    expect(deriveGstSession({ local: "opening", localFilingSucceeded: false, evidence: EMPTY_GST_EVIDENCE })).toBe("opening");
  });
});

const base = { manifestValid: true, attachmentCount: 2, typedReference: "", caseStatus: "gst_notification_filed", nextScheduledAt: "2026-09-30T11:00:00Z" };
const row = (rows: ReturnType<typeof gstEvidenceRows>, label: string) => rows.find((r) => r.label === label)!;

describe("gstEvidenceRows", () => {
  it("shows the never-started state only when nothing is recorded", () => {
    const rows = gstEvidenceRows({ ...base, session: "idle", evidence: EMPTY_GST_EVIDENCE });
    expect(row(rows, "Assisted session")).toMatchObject({ value: "Not opened", done: false });
    expect(row(rows, "Reference / screenshot").value).toBe("Pending");
    expect(row(rows, "7-day timer").value).toBe("Not started");
  });

  it("reflects a persisted opened session", () => {
    const rows = gstEvidenceRows({ ...base, session: "open", evidence: opened });
    expect(row(rows, "Assisted session").value).toMatch(/^Opened \d/);
    expect(row(rows, "Assisted session").done).toBe(true);
  });

  it("reflects a persisted filing: reference and running timer", () => {
    const rows = gstEvidenceRows({ ...base, session: "filed", evidence: filed });
    expect(row(rows, "Reference / screenshot")).toMatchObject({ value: "AD0809260001234", done: true });
    expect(row(rows, "7-day timer").value).toMatch(/^Running · evaluates/);
    expect(row(rows, "7-day timer").done).toBe(true);
  });

  it("does not claim a running timer when the case never advanced, but still shows the filing", () => {
    const rows = gstEvidenceRows({ ...base, caseStatus: "under_validation", session: "filed", evidence: filed });
    expect(row(rows, "7-day timer").value).toMatch(/^Started \d/);
    expect(row(rows, "Reference / screenshot").value).toBe("AD0809260001234");
  });

  it("says so when a filing exists but its reference can't be read", () => {
    const rows = gstEvidenceRows({ ...base, session: "filed", evidence: { ...filed, referenceNumber: null } });
    expect(row(rows, "Reference / screenshot").value).toMatch(/reference not readable/);
  });

  it("keeps the typed-reference behaviour while the operator is entering one", () => {
    const rows = gstEvidenceRows({ ...base, session: "sent", typedReference: "AD-1", evidence: opened });
    expect(row(rows, "Reference / screenshot")).toMatchObject({ value: "AD-1", done: true });
  });
});
