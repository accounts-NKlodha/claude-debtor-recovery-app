import { describe, expect, it } from "vitest";
import {
  MSME_STAGES,
  MsmeDraftError,
  applyMsmeDraftLock,
  applyMsmeStageSave,
  resumeStepIndex,
  type MsmeDraft,
} from "./msme-draft";

const NOW = "2026-09-26T10:00:00.000Z";
const base = { caseId: "c1", caseStatus: "msme_eligibility_review", now: NOW };

describe("applyMsmeStageSave", () => {
  it("creates version 1 for a first save", () => {
    const d = applyMsmeStageSave({ ...base, existing: undefined, stage: "claimant", payload: { a: "1" } });
    expect(d).toMatchObject({ version: 1, currentStage: "claimant", savedStages: ["claimant"], status: "draft", formData: { a: "1" } });
  });

  it("merges later saves, advances the stage and bumps the version", () => {
    const first = applyMsmeStageSave({ ...base, existing: undefined, stage: "claimant", payload: { a: "1", b: "2" } });
    const second = applyMsmeStageSave({ ...base, existing: first, stage: "respondent", payload: { b: "3", c: "4" }, expectedVersion: 1 });
    expect(second.formData).toEqual({ a: "1", b: "3", c: "4" });
    expect(second).toMatchObject({ version: 2, currentStage: "respondent", savedStages: ["claimant", "respondent"] });
  });

  it("rejects a stale expected version, including 'none yet' against an existing draft", () => {
    const first = applyMsmeStageSave({ ...base, existing: undefined, stage: "claimant", payload: {} });
    expect(() => applyMsmeStageSave({ ...base, existing: first, stage: "advocate", payload: {}, expectedVersion: 0 })).toThrow(
      expect.objectContaining({ kind: "conflict" }),
    );
  });

  it("refuses a filed case or a locked draft", () => {
    expect(() =>
      applyMsmeStageSave({ ...base, caseStatus: "msme_odr_filed", existing: undefined, stage: "claimant", payload: {} }),
    ).toThrow(MsmeDraftError);
    const locked = applyMsmeDraftLock({ existing: undefined, caseId: "c1", diaryNumber: "D1", petitionPdfKey: null, now: NOW });
    expect(() => applyMsmeStageSave({ ...base, existing: locked, stage: "claimant", payload: {} })).toThrow(
      expect.objectContaining({ kind: "locked" }),
    );
  });
});

describe("applyMsmeDraftLock", () => {
  it("locks an existing draft keeping its data, and is idempotent for the same diary", () => {
    const saved = applyMsmeStageSave({ ...base, existing: undefined, stage: "preview", payload: { a: "1" } });
    const locked = applyMsmeDraftLock({ existing: saved, caseId: "c1", diaryNumber: "D1", petitionPdfKey: "k", now: NOW });
    expect(locked).toMatchObject({ status: "locked", diaryNumber: "D1", formData: { a: "1" }, version: 2, lockedAt: NOW });
    expect(applyMsmeDraftLock({ existing: locked, caseId: "c1", diaryNumber: "D1", petitionPdfKey: "k", now: "later" })).toBe(locked);
  });

  it("rejects a different diary number on a locked draft", () => {
    const locked = applyMsmeDraftLock({ existing: undefined, caseId: "c1", diaryNumber: "D1", petitionPdfKey: null, now: NOW });
    expect(() => applyMsmeDraftLock({ existing: locked, caseId: "c1", diaryNumber: "D2", petitionPdfKey: null, now: NOW })).toThrow(MsmeDraftError);
  });
});

describe("resumeStepIndex", () => {
  const draft = (over: Partial<MsmeDraft>): MsmeDraft => ({
    caseId: "c1", formData: {}, savedStages: [], currentStage: "claimant", status: "draft",
    diaryNumber: null, petitionPdfKey: null, lockedAt: null, version: 1, updatedAt: NOW, ...over,
  });
  it("starts at the first step with no draft", () => expect(resumeStepIndex(null)).toBe(0));
  it("resumes at the saved stage", () => expect(resumeStepIndex(draft({ currentStage: "documents" }))).toBe(4));
  it("opens a locked filing at the preview step", () =>
    expect(resumeStepIndex(draft({ status: "locked", currentStage: "claimant" }))).toBe(MSME_STAGES.length - 1));
});
