/**
 * Adapter registry. One place to select the concrete provider per capability.
 * Env-driven so the same build runs against mocks (desktop/pilot) or real
 * providers (self-hosted). Government-portal adapters are capped at "assist"
 * regardless of automation mode (PRD §5, §11).
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
  switch (provider) {
    case "mock":
      return mockSet;
    // case "live": return liveSet;  // wired when real providers are provisioned
    default:
      return mockSet;
  }
}
