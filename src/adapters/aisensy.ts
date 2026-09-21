/**
 * Real AiSensy WhatsApp Campaign API adapter (AiSensy WhatsApp production
 * integration task). Implements the same `MessagingAdapter` interface as
 * the mock adapters (src/adapters/mock.ts) so no call-site changes when
 * this replaces `mockWhatsApp` (src/adapters/index.ts, gated by
 * WHATSAPP_PROVIDER=aisensy).
 *
 * API surface confirmed live with the account holder (2026-09-18): the
 * AiSensy "Campaign API" -- POST https://backend.aisensy.com/campaign/t1/api/v2,
 * auth via an `apiKey` field in the JSON body (AiSensy dashboard: Manage ->
 * API Key), template invocation via a dashboard-configured "Live"
 * `campaignName`, and an ordered `templateParams` array whose length must
 * match the approved template's variable count (VERIFIED FROM AISENSY
 * DOCUMENTATION: https://wiki.aisensy.com/en/articles/11501889-api-reference-docs).
 *
 * VERIFIED FROM AISENSY DOCUMENTATION:
 *   - destination format: "+<country-code><number>"; AiSensy silently
 *     defaults an unresolvable Indian number to +91 -- this adapter never
 *     relies on that default (see src/domain/phone.ts), and rejects
 *     anything not already normalized to "+91XXXXXXXXXX".
 *   - A successful call returns HTTP 200. AiSensy's own docs do not
 *     document the response BODY shape, an error body shape, or any status
 *     code other than 200 for this endpoint.
 *
 * APPLICATION DESIGN DECISION (undocumented by AiSensy, decided here):
 *   - HTTP 200 is treated as "provider accepted the request" only -- never
 *     "delivered" or "read". No providerRef/message-id is claimed unless
 *     the response body happens to contain a recognizable id field (best
 *     effort, never assumed present).
 *   - Non-200 status codes are classified conservatively: 401/403 (auth) and
 *     400/404/422 (bad request -- campaign not live, param-count mismatch,
 *     invalid destination) are permanent_failure; 408/429/5xx and network
 *     errors are retryable_failure. Any other/unrecognized status is
 *     retryable_failure (never assumed permanent without evidence).
 *   - Real AiSensy delivered/read confirmation requires the separate
 *     Project Webhook mechanism (HMAC-SHA256 `X-AiSensy-Signature`,
 *     documented at https://aisensy.stoplight.io/docs/project-api/56ea5a8f1cc9a-project-webhook),
 *     which is NOT implemented in this task (see final report, step 12) --
 *     `parseWebhook()` is a documented no-op here, not a fabricated one.
 *
 * Secret handling: `getAiSensyConfig().apiKey` is read once per send (never
 * cached across requests the way the Gmail transporter is, since it travels
 * in the request BODY, not a reusable connection) and is never logged,
 * never included in an `AdapterResult`, and never echoed back from a raw
 * provider error (errorCode/nextAction are always built from a fixed,
 * pre-approved vocabulary, never from raw response text).
 */

import "server-only";
import type { AdapterResult, MessagingAdapter, SendMessageInput } from "@/contract/adapters";
import { getAiSensyConfig, getCampaignName } from "@/lib/config/aisensy";
import { normalizeIndianMobile } from "@/domain/phone";
import { getTemplateDefByKey, validateTemplateParams } from "@/domain/whatsapp-templates";

const CAMPAIGN_API_URL = "https://backend.aisensy.com/campaign/t1/api/v2";

interface ClassifiedFailure {
  outcome: "retryable_failure" | "permanent_failure";
  errorCode: string;
  nextAction: string;
}

/** Exported for direct unit testing -- mirrors gmail-smtp.ts's classifySendError pattern. */
export function classifyAiSensyResponse(status: number): ClassifiedFailure {
  if (status === 401 || status === 403) {
    return {
      outcome: "permanent_failure",
      errorCode: "AISENSY_AUTH_FAILED",
      nextAction: "AiSensy rejected the API key. Verify AISENSY_API_KEY is correct and active. Do not retry automatically.",
    };
  }
  if (status === 400 || status === 404 || status === 422) {
    return {
      outcome: "permanent_failure",
      errorCode: `AISENSY_REQUEST_REJECTED_${status}`,
      nextAction: "AiSensy rejected the request -- likely an inactive/misnamed campaign, a template-parameter mismatch, or an invalid destination. Do not retry automatically; needs operator review.",
    };
  }
  if (status === 408 || status === 429 || status >= 500) {
    return {
      outcome: "retryable_failure",
      errorCode: `AISENSY_TEMPORARY_${status}`,
      nextAction: "AiSensy returned a temporary/rate-limit/server error. Safe to retry.",
    };
  }
  return {
    outcome: "retryable_failure",
    errorCode: `AISENSY_UNEXPECTED_STATUS_${status}`,
    nextAction: "Unclassified AiSensy response status. Treated as retryable; escalate to an urgent task if it recurs.",
  };
}

