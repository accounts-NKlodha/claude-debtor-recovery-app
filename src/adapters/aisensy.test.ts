import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aiSensyWhatsApp, classifyAiSensyResponse } from "./aisensy";
import { WHATSAPP_MESSAGE_KINDS, WHATSAPP_TEMPLATES } from "@/domain/whatsapp-templates";

const ENV_KEYS = ["AISENSY_API_KEY", "AISENSY_CAMPAIGN_PAYMENT_REMINDER_INITIAL_V2", "AISENSY_SEND_TIMEOUT_MS"] as const;
const original: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) original[k] = process.env[k];

function setEnv(vars: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>) {
  for (const k of ENV_KEYS) {
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
}

const VALID_ENV = {
  AISENSY_API_KEY: "not-a-real-api-key",
  AISENSY_CAMPAIGN_PAYMENT_REMINDER_INITIAL_V2: "AISENSY_CAMPAIGN_PAYMENT_REMINDER_INITIAL_V2",
} as const;

const BASE_INPUT = {
  idempotencyKey: "test-key",
  caseId: "case-1",
  channel: "whatsapp" as const,
  to: "9876543210",
  body: "test body",
  templateKey: "payment_reminder_initial_v2",
  templateParams: ["Debtor Co", "INV-1", "1,000", "1 January 2026", "1,000", "Acme Textiles", "acme@upi", "Acme Payee"],
};

afterEach(() => {
  setEnv(original);
  vi.unstubAllGlobals();
});

describe("classifyAiSensyResponse", () => {
  it("classifies 401/403 as permanent auth failure", () => {
    expect(classifyAiSensyResponse(401).outcome).toBe("permanent_failure");
    expect(classifyAiSensyResponse(403).outcome).toBe("permanent_failure");
    expect(classifyAiSensyResponse(401).errorCode).toBe("AISENSY_AUTH_FAILED");
  });

  it("classifies 400/404/422 as permanent request-rejected", () => {
    for (const status of [400, 404, 422]) {
      const r = classifyAiSensyResponse(status);
      expect(r.outcome, `status ${status}`).toBe("permanent_failure");
      expect(r.errorCode).toBe(`AISENSY_REQUEST_REJECTED_${status}`);
    }
  });

  it("classifies 408/429/5xx as retryable", () => {
    for (const status of [408, 429, 500, 502, 503]) {
      expect(classifyAiSensyResponse(status).outcome, `status ${status}`).toBe("retryable_failure");
    }
  });

  it("defaults an unrecognized status to retryable rather than silently permanent", () => {
    expect(classifyAiSensyResponse(999).outcome).toBe("retryable_failure");
  });
});

describe("aiSensyWhatsApp.send", () => {
  beforeEach(() => setEnv(VALID_ENV));

  it("rejects a malformed/ambiguous recipient before ever touching config or the network", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await aiSensyWhatsApp.send({ ...BASE_INPUT, to: "12345" });
    expect(result.outcome).toBe("permanent_failure");
    expect(result.errorCode).toBe("INVALID_RECIPIENT");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a send with no template params rather than guessing a payload", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await aiSensyWhatsApp.send({ ...BASE_INPUT, templateParams: [] });
    expect(result.outcome).toBe("permanent_failure");
    expect(result.errorCode).toBe("INVALID_TEMPLATE_PARAMS");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses any template other than the activated V2 one, before any network call", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    for (const templateKey of ["payment_reminder_initial", "reminder_initial_v3", "payment_reminder_followup", undefined]) {
      const result = await aiSensyWhatsApp.send({ ...BASE_INPUT, templateKey });
      expect(result.outcome, String(templateKey)).toBe("permanent_failure");
      expect(result.errorCode).toBe("TEMPLATE_NOT_ACTIVATED");
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses the obsolete six-variable V1 parameter set and any other wrong count", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    for (const n of [0, 1, 6, 7, 9]) {
      const result = await aiSensyWhatsApp.send({
        ...BASE_INPUT,
        templateParams: BASE_INPUT.templateParams.concat(["x", "x", "x"]).slice(0, n),
      });
      expect(result.errorCode, `count ${n}`).toBe("INVALID_TEMPLATE_PARAMS");
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses an empty/blank parameter value (Meta rejects empty parameters)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    for (const idx of [0, 6, 7]) {
      const params = [...BASE_INPUT.templateParams];
      params[idx] = "  ";
      const result = await aiSensyWhatsApp.send({ ...BASE_INPUT, templateParams: params });
      expect(result.errorCode, `index ${idx}`).toBe("INVALID_TEMPLATE_PARAMS");
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fails closed (does not throw, does not silently succeed) when AiSensy is unconfigured", async () => {
    setEnv({ AISENSY_API_KEY: undefined, AISENSY_CAMPAIGN_PAYMENT_REMINDER_INITIAL_V2: undefined });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await aiSensyWhatsApp.send(BASE_INPUT);
    expect(result.outcome).toBe("permanent_failure");
    expect(result.errorCode).toBe("AISENSY_MISCONFIGURED");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/AISENSY_API_KEY/i);
  });

  it("normalizes the destination and sends the API key only in the request body, never as a header", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchSpy);
    await aiSensyWhatsApp.send(BASE_INPUT);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://backend.aisensy.com/campaign/t1/api/v2");
    const body = JSON.parse(init.body as string);
    expect(body.apiKey).toBe(VALID_ENV.AISENSY_API_KEY);
    expect(body.destination).toBe("+919876543210");
    expect(body.campaignName).toBe(VALID_ENV.AISENSY_CAMPAIGN_PAYMENT_REMINDER_INITIAL_V2);
    expect(body.templateParams).toEqual(BASE_INPUT.templateParams);
    expect(body.templateParams).toHaveLength(8);
    expect(body.userName).toBe("Debtor Co");
  });

  it("forwards amount variables with their leading space to AiSensy verbatim (no trimming in the adapter)", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchSpy);
    const params = ["Debtor Co", "INV-1", " 25,000", "1 January 2026", " 25,000", "Acme Textiles", "acme@upi", "Acme Payee"];
    await aiSensyWhatsApp.send({ ...BASE_INPUT, templateParams: params });
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
    expect(body.templateParams).toEqual(params);
    expect(body.templateParams[2]).toBe(" 25,000");
  });

  it("on HTTP 200, reports success and treats it as 'accepted', never fabricating a providerRef the response didn't contain", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchSpy);
    const result = await aiSensyWhatsApp.send(BASE_INPUT);
    expect(result.outcome).toBe("success");
    expect(result.providerRef).toBeNull();
  });

  it("captures a provider message id when the response body contains a recognizable id field", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ messageId: "wamid.abc123" }) });
    vi.stubGlobal("fetch", fetchSpy);
    const result = await aiSensyWhatsApp.send(BASE_INPUT);
    expect(result.providerRef).toBe("wamid.abc123");
  });

  it("classifies a non-200 response using classifyAiSensyResponse", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchSpy);
    const result = await aiSensyWhatsApp.send(BASE_INPUT);
    expect(result.outcome).toBe("permanent_failure");
    expect(result.errorCode).toBe("AISENSY_AUTH_FAILED");
  });

  it("treats a request timeout as an ambiguous, retryable outcome -- never a silent success", async () => {
    const fetchSpy = vi.fn().mockImplementation((_url: string, init: { signal: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    });
    vi.stubGlobal("fetch", fetchSpy);
    setEnv({ ...VALID_ENV, AISENSY_SEND_TIMEOUT_MS: "10" });
    const result = await aiSensyWhatsApp.send(BASE_INPUT);
    expect(result.outcome).toBe("retryable_failure");
    expect(result.errorCode).toBe("AISENSY_TIMEOUT");
  });

  it("treats a network error as retryable", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error("fetch failed"));
    vi.stubGlobal("fetch", fetchSpy);
    const result = await aiSensyWhatsApp.send(BASE_INPUT);
    expect(result.outcome).toBe("retryable_failure");
    expect(result.errorCode).toBe("AISENSY_NETWORK_ERROR");
  });

  it("never includes the API key anywhere in a returned AdapterResult", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchSpy);
    const result = await aiSensyWhatsApp.send(BASE_INPUT);
    expect(JSON.stringify(result)).not.toContain(VALID_ENV.AISENSY_API_KEY);
  });

  it("parseWebhook always returns null -- Project Webhook verification is not implemented in this task", () => {
    expect(aiSensyWhatsApp.parseWebhook({ anything: "at all" })).toBeNull();
    expect(aiSensyWhatsApp.parseWebhook(null)).toBeNull();
  });
});

