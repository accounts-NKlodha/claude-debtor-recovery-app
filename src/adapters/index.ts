/**
 * Adapter registry. One place to select the concrete provider per capability.
 * Env-driven so the same build runs against mocks (desktop/pilot) or real
 * providers (self-hosted). Government-portal adapters are capped at "assist"
 * regardless of automation mode (PRD §5, §11).
 *
 * `email` is the one capability with a real, production-ready provider
 * (Gmail SMTP + Google App Password -- see docs/email-delivery/index.md).
 * Its selection is fail-closed like `src/server/repo.ts`'s data-layer
 * selection: in production it is ALWAYS the real adapter, never the mock,
 * regardless of `ADAPTER_PROFILE` -- forgetting to set that variable in
 * production must never silently degrade to fake sends. Outside
 * production, `ADAPTER_PROFILE=live` opts a developer into the real
 * adapter locally (e.g. for the one-off live-send acceptance test); the
 * default outside production remains the mock.
 *
 * `whatsapp` (AiSensy WhatsApp production integration task) is fail-closed
 * the OTHER way round from email: it defaults to the mock EVEN IN
 * PRODUCTION. An operator must explicitly set WHATSAPP_PROVIDER=aisensy to
 * go live -- forgetting to set it must never accidentally enable real
 * WhatsApp sends, since (unlike email) WhatsApp production readiness is
 * gated on a controlled live test and a per-template human sign-off, not
 * just secret configuration. Missing/malformed AiSensy configuration once
 * WHATSAPP_PROVIDER=aisensy IS set fails closed inside the adapter itself
 * (src/lib/config/aisensy.ts) -- never a silent fallback to a fake success.
 *
 * Which REAL email provider runs is chosen explicitly by EMAIL_PROVIDER:
 *   gmail-api  -- Gmail REST API over HTTPS (hosted / Cloudflare Workers production)
 *   gmail-smtp -- Nodemailer + App Password (self-hosted Node / local only; refused on Workers)
 * It is never inferred from which credentials happen to be present. Unset or
 * unknown fails closed (a permanent-failure adapter, never a mock, never a
 * silent SMTP fallback).
 *
 * Every other capability (gstPortal, msmePortal, ocr, ...) has no real
 * provider yet and stays mocked regardless of profile/environment.
 */

import type {
  CalendarAdapter,
  GstPortalAdapter,
  MessagingAdapter,
  MsmePortalAdapter,
  OcrAdapter,
  PaymentGatewayAdapter,
  ReplyClassifierAdapter,
} from "@/contract/adapters";
import { isProductionRuntime } from "@/lib/config/production";
import { gmailSmtp } from "./gmail-smtp";
import { gmailApi } from "./gmail-api";
import { aiSensyWhatsApp } from "./aisensy";
import {
  mockCalendar,
  mockGmail,
  mockGstPortal,
  mockMsmePortal,
  mockOcr,
  mockPaymentGateway,
  mockReplyClassifier,
  mockWhatsApp,
} from "./mock";

const provider = process.env.ADAPTER_PROFILE ?? "mock";
const whatsappProvider = process.env.WHATSAPP_PROVIDER ?? "disabled";

export interface AdapterSet {
  whatsapp: MessagingAdapter;
  email: MessagingAdapter;
  ocr: OcrAdapter;
  replyClassifier: ReplyClassifierAdapter;
  gstPortal: GstPortalAdapter;
  msmePortal: MsmePortalAdapter;
  calendar: CalendarAdapter;
  paymentGateway: PaymentGatewayAdapter;
}

const mockSet: AdapterSet = {
  whatsapp: mockWhatsApp,
  email: mockGmail,
  ocr: mockOcr,
  replyClassifier: mockReplyClassifier,
  gstPortal: mockGstPortal,
  msmePortal: mockMsmePortal,
  calendar: mockCalendar,
  paymentGateway: mockPaymentGateway,
};

/** Whether the real AiSensy WhatsApp adapter is the one `getAdapters()`
 * returns right now -- repository callers use this (rather than duplicating
 * the WHATSAPP_PROVIDER check) to decide whether to attempt a real
 * production WhatsApp send at all, e.g. before checking the kill switch or
 * normalizing a destination number. */
export function isLiveWhatsAppConfigured(): boolean {
  return whatsappProvider === "aisensy";
}

/** Cloudflare Workers identify themselves this way; raw SMTP sockets do not work there. */
function runsOnWorkers(): boolean {
  return typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";
}

function failClosedEmail(errorCode: string, why: string): MessagingAdapter {
  return {
    name: "email-misconfigured",
    async send() {
      return { outcome: "permanent_failure", providerRef: null, errorCode, evidenceRefs: [], nextAction: `${why} No message was sent. Do not retry automatically.` };
    },
    parseWebhook: () => null,
  };
}

/** Exported for tests. Real email requires an explicit EMAIL_PROVIDER; see the header comment. */
export function resolveEmailAdapter(): MessagingAdapter {
  const live = isProductionRuntime() || provider === "live";
  if (!live) return mockGmail;
  const chosen = (process.env.EMAIL_PROVIDER ?? "").trim();
  if (chosen === "gmail-api") return gmailApi;
  if (chosen === "gmail-smtp") {
    return runsOnWorkers()
      ? failClosedEmail("EMAIL_SMTP_NOT_SUPPORTED_ON_WORKERS", "Gmail SMTP cannot run on Cloudflare Workers; set EMAIL_PROVIDER=gmail-api.")
      : gmailSmtp;
  }
  if (chosen === "") return failClosedEmail("EMAIL_PROVIDER_NOT_SET", "EMAIL_PROVIDER must be set to gmail-api or gmail-smtp for real email.");
  return failClosedEmail("EMAIL_PROVIDER_UNKNOWN", "EMAIL_PROVIDER has an unsupported value.");
}

export function getAdapters(): AdapterSet {
  const useLiveWhatsApp = whatsappProvider === "aisensy";
  return {
    ...mockSet,
    email: resolveEmailAdapter(),
    whatsapp: useLiveWhatsApp ? aiSensyWhatsApp : mockWhatsApp,
  };
}
