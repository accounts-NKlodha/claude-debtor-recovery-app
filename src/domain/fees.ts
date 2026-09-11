/**
 * Success-fee policy (PRD §2 "Commercial model"). Fixed audit finding P1-5:
 * fee estimation was hard-coded at 8% everywhere it appeared, contradicting
 * the agreed 10% standard / 5% eligible-early-JITO-member policy.
 */

export const STANDARD_SUCCESS_FEE_RATE = 0.1;
export const JITO_SUCCESS_FEE_RATE = 0.05;

export function successFeeRate(jitoMember: boolean): number {
  return jitoMember ? JITO_SUCCESS_FEE_RATE : STANDARD_SUCCESS_FEE_RATE;
}

/** Recovered proceeds (paise) -> estimated success fee (paise), rounded to the nearest paisa. */
export function estimateSuccessFee(recoveredPaise: number, jitoMember: boolean): number {
  return Math.round(recoveredPaise * successFeeRate(jitoMember));
}