function extractProviderRef(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  const candidate = record.messageId ?? record.id ?? record.message_id;
  return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
}

export const aiSensyWhatsApp: MessagingAdapter = {
  name: "aisensy",
  async send(input: SendMessageInput): Promise<AdapterResult<{ providerMessageId: string }>> {
    const normalized = normalizeIndianMobile(input.to);
    if (!normalized) {
      return {
        outcome: "permanent_failure",
        providerRef: null,
        errorCode: "INVALID_RECIPIENT",
        evidenceRefs: [],
        nextAction: "Recipient mobile number is missing or not a recognizable Indian mobile number. Correct the debtor's contact details before retrying.",
      };
    }

    // Only an approved, registered template may be sent, with exactly its
    // confirmed parameter count and no empty values (Meta rejects empty
    // parameters). These are application defects, not provider failures --
    // fail before any network call rather than let AiSensy reject or
    // mis-render a send.
    const def = getTemplateDefByKey(input.templateKey);
    if (!def) {
      return {
        outcome: "permanent_failure",
        providerRef: null,
        errorCode: "TEMPLATE_NOT_ACTIVATED",
        evidenceRefs: [],
        nextAction: "This WhatsApp template is not activated for sending. Do not retry automatically.",
      };
    }
    if (validateTemplateParams(def, input.templateParams) !== null) {
      return {
        outcome: "permanent_failure",
        providerRef: null,
        errorCode: "INVALID_TEMPLATE_PARAMS",
        evidenceRefs: [],
        nextAction: `The approved template needs exactly ${def.paramCount} non-empty parameters. This is an application defect -- do not retry automatically.`,
      };
    }

    let config: ReturnType<typeof getAiSensyConfig>;
    let campaignName: string;
    try {
      config = getAiSensyConfig();
      campaignName = getCampaignName(def.kind);
    } catch {
      return {
        outcome: "permanent_failure",
        providerRef: null,
        errorCode: "AISENSY_MISCONFIGURED",
        evidenceRefs: [],
        nextAction: "AiSensy WhatsApp delivery is not correctly configured. Contact an operator; do not retry automatically.",
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.sendTimeoutMs);

    try {
      const response = await fetch(CAMPAIGN_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: config.apiKey,
          campaignName,
          destination: normalized.destination,
          userName: input.templateParams![0] ?? "Customer",
          templateParams: input.templateParams,
        }),
        signal: controller.signal,
      });

      let parsedBody: unknown = null;
      try {
        parsedBody = await response.json();
      } catch {
        // AiSensy's response body shape is undocumented; a non-JSON or
        // empty body on an otherwise-200 response is not itself a failure.
        parsedBody = null;
      }

      if (!response.ok) {
        const classified = classifyAiSensyResponse(response.status);
        return {
          outcome: classified.outcome,
          providerRef: null,
          errorCode: classified.errorCode,
          evidenceRefs: [],
          nextAction: classified.nextAction,
        };
      }

      const providerRef = extractProviderRef(parsedBody);
      return {
        outcome: "success",
        providerRef,
        errorCode: null,
        evidenceRefs: [],
        nextAction: null,
        data: { providerMessageId: providerRef ?? "" },
      };
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return {
          outcome: "retryable_failure",
          providerRef: null,
          errorCode: "AISENSY_TIMEOUT",
          evidenceRefs: [],
          nextAction: `AiSensy did not respond within ${config.sendTimeoutMs}ms. Outcome is unknown -- treat as ambiguous, do not blindly resend.`,
        };
      }
      return {
        outcome: "retryable_failure",
        providerRef: null,
        errorCode: "AISENSY_NETWORK_ERROR",
        evidenceRefs: [],
        nextAction: "Network failure reaching AiSensy. Safe to retry.",
      };
    } finally {
      clearTimeout(timeout);
    }
  },

  // Real delivered/read confirmation requires AiSensy's Project Webhook
  // (HMAC-SHA256 X-AiSensy-Signature), not implemented in this task --
  // see the final report's webhook-assessment item. This is a documented
  // limitation, not a fabricated integration.
  parseWebhook() {
    return null;
  },
};
