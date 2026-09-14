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
 * default outside production remains the mock. Every other capability
 * (whatsapp, gstPortal, msmePortal, ocr, ...) has no real provider yet and
 * stays mocked regardless of profile/environment -- implementing those is
 * explicitly out of scope for the email-delivery task.
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

export function getAdapters(): AdapterSet {
  const useLiveEmail = isProductionRuntime() || provider === "live";
  if (!useLiveEmail) return mockSet;
  return { ...mockSet, email: gmailSmtp };
}
