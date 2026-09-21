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

export function getAdapters(): AdapterSet {
  const useLiveEmail = isProductionRuntime() || provider === "live";
  const useLiveWhatsApp = whatsappProvider === "aisensy";
  return {
    ...mockSet,
    email: useLiveEmail ? gmailSmtp : mockGmail,
    whatsapp: useLiveWhatsApp ? aiSensyWhatsApp : mockWhatsApp,
  };
}
