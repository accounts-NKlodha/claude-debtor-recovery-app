/**
 * Deterministic Indian mobile number normalization for the AiSensy WhatsApp
 * boundary (AiSensy WhatsApp production integration task).
 *
 * `indianMobileSchema` (src/contract/schemas.ts) validates SHAPE at intake
 * time but deliberately does not canonicalize storage -- debtors.mobile can
 * hold "9876543210", "+919876543210", "919876543210", or a spaced/hyphenated
 * variant, all equally valid there. AiSensy's Campaign API accepts a
 * "+(country code)(number)" destination and documents that an unresolvable
 * Indian number silently DEFAULTS to +91 on their end -- this module exists
 * so that default is never relied on: normalization happens here,
 * deterministically, before any AiSensy call, and anything ambiguous is
 * rejected rather than guessed at.
 */

export interface NormalizedIndianMobile {
  /** AiSensy's documented destination format: "+91XXXXXXXXXX". */
  destination: string;
}

const TEN_DIGIT_MOBILE_RE = /^[6-9]\d{9}$/;

/**
 * Returns the canonical "+91XXXXXXXXXX" destination for a valid Indian
 * mobile number, or `null` if the input is malformed or ambiguous. Never
 * throws, never invents a country code beyond stripping an explicit,
 * unambiguous "91"/"+91" prefix that is already present.
 */
export function normalizeIndianMobile(raw: string | null | undefined): NormalizedIndianMobile | null {
  if (!raw) return null;
  const stripped = raw.replace(/[\s-()]/g, "");
  if (stripped === "") return null;

  let digits: string;
  if (stripped.startsWith("+91")) {
    digits = stripped.slice(3);
  } else if (stripped.startsWith("+")) {
    // An explicit non-+91 country code is unambiguous -- but this module
    // only handles Indian numbers (the only shape debtors.mobile is
    // validated against at intake); refuse rather than mis-route it.
    return null;
  } else if (stripped.startsWith("91") && stripped.length === 12) {
    digits = stripped.slice(2);
  } else {
    digits = stripped;
  }

  if (!TEN_DIGIT_MOBILE_RE.test(digits)) return null;
  return { destination: `+91${digits}` };
}