describe("aiSensyWhatsApp.send: every approved template uses its own campaign and its own variable count", () => {
  beforeEach(() => {
    setEnv(VALID_ENV);
    for (const k of WHATSAPP_MESSAGE_KINDS) process.env[WHATSAPP_TEMPLATES[k].campaignEnvVar] = `Campaign for ${k}`;
  });
  afterEach(() => {
    for (const k of WHATSAPP_MESSAGE_KINDS) delete process.env[WHATSAPP_TEMPLATES[k].campaignEnvVar];
  });
  const paramsFor = (n: number) => Array.from({ length: n }, (_, i) => `v${i + 1}`);

  it.each(WHATSAPP_MESSAGE_KINDS)("%s: sends exactly its variables to its own campaign, key only in the body", async (kind) => {
    const def = WHATSAPP_TEMPLATES[kind];
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchSpy);
    const result = await aiSensyWhatsApp.send({ ...BASE_INPUT, templateKey: def.templateKey, templateParams: paramsFor(def.paramCount) });
    expect(result.outcome).toBe("success");
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
    expect(body.campaignName).toBe(`Campaign for ${kind}`);
    expect(body.templateParams).toEqual(paramsFor(def.paramCount));
    expect(fetchSpy.mock.calls[0][1].headers).toEqual({ "Content-Type": "application/json" });
  });

  it.each(WHATSAPP_MESSAGE_KINDS)("%s: refuses any wrong parameter count or blank value before any network call", async (kind) => {
    const def = WHATSAPP_TEMPLATES[kind];
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    for (const n of [0, def.paramCount - 1, def.paramCount + 1]) {
      const r = await aiSensyWhatsApp.send({ ...BASE_INPUT, templateKey: def.templateKey, templateParams: paramsFor(n) });
      expect(r.errorCode, `${kind} n=${n}`).toBe("INVALID_TEMPLATE_PARAMS");
    }
    const blank = paramsFor(def.paramCount);
    blank[def.paramCount - 1] = " ";
    expect((await aiSensyWhatsApp.send({ ...BASE_INPUT, templateKey: def.templateKey, templateParams: blank })).errorCode).toBe("INVALID_TEMPLATE_PARAMS");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a missing campaign for one message fails closed (no send) without affecting another message's campaign", async () => {
    delete process.env[WHATSAPP_TEMPLATES.payment_closed.campaignEnvVar];
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchSpy);
    const closed = WHATSAPP_TEMPLATES.payment_closed;
    const blocked = await aiSensyWhatsApp.send({ ...BASE_INPUT, templateKey: closed.templateKey, templateParams: paramsFor(closed.paramCount) });
    expect(blocked).toMatchObject({ outcome: "permanent_failure", errorCode: "AISENSY_MISCONFIGURED" });
    expect(fetchSpy).not.toHaveBeenCalled();
    const received = WHATSAPP_TEMPLATES.payment_received;
    const ok = await aiSensyWhatsApp.send({ ...BASE_INPUT, templateKey: received.templateKey, templateParams: paramsFor(received.paramCount) });
    expect(ok.outcome).toBe("success");
  });

  it("the approved-but-not-activated dispute acknowledgement template can never be sent", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const r = await aiSensyWhatsApp.send({ ...BASE_INPUT, templateKey: "payment_dispute_acknowledgement", templateParams: paramsFor(4) });
    expect(r.errorCode).toBe("TEMPLATE_NOT_ACTIVATED");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
