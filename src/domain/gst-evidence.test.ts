import { describe, expect, it } from "vitest";
import {
  buildGstFiledReason,
  EMPTY_GST_EVIDENCE,
  GST_AUDIT,
  parseGstFiledReference,
  reconstructGstEvidence,
} from "./gst-evidence";

const ev = (action: string, createdAt: string, reason: string | null = null) => ({ action, createdAt, reason });

describe("filed reason builder/parser", () => {
  it("round-trips a reference through the exact format the repositories write", () => {
    const reason = buildGstFiledReason("GST notification filed; 7-day response window running", "AD0809260001234");
    expect(parseGstFiledReference(reason)).toBe("AD0809260001234");
  });

  it("reads references containing spaces and punctuation, and trims", () => {
    expect(parseGstFiledReference(buildGstFiledReason("x", "AD 08/09-26 0001234  "))).toBe("AD 08/09-26 0001234");
  });

  it("reads the reason recorded by the earlier real UAT run", () => {
    expect(
      parseGstFiledReference("Ignored event GST_NOTIFICATION_FILED in status under_validation; reference M1BATCH4GSTREF001"),
    ).toBe("M1BATCH4GSTREF001");
  });

  it("returns null when there is no reference", () => {
    expect(parseGstFiledReference(null)).toBeNull();
    expect(parseGstFiledReference("")).toBeNull();
    expect(parseGstFiledReference("GST notification filed")).toBeNull();
    expect(parseGstFiledReference("filed; reference ")).toBeNull();
  });
});

describe("reconstructGstEvidence", () => {
  it("is empty when nothing was recorded", () => {
    expect(reconstructGstEvidence([])).toEqual(EMPTY_GST_EVIDENCE);
  });

  it("recognises an opened session on its own", () => {
    const r = reconstructGstEvidence([ev(GST_AUDIT.sessionOpened, "2026-09-25T15:58:00Z")]);
    expect(r).toMatchObject({ sessionOpenedAt: "2026-09-25T15:58:00Z", filedAt: null, referenceNumber: null, filingCount: 0 });
  });

  it("recognises a filing with its reference, regardless of event order", () => {
    const events = [
      ev(GST_AUDIT.filed, "2026-09-22T16:53:00Z", buildGstFiledReason("filed", "REF-1")),
      ev(GST_AUDIT.prepared, "2026-09-22T16:52:00Z"),
      ev(GST_AUDIT.sessionOpened, "2026-09-22T16:53:00Z"),
    ];
    const r = reconstructGstEvidence(events);
    expect(r.referenceNumber).toBe("REF-1");
    expect(r.filedAt).toBe("2026-09-22T16:53:00Z");
    expect(r.preparedAt).toBe("2026-09-22T16:52:00Z");
    expect(r.filingCount).toBe(1);
    expect(reconstructGstEvidence([...events].reverse())).toEqual(r);
  });

  it("uses the latest session/prepare and the FIRST filing, counting duplicates", () => {
    const r = reconstructGstEvidence([
      ev(GST_AUDIT.sessionOpened, "2026-09-01T10:00:00Z"),
      ev(GST_AUDIT.sessionOpened, "2026-09-02T10:00:00Z"),
      ev(GST_AUDIT.filed, "2026-09-03T10:00:00Z", buildGstFiledReason("filed", "FIRST")),
      ev(GST_AUDIT.filed, "2026-09-04T10:00:00Z", buildGstFiledReason("filed", "SECOND")),
    ]);
    expect(r.sessionOpenedAt).toBe("2026-09-02T10:00:00Z");
    expect(r.referenceNumber).toBe("FIRST");
    expect(r.filingCount).toBe(2);
  });

  it("keeps a filing whose reference cannot be read as filed (never falls back to 'not started')", () => {
    const r = reconstructGstEvidence([ev(GST_AUDIT.filed, "2026-09-03T10:00:00Z", "GST notification filed")]);
    expect(r.filedAt).toBe("2026-09-03T10:00:00Z");
    expect(r.referenceNumber).toBeNull();
  });

  it("ignores unrelated events", () => {
    expect(reconstructGstEvidence([ev("payment.recorded", "2026-09-03T10:00:00Z", "; reference X")])).toEqual(EMPTY_GST_EVIDENCE);
  });
});
