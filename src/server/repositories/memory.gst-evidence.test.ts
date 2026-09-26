import { describe, expect, it } from "vitest";
import { MemoryRepository } from "./memory";

const ACTOR = { actorId: "staff-1", actorRole: "staff" };

describe("MemoryRepository GST evidence (demo/mock parity with Supabase)", () => {
  it("reports a persisted opened session and filing per case, and isolates cases", async () => {
    const repo = new MemoryRepository();
    const [a, b] = await repo.listAllCases();
    expect(await repo.getGstEvidence(a.id)).toMatchObject({ sessionOpenedAt: null, filedAt: null });

    await repo.openGstAssistedSession(a.id, ACTOR);
    const opened = await repo.getGstEvidence(a.id);
    expect(opened.sessionOpenedAt).not.toBeNull();
    expect(opened.filedAt).toBeNull();
    expect((await repo.getGstEvidence(b.id)).sessionOpenedAt).toBeNull();

    await repo.captureGstFiling(a.id, "AD0809260001234", ACTOR);
    const filed = await repo.getGstEvidence(a.id);
    expect(filed).toMatchObject({ referenceNumber: "AD0809260001234", filingCount: 1 });
    expect(filed.filedAt).not.toBeNull();
    expect((await repo.getGstEvidence(b.id)).filedAt).toBeNull();
  });
});
