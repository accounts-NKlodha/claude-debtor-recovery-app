/**
 * Pure OCR-correction workflow bridge (PRD §7 "staff confirmation of
 * OCR/AI output", acceptance scenario 1). Provenance (source page/region,
 * per-field confidence) lives on the adapter contract
 * (`OcrExtractionField` in src/contract/adapters.ts) and is captured at
 * extraction time; this module only decides what staff *confirming* the
 * corrected fields does to the case.
 *
 * Confirming the fields satisfies the STAFF-VALIDATION gate and nothing
 * else. Client certification and the 60-day age gate are evaluated from
 * their real evidence (src/domain/activation.ts); if either is open the
 * case waits in `under_validation` and is NOT activated.
 */

import type { RecoveryCase } from "@/contract/types";
import { applyActivationGates, type ActivationGates } from "./activation";

export function applyOcrCorrected(
  kase: RecoveryCase,
  gates: Pick<ActivationGates, "clientCertified" | "ageGatePassed" | "missing">,
): { updatedCase: RecoveryCase; note: string; activated: boolean } {
  const withValidation = { ...gates, staffValidated: true, missing: gates.missing.filter((m) => m !== "staff validation") };
  return applyActivationGates(kase, withValidation);
}
