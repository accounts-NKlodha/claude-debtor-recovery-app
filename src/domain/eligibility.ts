/**
 * Route eligibility (PRD §10). This computes an *operational* route suggestion.
 * It is NOT a statutory/legal eligibility determination — those require a
 * versioned, counsel-approved policy before live filing (PRD §10, §19).
 * A human always confirms the route (workflow event *_ELIGIBILITY_DECIDED).
 */

import type { EligibilityRoute } from "@/contract/enums";

export interface EligibilityInputs {
  creditorGstRegistered: boolean;
  debtorGstRegistered: boolean;
  creditorUdyamRegistered: boolean;
  /** operational 60-day overdue gate (not the MSME 45-day legal test). */
  daysOverdue: number;
  disputed: boolean;
}

export interface EligibilityAssessment {
  suggestedRoute: EligibilityRoute;
  gstAvailable: boolean;
  msmeAvailable: boolean;
  reasons: string[];
  /** always true — a human confirms before any filing prep proceeds. */
  requiresHumanConfirmation: true;
}

export function assessEligibility(i: EligibilityInputs): EligibilityAssessment {
  const reasons: string[] = [];
  const gstAvailable = i.creditorGstRegistered && i.debtorGstRegistered && !i.disputed;
  const msmeAvailable = i.creditorUdyamRegistered && !i.disputed;

  if (!i.creditorGstRegistered) reasons.push("Creditor not GST registered");
  if (!i.debtorGstRegistered) reasons.push("Debtor not GST registered");
  if (!i.creditorUdyamRegistered) reasons.push("Creditor has no Udyam/MSME registration");
  if (i.disputed) reasons.push("Invoice is disputed — legal routes paused pending resolution");
  if (i.daysOverdue < 60) reasons.push(`Only ${i.daysOverdue} days overdue (operational gate is 60)`);

  let suggestedRoute: EligibilityRoute;
  if (gstAvailable) suggestedRoute = "gst";
  else if (msmeAvailable) suggestedRoute = "msme";
  else suggestedRoute = "non_msme_manual";

  return {
    suggestedRoute,
    gstAvailable,
    msmeAvailable,
    reasons,
    requiresHumanConfirmation: true,
  };
}
