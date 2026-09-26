/** Reload/resume behaviour of the MSME wizard: it hydrates from the persisted draft. */
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@tanstack/react-router", () => ({ useRouter: () => ({ invalidate: vi.fn() }) }));
vi.mock("@/lib/msme.functions", () => ({
  buildMsmePreviewFn: vi.fn(),
  captureMsmeAcknowledgementFn: vi.fn(),
  saveMsmeStageFn: vi.fn(),
}));

import { MsmeWizard, type MsmeSeed } from "./msme-wizard";

const seed = (draft: MsmeSeed["draft"]): MsmeSeed => ({
  caseId: "case-1",
  claimantName: "Seed Claimant",
  claimantUdyam: "UDYAM-SEED",
  respondentName: "Seed Respondent",
  respondentGstin: "",
  claimAmount: "1,000",
  draft,
});

const draft = (over: Partial<NonNullable<MsmeSeed["draft"]>>): NonNullable<MsmeSeed["draft"]> => ({
  caseId: "case-1", formData: {}, savedStages: [], currentStage: "claimant", status: "draft",
  diaryNumber: null, petitionPdfKey: null, lockedAt: null, version: 1, updatedAt: "2026-09-26T10:00:00Z", ...over,
});

describe("MsmeWizard hydration", () => {
  it("starts at the first step with seeded defaults when nothing was saved", () => {
    render(<MsmeWizard seed={seed(null)} />);
    expect(screen.getByLabelText(/Claimant \/ seller legal name/)).toHaveValue("Seed Claimant");
  });

  it("resumes at the saved stage with the saved values (saved data beats seeded defaults)", () => {
    render(
      <MsmeWizard
        seed={seed(draft({ currentStage: "respondent", formData: { respondentName: "Saved Respondent", respondentAddress: "Delhi" } }))}
      />,
    );
    expect(screen.getByLabelText(/Respondent \/ buyer legal name/)).toHaveValue("Saved Respondent");
    expect(screen.getByLabelText(/Respondent address/)).toHaveValue("Delhi");
  });

  it("shows a submitted filing as locked with its diary number and disables editing actions", () => {
    render(
      <MsmeWizard
        seed={seed(draft({ status: "locked", diaryNumber: "DIARY-77", petitionPdfKey: "pdf-77", formData: { claimantName: "Acme" } }))}
      />,
    );
    expect(screen.getByText("Filing locked")).toBeInTheDocument();
    expect(screen.getByText("DIARY-77")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Submitted/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Save & resume later/ })).toBeDisabled();
  });
});
