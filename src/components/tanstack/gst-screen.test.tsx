/**
 * The reload defect: a fresh mount used to start every GST panel at
 * "Not started / Pending" even when the session/filing was durably recorded.
 * A reload is simulated by mounting the screen with persisted evidence.
 */
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

vi.mock("@tanstack/react-router", () => ({ useRouter: () => ({ invalidate: vi.fn() }) }));
vi.mock("@/lib/gst.functions", () => ({
  prepareGstNotificationFn: vi.fn(),
  openGstAssistedSessionFn: vi.fn(),
  captureGstFilingFn: vi.fn(),
}));

import { GstScreen, type GstPack } from "./gst-screen";
import { EMPTY_GST_EVIDENCE, type GstEvidence } from "@/domain/gst-evidence";

const pack = (evidence: GstEvidence, over: Partial<GstPack> = {}): GstPack => ({
  caseId: "case-1",
  debtorName: "Kaveri Constructions",
  recipientGstin: "08AAKFK2222Q1Z1",
  clientName: "Acme",
  principalOutstanding: 4200000,
  invoiceCount: 1,
  caseStatus: "gst_notification_prepared",
  nextScheduledAt: null,
  evidence,
  ...over,
});

const opened: GstEvidence = { ...EMPTY_GST_EVIDENCE, sessionOpenedAt: "2026-09-25T15:58:00Z" };
const filed: GstEvidence = { ...opened, filedAt: "2026-09-25T16:10:00Z", referenceNumber: "AD0809260001234", filingCount: 1 };
const gate = () => screen.getByText("Evidence gate").closest("div")!.parentElement!;
/** The session badge (outside the gate): the 7-day timer row may truthfully say "Not started". */
const badgesSaying = (text: string) => screen.queryAllByText(text).filter((el) => !gate().contains(el));

describe("GstScreen hydration from persisted evidence", () => {
  it("shows the honest not-started state when nothing is recorded", () => {
    render(<GstScreen pack={pack(EMPTY_GST_EVIDENCE)} />);
    expect(badgesSaying("Not started")).toHaveLength(1);
    expect(within(gate()).getByText("Not opened")).toBeInTheDocument();
    expect(within(gate()).getByText("Pending")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open assisted portal session/i })).toBeEnabled();
  });

  it("after a reload, a persisted opened session is not shown as 'Not started'", () => {
    render(<GstScreen pack={pack(opened)} />);
    expect(badgesSaying("Not started")).toHaveLength(0);
    expect(screen.getByText(/Session open — human action required/)).toBeInTheDocument();
    expect(within(gate()).queryByText("Not opened")).not.toBeInTheDocument();
    expect(within(gate()).getByText(/^Opened /)).toBeInTheDocument();
    // the timer only starts at filing, so it is (truthfully) still not started
    expect(within(gate()).getByText("Not started")).toBeInTheDocument();
    // can't open a second session over the recorded one; the operator can continue
    expect(screen.getByRole("button", { name: /open assisted portal session/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /completed CAPTCHA/i })).toBeEnabled();
  });

  it("after a reload, a persisted filing shows its reference and is not offered again", () => {
    render(<GstScreen pack={pack(filed, { caseStatus: "gst_notification_filed", nextScheduledAt: "2026-10-02T11:00:00Z" })} />);
    expect(screen.getByText("Filed — evidence recorded")).toBeInTheDocument();
    expect(screen.getAllByText("AD0809260001234").length).toBeGreaterThan(0);
    expect(within(gate()).queryByText("Pending")).not.toBeInTheDocument();
    expect(within(gate()).getByText(/Running · evaluates/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open assisted portal session/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /completed CAPTCHA/i })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /record filing/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Not started")).not.toBeInTheDocument();
  });

  it("flags evidence that exists while the case did not advance, and duplicate filings", () => {
    render(<GstScreen pack={pack({ ...filed, filingCount: 2 }, { caseStatus: "under_validation" })} />);
    expect(screen.getByText(/did not advance/)).toBeInTheDocument();
    expect(screen.getByText(/2 filings were recorded/)).toBeInTheDocument();
  });
});
