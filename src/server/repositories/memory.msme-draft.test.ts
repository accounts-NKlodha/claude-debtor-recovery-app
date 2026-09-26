import { describe, expect, it } from "vitest";
import { MemoryRepository } from "./memory";
import * as mock from "@/lib/mock-data";

const ACTOR = { actorId: "staff-1", actorRole: "staff" };

/** The demo case that sits at msme_eligibility_review (same one the action tests file). */
const caseId = () => mock.CASES.find((c) => c.status === "msme_eligibility_review")!.id;

describe("MemoryRepository MSME Save & resume (demo parity with save_msme_stage / lock_msme_draft)", () => {
  it("persists saved stages so a fresh read (reload / new login) sees them, and resumes later", async () => {
    const repo = new MemoryRepository();
    const id = caseId();
    expect(await repo.getMsmeDraft(id)).toBeNull();

    const first = await repo.saveMsmeStage(id, "claimant", { claimantName: "Acme", claimantAddress: "Jaipur" }, ACTOR);
    expect(first.version).toBe(1);

    // a brand-new repository instance is a new request: state must not depend on the caller
    const reread = await new MemoryRepository().getMsmeDraft(id);
    expect(reread).toMatchObject({ currentStage: "claimant", version: 1, status: "draft" });
    expect(reread?.formData).toEqual({ claimantName: "Acme", claimantAddress: "Jaipur" });

    const second = await repo.saveMsmeStage(id, "respondent", { respondentName: "Kaveri" }, ACTOR, 1);
    expect(second.version).toBe(2);
    const later = await repo.getMsmeDraft(id);
    expect(later?.currentStage).toBe("respondent");
    expect(later?.formData).toEqual({ claimantName: "Acme", claimantAddress: "Jaipur", respondentName: "Kaveri" });
  });

  it("rejects a stale save from a second session", async () => {
    const repo = new MemoryRepository();
    await expect(repo.saveMsmeStage(caseId(), "advocate", { x: "y" }, ACTOR, 1)).rejects.toThrow(/another session/);
  });

  it("filing locks the draft, and a filed submission cannot be edited silently", async () => {
    const repo = new MemoryRepository();
    const id = caseId();
    const filed = await repo.captureMsmeAcknowledgement(id, ACTOR);
    expect(filed.diaryNumber).toBeTruthy();

    const draft = await repo.getMsmeDraft(id);
    expect(draft).toMatchObject({ status: "locked", diaryNumber: filed.diaryNumber });
    const before = draft?.formData;

    await expect(repo.saveMsmeStage(id, "claimant", { claimantName: "Tampered" }, ACTOR)).rejects.toThrow(/locked/);
    expect((await repo.getMsmeDraft(id))?.formData).toEqual(before);
  });
});
