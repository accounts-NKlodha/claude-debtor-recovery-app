/**
 * Typed demo data for the Debtrecover UI slice.
 * TODO(api): replace every selector in this file with a server fetch.
 * All money is integer paise (see contract/types Paise).
 */

import type {
  CaseHearing,
  Communication,
  CommunicationDelivery,
  DdRecord,
  Debtor,
  DebtorReply,
  ImportResult,
  Invoice,
  Organisation,
  PaymentAllocation,
  PaymentRecord,
  RecoveryCase,
  WorkflowTask,
} from "@/contract/types";
import { CLIENT_SAFE_LABEL } from "@/contract/enums";
import type { AdapterOutcome, CaseStatus, Channel, DeliveryStatus } from "@/contract/enums";
import { estimateSuccessFee } from "@/domain/fees";

const NOW = new Date("2026-09-11T09:30:00.000Z");
const iso = (daysFromNow: number, hour = 5) =>
  new Date(NOW.getTime() + daysFromNow * 86_400_000 + hour * 3_600_000).toISOString();
const date = (daysFromNow: number) => iso(daysFromNow).slice(0, 10);

/* ------------------------------------------------------------------ orgs -- */

export const ORGANISATIONS: Organisation[] = [
  {
    id: "org-1",
    clientCode: "NKL-ACME",
    legalEntityName: "Acme Industrial Supplies Pvt Ltd",
    creditorGstin: "08AACCA1234F1Z5",
    udyamNumber: "UDYAM-RJ-17-0012345",
    jitoMember: true,
    createdAt: iso(-420),
  },
  {
    id: "org-2",
    clientCode: "NKL-VERTEX",
    legalEntityName: "Vertex Polymers LLP",
    creditorGstin: "08AABCV5678K1Z2",
    udyamNumber: "UDYAM-RJ-17-0067890",
    jitoMember: false,
    createdAt: iso(-360),
  },
  {
    id: "org-3",
    clientCode: "NKL-SUNRISE",
    legalEntityName: "Sunrise Textiles Pvt Ltd",
    creditorGstin: "08AADCS9012M1Z9",
    udyamNumber: null,
    jitoMember: true,
    createdAt: iso(-300),
  },
  {
    id: "org-4",
    clientCode: "NKL-ORBIT",
    legalEntityName: "Orbit Logistics Pvt Ltd",
    creditorGstin: null,
    udyamNumber: "UDYAM-RJ-17-0099001",
    jitoMember: false,
    createdAt: iso(-210),
  },
];

/* --------------------------------------------------------------- debtors -- */

export const DEBTORS: Debtor[] = [
  {
    id: "deb-1",
    organisationId: "org-1",
    name: "Nirvana Retail Chains Pvt Ltd",
    mobile: "+919812345678",
    email: "accounts@nirvanaretail.example",
    gstin: "08AAFCN1111P1Z4",
    address: "Plot 14, RIICO Industrial Area, Jaipur, Rajasthan",
    contactVerified: true,
    totalDue: 184_50_000,
  },
  {
    id: "deb-2",
    organisationId: "org-1",
    name: "Kaveri Constructions",
    mobile: "+919898989898",
    email: null,
    gstin: "08AAKFK2222Q1Z1",
    address: "MI Road, Jaipur, Rajasthan",
    contactVerified: false,
    totalDue: 42_00_000,
  },
  {
    id: "deb-3",
    organisationId: "org-2",
    name: "Delta Packaging Co",
    mobile: "+919700011122",
    email: "finance@deltapack.example",
    gstin: "08AADCD3333R1Z8",
    address: "Sitapura, Jaipur, Rajasthan",
    contactVerified: true,
    totalDue: 96_75_000,
  },
  {
    id: "deb-4",
    organisationId: "org-2",
    name: "Highline Interiors LLP",
    mobile: null,
    email: "ap@highline.example",
    gstin: null,
    address: "Vaishali Nagar, Jaipur, Rajasthan",
    contactVerified: false,
    totalDue: 12_30_000,
  },
  {
    id: "deb-5",
    organisationId: "org-3",
    name: "Monsoon Apparel Exports Pvt Ltd",
    mobile: "+919600055667",
    email: "payments@monsoonapparel.example",
    gstin: "08AAECM4444S1Z6",
    address: "Bhilwara, Rajasthan",
    contactVerified: true,
    totalDue: 271_00_000,
  },
  {
    id: "deb-6",
    organisationId: "org-4",
    name: "Cargo Bridge Freight Pvt Ltd",
    mobile: "+919500099887",
    email: "accounts@cargobridge.example",
    gstin: "08AAGCC5555T1Z3",
    address: "Transport Nagar, Jaipur, Rajasthan",
    contactVerified: true,
    totalDue: 58_20_000,
  },
];

/* ----------------------------------------------------------------- cases -- */

export const CASES: RecoveryCase[] = [
  {
    id: "case-1",
    organisationId: "org-1",
    debtorId: "deb-1",
    status: "initial_communication_sent",
    automationMode: "assist",
    waitingOn: "system",
    automationStartedAt: iso(-6),
    currentStep: "24-hour response timer running",
    blocker: null,
    nextScheduledAction: "Evaluate GST eligibility route",
    nextScheduledAt: iso(0, 5),
    eligibilityRoute: null,
    principalOutstanding: 184_50_000,
    recoveredToDate: 0,
    assigneeId: "user-1",
    groupKey: "NIR-2026-Q2",
    createdAt: iso(-8),
    activatedAt: iso(-6),
    closedAt: null,
  },
  {
    id: "case-2",
    organisationId: "org-1",
    debtorId: "deb-2",
    status: "contact_update_required",
    automationMode: "prepare",
    waitingOn: "client",
    automationStartedAt: iso(-4),
    currentStep: "Both channels failed on initial reminder",
    blocker: "WhatsApp undelivered and no email on file — need a verified contact",
    nextScheduledAction: "Retry initial reminder once contact is corrected",
    nextScheduledAt: null,
    eligibilityRoute: null,
    principalOutstanding: 42_00_000,
    recoveredToDate: 0,
    assigneeId: "user-2",
    groupKey: null,
    createdAt: iso(-5),
    activatedAt: iso(-4),
    closedAt: null,
  },
  {
    id: "case-3",
    organisationId: "org-2",
    debtorId: "deb-3",
    status: "gst_notification_filed",
    automationMode: "assist",
    waitingOn: "portal",
    automationStartedAt: iso(-19),
    currentStep: "7-day GST response timer running",
    blocker: null,
    nextScheduledAction: "Evaluate MSME ODR eligibility",
    nextScheduledAt: iso(2, 5),
    eligibilityRoute: "gst",
    principalOutstanding: 96_75_000,
    recoveredToDate: 0,
    assigneeId: "user-1",
    groupKey: null,
    createdAt: iso(-22),
    activatedAt: iso(-19),
    closedAt: null,
  },
  {
    id: "case-4",
    organisationId: "org-2",
    debtorId: "deb-4",
    status: "correction_required",
    automationMode: "manual",
    waitingOn: "staff",
    automationStartedAt: iso(-2),
    currentStep: "OCR extraction below confidence threshold",
    blocker: "Invoice total and tax amount could not be read — needs manual entry",
    nextScheduledAction: "Staff validation of extracted invoice fields",
    nextScheduledAt: null,
    eligibilityRoute: null,
    principalOutstanding: 12_30_000,
    recoveredToDate: 0,
    assigneeId: "user-2",
    groupKey: null,
    createdAt: iso(-2),
    activatedAt: null,
    closedAt: null,
  },
  {
    id: "case-5",
    organisationId: "org-3",
    debtorId: "deb-5",
    status: "promise_to_pay",
    automationMode: "assist",
    waitingOn: "client",
    automationStartedAt: iso(-31),
    currentStep: "Promise-to-pay tracking — instalment 1 due",
    blocker: null,
    nextScheduledAction: "Check for instalment 1 receipt",
    nextScheduledAt: iso(1, 5),
    eligibilityRoute: null,
    principalOutstanding: 271_00_000,
    recoveredToDate: 90_00_000,
    assigneeId: "user-1",
    groupKey: "MON-2026",
    createdAt: iso(-40),
    activatedAt: iso(-31),
    closedAt: null,
  },
  {
    id: "case-6",
    organisationId: "org-3",
    debtorId: "deb-5",
    status: "dispute_settlement",
    automationMode: "prepare",
    waitingOn: "staff",
    automationStartedAt: iso(-24),
    currentStep: "Debtor raised a quality dispute on 2 invoices",
    blocker: "Settlement offer of ₹18,000 needs staff/legal review before response",
    nextScheduledAction: "Staff decision on settlement offer",
    nextScheduledAt: null,
    eligibilityRoute: null,
    principalOutstanding: 47_00_000,
    recoveredToDate: 0,
    assigneeId: "user-2",
    groupKey: null,
    createdAt: iso(-28),
    activatedAt: iso(-24),
    closedAt: null,
  },
  {
    id: "case-7",
    organisationId: "org-4",
    debtorId: "deb-6",
    status: "msme_odr_filed",
    automationMode: "assist",
    waitingOn: "portal",
    automationStartedAt: iso(-52),
    currentStep: "MSME ODR filed — awaiting MSEFC listing",
    blocker: null,
    nextScheduledAction: "Poll MSEFC portal for hearing date",
    nextScheduledAt: iso(3, 5),
    eligibilityRoute: "msme",
    principalOutstanding: 58_20_000,
    recoveredToDate: 0,
    assigneeId: "user-1",
    groupKey: null,
    createdAt: iso(-60),
    activatedAt: iso(-52),
    closedAt: null,
  },
  {
    id: "case-8",
    organisationId: "org-1",
    debtorId: "deb-1",
    status: "payment_confirmation_required",
    automationMode: "assist",
    waitingOn: "client",
    automationStartedAt: iso(-14),
    currentStep: "Debtor reply parsed as payment made",
    blocker: "Client must confirm ₹25,000 receipt before escalation is cancelled",
    nextScheduledAction: "Cancel pending GST escalation on confirmation",
    nextScheduledAt: null,
    eligibilityRoute: null,
    principalOutstanding: 25_00_000,
    recoveredToDate: 0,
    assigneeId: "user-1",
    groupKey: "NIR-2026-Q2",
    createdAt: iso(-16),
    activatedAt: iso(-14),
    closedAt: null,
  },
  {
    id: "case-9",
    organisationId: "org-4",
    debtorId: "deb-6",
    status: "recovered",
    automationMode: "automatic",
    waitingOn: "system",
    automationStartedAt: iso(-70),
    currentStep: "Full payment received and confirmed",
    blocker: null,
    nextScheduledAction: null,
    nextScheduledAt: null,
    eligibilityRoute: null,
    principalOutstanding: 0,
    recoveredToDate: 33_60_000,
    assigneeId: "user-2",
    groupKey: null,
    createdAt: iso(-80),
    activatedAt: iso(-70),
    closedAt: iso(-9),
  },
  {
    id: "case-10",
    organisationId: "org-2",
    debtorId: "deb-4",
    status: "active",
    automationMode: "assist",
    waitingOn: "system",
    automationStartedAt: iso(-1),
    currentStep: "Certification + validation + age gate cleared",
    blocker: null,
    nextScheduledAction: "Send initial reminder at next 11:00 IST window",
    nextScheduledAt: iso(0, 5),
    eligibilityRoute: null,
    principalOutstanding: 55_00_000,
    recoveredToDate: 0,
    assigneeId: "user-2",
    groupKey: null,
    createdAt: iso(-3),
    activatedAt: iso(-1),
    closedAt: null,
  },
  {
    id: "case-11",
    organisationId: "org-1",
    debtorId: "deb-2",
    status: "gst_eligibility_review",
    automationMode: "assist",
    waitingOn: "staff",
    automationStartedAt: iso(-25),
    currentStep: "Confirm creditor + debtor GST registration",
    blocker: "Confirm creditor and debtor GST registration before preparing the notification",
    nextScheduledAction: "Decide GST route",
    nextScheduledAt: null,
    eligibilityRoute: null,
    principalOutstanding: 42_00_000,
    recoveredToDate: 0,
    assigneeId: "user-2",
    groupKey: null,
    createdAt: iso(-27),
    activatedAt: iso(-25),
    closedAt: null,
  },
  {
    id: "case-12",
    organisationId: "org-2",
    debtorId: "deb-4",
    status: "msme_eligibility_review",
    automationMode: "assist",
    waitingOn: "staff",
    automationStartedAt: iso(-40),
    currentStep: "Confirm creditor Udyam / MSME eligibility",
    blocker: "Confirm creditor Udyam / MSME eligibility",
    nextScheduledAction: "Decide MSME route",
    nextScheduledAt: null,
    eligibilityRoute: null,
    principalOutstanding: 20_00_000,
    recoveredToDate: 0,
    assigneeId: "user-1",
    groupKey: null,
    createdAt: iso(-45),
    activatedAt: iso(-43),
    closedAt: null,
  },
];

/* -------------------------------------------------------------- invoices -- */

export const INVOICES: Invoice[] = [
  {
    id: "inv-1",
    caseId: "case-1",
    organisationId: "org-1",
    debtorId: "deb-1",
    invoiceNumber: "ACM/2026/0417",
    invoiceDate: date(-96),
    dueDate: date(-66),
    taxableValue: 156_35_593,
    taxRate: 18,
    taxAmount: 28_14_407,
    invoiceTotal: 184_50_000,
    outstandingBalance: 184_50_000,
    sourceDocumentId: "doc-1",
    extractionConfidence: 0.97,
  },
  {
    id: "inv-2",
    caseId: "case-4",
    organisationId: "org-2",
    debtorId: "deb-4",
    invoiceNumber: "VTX/2026/1180",
    invoiceDate: date(-40),
    dueDate: date(-10),
    taxableValue: 10_42_373,
    taxRate: 18,
    taxAmount: 1_87_627,
    invoiceTotal: 12_30_000,
    outstandingBalance: 12_30_000,
    sourceDocumentId: "doc-2",
    extractionConfidence: 0.58,
  },
  {
    id: "inv-3",
    caseId: "case-5",
    organisationId: "org-3",
    debtorId: "deb-5",
    invoiceNumber: "SNR/2026/2231",
    invoiceDate: date(-120),
    dueDate: date(-90),
    taxableValue: 305_93_220,
    taxRate: 18,
    taxAmount: 55_06_780,
    invoiceTotal: 361_00_000,
    outstandingBalance: 271_00_000,
    sourceDocumentId: "doc-3",
    extractionConfidence: 0.92,
  },
  {
    id: "inv-4",
    caseId: "case-10",
    organisationId: "org-2",
    debtorId: "deb-4",
    invoiceNumber: "VTX/2026/1305",
    invoiceDate: date(-65),
    dueDate: date(-35),
    taxableValue: 46_61_017,
    taxRate: 18,
    taxAmount: 8_38_983,
    invoiceTotal: 55_00_000,
    outstandingBalance: 55_00_000,
    sourceDocumentId: "doc-4",
    extractionConfidence: 0.95,
  },
  {
    id: "inv-5",
    caseId: "case-11",
    organisationId: "org-1",
    debtorId: "deb-2",
    invoiceNumber: "ACM/2026/0388",
    invoiceDate: date(-90),
    dueDate: date(-60),
    taxableValue: 35_59_322,
    taxRate: 18,
    taxAmount: 6_40_678,
    invoiceTotal: 42_00_000,
    outstandingBalance: 42_00_000,
    sourceDocumentId: "doc-5",
    extractionConfidence: 0.94,
  },
  {
    id: "inv-6",
    caseId: "case-12",
    organisationId: "org-2",
    debtorId: "deb-4",
    invoiceNumber: "VTX/2026/0975",
    invoiceDate: date(-110),
    dueDate: date(-80),
    taxableValue: 16_94_915,
    taxRate: 18,
    taxAmount: 3_05_085,
    invoiceTotal: 20_00_000,
    outstandingBalance: 20_00_000,
    sourceDocumentId: "doc-6",
    extractionConfidence: 0.9,
  },
];

/* -------------------------------------------------------- communications -- */

export const COMMUNICATIONS: Communication[] = [
  {
    id: "com-1",
    caseId: "case-1",
    organisationId: "org-1",
    channel: "whatsapp",
    direction: "outbound",
    templateKey: "reminder_initial_v3",
    templateVersion: 3,
    subject: null,
    body: "Namaste, this is N K Lodha & Co on behalf of Acme Industrial Supplies. Invoice ACM/2026/0417 for ₹1,84,50,000 is overdue. Kindly arrange payment or reply here.",
    providerMessageId: "wamid.HBg1",
    threadRef: "thread-1",
    deliveryStatus: "read",
    hasSecureLink: true,
    idempotencyKey: null,
    replyClassification: null,
    reviewedById: null,
    createdAt: iso(-6, 5),
    deliveredAt: iso(-6, 5),
  },
  {
    id: "com-2",
    caseId: "case-1",
    organisationId: "org-1",
    channel: "whatsapp",
    direction: "inbound",
    templateKey: null,
    templateVersion: null,
    subject: null,
    body: "We have shared this with our accounts team, will revert by end of week.",
    providerMessageId: "wamid.HBg2",
    threadRef: "thread-1",
    deliveryStatus: "delivered",
    hasSecureLink: false,
    idempotencyKey: null,
    replyClassification: "unclear",
    reviewedById: "user-1",
    createdAt: iso(-5, 8),
    deliveredAt: iso(-5, 8),
  },
  {
    id: "com-3",
    caseId: "case-2",
    organisationId: "org-1",
    channel: "whatsapp",
    direction: "outbound",
    templateKey: "reminder_initial_v3",
    templateVersion: 3,
    subject: null,
    body: "Reminder regarding overdue invoice KVR/2026/0091.",
    providerMessageId: null,
    threadRef: "thread-2",
    deliveryStatus: "failed",
    hasSecureLink: true,
    idempotencyKey: null,
    replyClassification: null,
    reviewedById: null,
    createdAt: iso(-4, 5),
    deliveredAt: null,
  },
  {
    id: "com-4",
    caseId: "case-3",
    organisationId: "org-2",
    channel: "email",
    direction: "outbound",
    templateKey: "gst_notification_v2",
    templateVersion: 2,
    subject: "GST communication filed — Delta Packaging Co",
    body: "A taxpayer communication has been filed on the GST portal regarding outstanding dues.",
    providerMessageId: "ses-0001",
    threadRef: "thread-3",
    deliveryStatus: "delivered",
    hasSecureLink: false,
    idempotencyKey: null,
    replyClassification: null,
    reviewedById: "user-1",
    createdAt: iso(-12, 5),
    deliveredAt: iso(-12, 5),
  },
  {
    id: "com-5",
    caseId: "case-8",
    organisationId: "org-1",
    channel: "whatsapp",
    direction: "inbound",
    templateKey: null,
    templateVersion: null,
    subject: null,
    body: "Payment of ₹25,000 done by RTGS on 5th, UTR SBIN0026XXXX. Please confirm.",
    providerMessageId: "wamid.HBg9",
    threadRef: "thread-8",
    deliveryStatus: "delivered",
    hasSecureLink: false,
    idempotencyKey: null,
    replyClassification: "payment_made",
    reviewedById: "user-1",
    createdAt: iso(-3, 6),
    deliveredAt: iso(-3, 6),
  },
  {
    id: "com-6",
    caseId: "case-6",
    organisationId: "org-3",
    channel: "email",
    direction: "inbound",
    templateKey: null,
    templateVersion: null,
    subject: "Re: Outstanding dues — quality issue",
    body: "We dispute invoices SNR/2026/2210 and 2214 due to defective goods. We can settle the balance at ₹18,000.",
    providerMessageId: "ses-0044",
    threadRef: "thread-6",
    deliveryStatus: "delivered",
    hasSecureLink: false,
    idempotencyKey: null,
    replyClassification: "settlement_offer",
    reviewedById: "user-2",
    createdAt: iso(-10, 7),
    deliveredAt: iso(-10, 7),
  },
];

/* -------------------------------------------------------------- payments -- */

export const PAYMENTS: PaymentRecord[] = [
  {
    id: "pay-1",
    caseId: "case-5",
    organisationId: "org-3",
    kind: "bank",
    amount: 60_00_000,
    receivedOn: date(-20),
    reference: "UTR HDFC0031AA",
    clientConfirmed: true,
    createdAt: iso(-20, 6),
  },
  {
    id: "pay-2",
    caseId: "case-5",
    organisationId: "org-3",
    kind: "tds",
    amount: 30_00_000,
    receivedOn: date(-20),
    reference: "26AS Q2 FY26-27",
    clientConfirmed: true,
    createdAt: iso(-20, 6),
  },
  {
    id: "pay-3",
    caseId: "case-8",
    organisationId: "org-1",
    kind: "bank",
    amount: 25_00_000,
    receivedOn: date(-6),
    reference: "UTR SBIN0026XXXX",
    clientConfirmed: false,
    createdAt: iso(-3, 6),
  },
  {
    id: "pay-4",
    caseId: "case-9",
    organisationId: "org-4",
    kind: "bank",
    amount: 33_60_000,
    receivedOn: date(-11),
    reference: "UTR ICIC0088BB",
    clientConfirmed: true,
    createdAt: iso(-11, 6),
  },
  {
    id: "pay-5",
    caseId: "case-6",
    organisationId: "org-3",
    kind: "settlement",
    amount: 18_00_000,
    receivedOn: date(-1),
    reference: "Proposed — pending approval",
    clientConfirmed: false,
    createdAt: iso(-1, 6),
  },
];

/* ----------------------------------------------------------------- tasks -- */

export const TASKS: WorkflowTask[] = [
  {
    id: "task-1",
    caseId: "case-4",
    organisationId: "org-2",
    type: "ocr_low_confidence",
    title: "Confirm invoice total & tax for VTX/2026/1180",
    waitingOn: "staff",
    assigneeId: "user-2",
    urgent: true,
    dueAt: iso(0, 9),
    resolvedAt: null,
    createdAt: iso(-2, 4),
  },
  {
    id: "task-2",
    caseId: "case-6",
    organisationId: "org-3",
    type: "settlement_approval",
    title: "Approve or reject ₹18,000 settlement offer — Monsoon Apparel",
    waitingOn: "staff",
    assigneeId: "user-2",
    urgent: true,
    dueAt: iso(-1, 9),
    resolvedAt: null,
    createdAt: iso(-9, 8),
  },
  {
    id: "task-3",
    caseId: "case-2",
    organisationId: "org-1",
    type: "contact_correction",
    title: "Get a verified phone/email for Kaveri Constructions",
    waitingOn: "client",
    assigneeId: "user-2",
    urgent: false,
    dueAt: iso(1, 9),
    resolvedAt: null,
    createdAt: iso(-4, 6),
  },
  {
    id: "task-4",
    caseId: "case-8",
    organisationId: "org-1",
    type: "payment_confirmation",
    title: "Client to confirm ₹25,000 RTGS receipt — Nirvana Retail",
    waitingOn: "client",
    assigneeId: "user-1",
    urgent: true,
    dueAt: iso(0, 12),
    resolvedAt: null,
    createdAt: iso(-3, 7),
  },
  {
    id: "task-5",
    caseId: "case-3",
    organisationId: "org-2",
    type: "gst_portal_run",
    title: "Assisted GST portal session — human completes CAPTCHA & Send",
    waitingOn: "portal",
    assigneeId: "user-1",
    urgent: false,
    dueAt: iso(2, 9),
    resolvedAt: null,
    createdAt: iso(-1, 5),
  },
  {
    id: "task-6",
    caseId: "case-7",
    organisationId: "org-4",
    type: "hearing_followup",
    title: "Confirm MSEFC hearing date for Cargo Bridge Freight",
    waitingOn: "portal",
    assigneeId: "user-1",
    urgent: false,
    dueAt: iso(3, 9),
    resolvedAt: null,
    createdAt: iso(-5, 5),
  },
  {
    id: "task-7",
    caseId: "case-1",
    organisationId: "org-1",
    type: "staff_validation",
    title: "Review debtor reply before GST route — Nirvana Retail",
    waitingOn: "staff",
    assigneeId: "user-1",
    urgent: false,
    dueAt: iso(0, 15),
    resolvedAt: null,
    createdAt: iso(-5, 9),
  },
  {
    id: "task-8",
    caseId: null,
    organisationId: "org-1",
    type: "policy_gate",
    title: "Acme: approve automation mode change to 'automatic' for reminders",
    waitingOn: "staff",
    assigneeId: "user-1",
    urgent: false,
    dueAt: null,
    resolvedAt: null,
    createdAt: iso(-1, 3),
  },
];

/* ------------------------------------------------------------- selectors -- */

export function getOrg(id: string) {
  return ORGANISATIONS.find((o) => o.id === id);
}
export function getDebtor(id: string) {
  return DEBTORS.find((d) => d.id === id);
}
export function getCase(id: string) {
  return CASES.find((c) => c.id === id);
}
export function listCasesForOrg(orgId: string) {
  return CASES.filter((c) => c.organisationId === orgId);
}
export function listInvoicesForCase(caseId: string) {
  return INVOICES.filter((i) => i.caseId === caseId);
}
export function listCommunicationsForCase(caseId: string) {
  return COMMUNICATIONS.filter((c) => c.caseId === caseId).sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
}
export function listPaymentsForCase(caseId: string) {
  return PAYMENTS.filter((p) => p.caseId === caseId);
}
export function listTasksForCase(caseId: string) {
  return TASKS.filter((t) => t.caseId === caseId);
}
export function openTasks() {
  return TASKS.filter((t) => !t.resolvedAt);
}

/* ---------------------------------------------------- workflow durability -- */
/* P0-5: payment allocations, DD records, hearings, debtor replies -- start
 * empty (no seeded demo state for these; they materialize only from real
 * mutations, same as production). */

export const PAYMENT_ALLOCATIONS: PaymentAllocation[] = [];
export const DD_RECORDS: DdRecord[] = [];
export const CASE_HEARINGS: CaseHearing[] = [];
export const DEBTOR_REPLIES: DebtorReply[] = [];

let taskSeq = TASKS.length;
export function insertTask(task: Omit<WorkflowTask, "id" | "createdAt" | "resolvedAt">) {
  taskSeq += 1;
  const created: WorkflowTask = { ...task, id: `task-${taskSeq}`, resolvedAt: null, createdAt: new Date().toISOString() };
  TASKS.push(created);
  return created;
}

/** Idempotent: raising a task while one of the same (caseId, type) is
 * already open returns the existing row unchanged, matching
 * raise_workflow_task() in supabase/migrations/0012_p0_5_workflow_durability.sql. */
export function raiseTaskIfNotOpen(task: Omit<WorkflowTask, "id" | "createdAt" | "resolvedAt">) {
  const existing = TASKS.find((t) => t.caseId === task.caseId && t.type === task.type && !t.resolvedAt);
  if (existing) return existing;
  return insertTask(task);
}

export function resolveTask(id: string) {
  const idx = TASKS.findIndex((t) => t.id === id);
  if (idx === -1) throw new Error(`resolveTask: task ${id} not found`);
  if (TASKS[idx].resolvedAt) return TASKS[idx]; // idempotent no-op, see resolve_workflow_task()
  TASKS[idx] = { ...TASKS[idx], resolvedAt: new Date().toISOString() };
  return TASKS[idx];
}

/** Auto-resolve every open task for a case reaching a terminal status,
 * mirroring close_case_tasks_if_terminal() in the same migration. */
export function closeCaseTasksIfTerminal(caseId: string, status: CaseStatus) {
  if (!["recovered", "closed", "withdrawn", "archived"].includes(status)) return;
  for (const t of TASKS) {
    if (t.caseId === caseId && !t.resolvedAt) t.resolvedAt = new Date().toISOString();
  }
}

export function getDdRecord(caseId: string) {
  return DD_RECORDS.find((d) => d.caseId === caseId);
}

/** Upsert semantics matching prepare_dd(): create on first call, merge
 * non-null fields on subsequent calls, reject once submitted. */
export function upsertDdRecord(
  caseId: string,
  organisationId: string,
  input: { amount?: number | null; payee?: string | null; reference?: string | null; notes?: string | null },
): DdRecord {
  const existing = getDdRecord(caseId);
  if (existing?.status === "submitted") {
    throw new Error(`prepare_dd: DD for case ${caseId} is already submitted -- cannot re-prepare`);
  }
  const now = new Date().toISOString();
  if (existing) {
    const idx = DD_RECORDS.indexOf(existing);
    DD_RECORDS[idx] = {
      ...existing,
      amount: input.amount ?? existing.amount,
      payee: input.payee ?? existing.payee,
      reference: input.reference ?? existing.reference,
      notes: input.notes ?? existing.notes,
      status: existing.status === "preparation_pending" ? "prepared" : existing.status,
      preparedAt: existing.preparedAt ?? now,
      updatedAt: now,
    };
    return DD_RECORDS[idx];
  }
  const created: DdRecord = {
    id: `dd-${DD_RECORDS.length + 1}`,
    organisationId,
    caseId,
    status: "prepared",
    amount: input.amount ?? null,
    payee: input.payee ?? null,
    reference: input.reference ?? null,
    preparedAt: now,
    submittedAt: null,
    documentId: null,
    notes: input.notes ?? null,
    createdAt: now,
    updatedAt: now,
  };
  DD_RECORDS.push(created);
  return created;
}

export function markDdSubmitted(
  caseId: string,
  input: { submittedAt?: string | null; documentId?: string | null },
): DdRecord {
  const existing = getDdRecord(caseId);
  if (!existing) throw new Error(`record_dd_submitted: no DD prepared for case ${caseId}`);
  if (existing.status === "submitted") return existing; // idempotent no-op
  const idx = DD_RECORDS.indexOf(existing);
  DD_RECORDS[idx] = {
    ...existing,
    status: "submitted",
    submittedAt: input.submittedAt ?? new Date().toISOString(),
    documentId: input.documentId ?? existing.documentId,
    updatedAt: new Date().toISOString(),
  };
  return DD_RECORDS[idx];
}

export function listHearingsForCase(caseId: string) {
  return CASE_HEARINGS.filter((h) => h.caseId === caseId).sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt));
}

function openHearing(caseId: string) {
  return CASE_HEARINGS.find((h) => h.caseId === caseId && h.status === "scheduled");
}

/** Matches schedule_hearing(): idempotent on an exact-date repeat, rejects a
 * different date while one is already open. */
export function insertHearing(
  organisationId: string,
  caseId: string,
  input: {
    scheduledAt: string;
    forum?: string | null;
    authority?: string | null;
    caseReference?: string | null;
    assignedStaffId?: string | null;
    notes?: string | null;
  },
): CaseHearing {
  const existing = openHearing(caseId);
  if (existing) {
    if (existing.scheduledAt === input.scheduledAt) return existing;
    throw new Error(`schedule_hearing: a hearing is already scheduled for case ${caseId} -- use reschedule instead`);
  }
  const now = new Date().toISOString();
  const created: CaseHearing = {
    id: `hearing-${CASE_HEARINGS.length + 1}`,
    organisationId,
    caseId,
    calendarEventId: null,
    forum: input.forum ?? null,
    authority: input.authority ?? null,
    caseReference: input.caseReference ?? null,
    assignedStaffId: input.assignedStaffId ?? null,
    scheduledAt: input.scheduledAt,
    status: "scheduled",
    result: null,
    rescheduledFromId: null,
    notes: input.notes ?? null,
    createdAt: now,
    updatedAt: now,
  };
  CASE_HEARINGS.push(created);
  return created;
}

/** Matches reschedule_hearing(): adjourns the current occurrence, inserts a new one. */
export function rescheduleHearingRecord(
  hearingId: string,
  input: {
    newScheduledAt: string;
    forum?: string | null;
    authority?: string | null;
    caseReference?: string | null;
    assignedStaffId?: string | null;
    notes?: string | null;
  },
): CaseHearing {
  const old = CASE_HEARINGS.find((h) => h.id === hearingId);
  if (!old) throw new Error(`reschedule_hearing: hearing ${hearingId} not found`);
  if (old.status !== "scheduled") {
    throw new Error(`reschedule_hearing: hearing ${hearingId} is not currently scheduled (status ${old.status})`);
  }
  const now = new Date().toISOString();
  const idx = CASE_HEARINGS.indexOf(old);
  CASE_HEARINGS[idx] = { ...old, status: "adjourned", updatedAt: now };
  const created: CaseHearing = {
    id: `hearing-${CASE_HEARINGS.length + 1}`,
    organisationId: old.organisationId,
    caseId: old.caseId,
    calendarEventId: null,
    forum: input.forum ?? old.forum,
    authority: input.authority ?? old.authority,
    caseReference: input.caseReference ?? old.caseReference,
    assignedStaffId: input.assignedStaffId ?? old.assignedStaffId,
    scheduledAt: input.newScheduledAt,
    status: "scheduled",
    result: null,
    rescheduledFromId: hearingId,
    notes: input.notes ?? null,
    createdAt: now,
    updatedAt: now,
  };
  CASE_HEARINGS.push(created);
  return created;
}

/** Matches record_hearing_outcome(): idempotent once terminal. */
export function markHearingOutcome(
  hearingId: string,
  status: "completed" | "cancelled",
  result: string | null,
): CaseHearing {
  const existing = CASE_HEARINGS.find((h) => h.id === hearingId);
  if (!existing) throw new Error(`record_hearing_outcome: hearing ${hearingId} not found`);
  if (existing.status === "completed" || existing.status === "cancelled") return existing;
  const idx = CASE_HEARINGS.indexOf(existing);
  CASE_HEARINGS[idx] = { ...existing, status, result, updatedAt: new Date().toISOString() };
  return CASE_HEARINGS[idx];
}

export function listDebtorRepliesForCase(caseId: string) {
  return DEBTOR_REPLIES.filter((r) => r.caseId === caseId).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
}

export function insertDebtorReply(
  organisationId: string,
  caseId: string,
  input: {
    channel: DebtorReply["channel"];
    rawBody: string;
    communicationId?: string | null;
    classification: NonNullable<DebtorReply["classification"]>;
  },
  reviewedById: string,
): DebtorReply {
  const now = new Date().toISOString();
  const created: DebtorReply = {
    id: `reply-${DEBTOR_REPLIES.length + 1}`,
    organisationId,
    caseId,
    communicationId: input.communicationId ?? null,
    channel: input.channel,
    rawBody: input.rawBody,
    classification: input.classification,
    classificationConfidence: null,
    reviewedById,
    reviewedAt: now,
    receivedAt: now,
  };
  DEBTOR_REPLIES.push(created);
  return created;
}

export function listAllocationsForCase(caseId: string) {
  const paymentIds = new Set(PAYMENTS.filter((p) => p.caseId === caseId).map((p) => p.id));
  return PAYMENT_ALLOCATIONS.filter((a) => paymentIds.has(a.paymentRecordId));
}

/** Matches the `on conflict (payment_record_id, invoice_id) do nothing`
 * guard in apply_payment_confirmation(). */
export function insertAllocation(alloc: Omit<PaymentAllocation, "id" | "createdAt">) {
  const dup = PAYMENT_ALLOCATIONS.some(
    (a) => a.paymentRecordId === alloc.paymentRecordId && a.invoiceId === alloc.invoiceId,
  );
  if (dup) return;
  PAYMENT_ALLOCATIONS.push({ ...alloc, id: `alloc-${PAYMENT_ALLOCATIONS.length + 1}`, createdAt: new Date().toISOString() });
}

/* ------------------------------------------------ email-delivery task -- */
/* Durable send-intent (communications.idempotencyKey) and per-attempt
 * telemetry (communication_deliveries), matching supabase/migrations/
 * 0018_email_delivery.sql's semantics exactly so MemoryRepository and
 * SupabaseRepository stay in parity. */

export const COMMUNICATION_DELIVERIES: CommunicationDelivery[] = [];
let communicationSeq = COMMUNICATIONS.length;
let deliverySeq = 0;

export function findCommunicationByIdempotencyKey(key: string) {
  return COMMUNICATIONS.find((c) => c.idempotencyKey === key);
}

/** Matches begin_communication_send(): returns the existing row on a
 * retry (same idempotency key) instead of creating a second one. */
export function beginCommunicationSend(input: {
  organisationId: string;
  caseId: string;
  channel: Channel;
  idempotencyKey: string;
  templateKey: string | null;
  templateVersion: number | null;
  subject: string | null;
  body: string;
}): { communication: Communication; isNew: boolean } {
  const existing = findCommunicationByIdempotencyKey(input.idempotencyKey);
  if (existing) return { communication: existing, isNew: false };

  communicationSeq += 1;
  const created: Communication = {
    id: `comm-${communicationSeq}`,
    caseId: input.caseId,
    organisationId: input.organisationId,
    channel: input.channel,
    direction: "outbound",
    templateKey: input.templateKey,
    templateVersion: input.templateVersion,
    subject: input.subject,
    body: input.body,
    providerMessageId: null,
    threadRef: `thread-${input.caseId}`,
    deliveryStatus: "queued",
    hasSecureLink: false,
    idempotencyKey: input.idempotencyKey,
    replyClassification: null,
    reviewedById: null,
    createdAt: new Date().toISOString(),
    deliveredAt: null,
  };
  COMMUNICATIONS.unshift(created);
  return { communication: created, isNew: true };
}

export function listDeliveriesForCommunication(communicationId: string) {
  return COMMUNICATION_DELIVERIES.filter((d) => d.communicationId === communicationId).sort(
    (a, b) => a.attempt - b.attempt,
  );
}

/** Matches begin_delivery_attempt(): blocks a new attempt while the latest
 * one for this communication is still 'queued' (ambiguous), unless forced. */
export function beginDeliveryAttempt(
  organisationId: string,
  communicationId: string,
  attempt: number,
  forceAfterAmbiguous: boolean,
): { blocked: boolean; blockedReason: string | null; delivery: CommunicationDelivery } {
  const existingForComm = listDeliveriesForCommunication(communicationId);
  const latest = existingForComm[existingForComm.length - 1];
  if (latest && latest.status === "queued" && !forceAfterAmbiguous) {
    return {
      blocked: true,
      blockedReason: `A previous delivery attempt (#${latest.attempt}) was started but never completed -- its outcome is unknown, so a duplicate send cannot be ruled out automatically. An operator must confirm before retrying.`,
      delivery: latest,
    };
  }

  const dup = existingForComm.find((d) => d.attempt === attempt);
  if (dup) return { blocked: false, blockedReason: null, delivery: dup };

  deliverySeq += 1;
  const created: CommunicationDelivery = {
    id: `delivery-${deliverySeq}`,
    organisationId,
    communicationId,
    attempt,
    status: "queued",
    adapterOutcome: null,
    provider: null,
    providerMessageId: null,
    errorDetail: null,
    occurredAt: new Date().toISOString(),
  };
  COMMUNICATION_DELIVERIES.push(created);
  return { blocked: false, blockedReason: null, delivery: created };
}

/** Matches complete_delivery_attempt(): idempotent no-op once the attempt
 * is no longer 'queued'. Case-state mutation stays the caller's job, same
 * as the RPC. */
export function completeDeliveryAttempt(input: {
  deliveryId: string;
  status: DeliveryStatus;
  adapterOutcome: AdapterOutcome | null;
  providerMessageId: string | null;
  errorDetail: string | null;
}): { delivery: CommunicationDelivery; communication: Communication } {
  const idx = COMMUNICATION_DELIVERIES.findIndex((d) => d.id === input.deliveryId);
  if (idx === -1) throw new Error(`completeDeliveryAttempt: delivery ${input.deliveryId} not found`);
  const existing = COMMUNICATION_DELIVERIES[idx];
  const comm = COMMUNICATIONS.find((c) => c.id === existing.communicationId);
  if (!comm) throw new Error(`completeDeliveryAttempt: communication ${existing.communicationId} not found`);

  if (existing.status !== "queued") {
    return { delivery: existing, communication: comm }; // idempotent no-op
  }

  COMMUNICATION_DELIVERIES[idx] = {
    ...existing,
    status: input.status,
    adapterOutcome: input.adapterOutcome,
    provider: "gmail-smtp",
    providerMessageId: input.providerMessageId,
    errorDetail: input.errorDetail,
  };

  const commIdx = COMMUNICATIONS.findIndex((c) => c.id === comm.id);
  const updatedComm: Communication = {
    ...comm,
    deliveryStatus: input.status,
    providerMessageId: input.providerMessageId ?? comm.providerMessageId,
    deliveredAt: input.status === "sent" ? new Date().toISOString() : comm.deliveredAt,
  };
  COMMUNICATIONS[commIdx] = updatedComm;

  return { delivery: COMMUNICATION_DELIVERIES[idx], communication: updatedComm };
}

const ASSIGNEES: Record<string, string> = {
  "user-1": "Priya Sharma",
  "user-2": "Arjun Mehta",
};
export function assigneeName(id: string | null) {
  return id ? (ASSIGNEES[id] ?? "Unassigned") : "Unassigned";
}

export interface CaseRow {
  id: string;
  client: string;
  debtor: string;
  gstin: string | null;
  status: CaseStatus;
  nextAction: string | null;
  overdueDays: number;
  value: number;
  assignee: string;
  waitingOn: RecoveryCase["waitingOn"];
}

export function caseRows(orgId?: string): CaseRow[] {
  return (orgId ? listCasesForOrg(orgId) : CASES).map((c) => {
    const debtor = getDebtor(c.debtorId);
    const inv = listInvoicesForCase(c.id)[0];
    const due = inv?.dueDate ? new Date(inv.dueDate).getTime() : NOW.getTime();
    const overdueDays = Math.max(0, Math.round((NOW.getTime() - due) / 86_400_000));
    return {
      id: c.id,
      client: getOrg(c.organisationId)?.legalEntityName ?? "—",
      debtor: debtor?.name ?? "—",
      gstin: debtor?.gstin ?? null,
      status: c.status,
      nextAction: c.nextScheduledAction ?? c.currentStep,
      overdueDays,
      value: c.principalOutstanding,
      assignee: assigneeName(c.assigneeId),
      waitingOn: c.waitingOn,
    };
  });
}

/** Exception-first queue: unresolved tasks, urgent + soonest-due first. */
export interface QueueItem {
  taskId: string;
  caseId: string | null;
  title: string;
  debtor: string | null;
  client: string;
  amountAtRisk: number;
  dueState: "overdue" | "today" | "upcoming" | "none";
  dueAt: string | null;
  blocker: string | null;
  waitingOn: WorkflowTask["waitingOn"];
  urgent: boolean;
  nextSafeAction: string;
}

export function urgentQueue(orgId?: string): QueueItem[] {
  const items = openTasks()
    .filter((t) => (orgId ? t.organisationId === orgId : true))
    .map<QueueItem>((t) => {
      const c = t.caseId ? getCase(t.caseId) : undefined;
      const dueState: QueueItem["dueState"] = !t.dueAt
        ? "none"
        : t.dueAt < NOW.toISOString()
          ? "overdue"
          : t.dueAt.slice(0, 10) === NOW.toISOString().slice(0, 10)
            ? "today"
            : "upcoming";
      return {
        taskId: t.id,
        caseId: t.caseId,
        title: t.title,
        debtor: c ? (getDebtor(c.debtorId)?.name ?? null) : null,
        client: getOrg(t.organisationId)?.legalEntityName ?? "—",
        amountAtRisk: c?.principalOutstanding ?? 0,
        dueState,
        dueAt: t.dueAt,
        blocker: c?.blocker ?? null,
        waitingOn: t.waitingOn,
        urgent: t.urgent,
        nextSafeAction: c?.nextScheduledAction ?? t.title,
      };
    });
  const rank = { overdue: 0, today: 1, upcoming: 2, none: 3 } as const;
  return items.sort(
    (a, b) =>
      Number(b.urgent) - Number(a.urgent) ||
      rank[a.dueState] - rank[b.dueState] ||
      b.amountAtRisk - a.amountAtRisk,
  );
}

/* ------------------------------------------------------------ aggregates -- */

/** Recomputed on each call so mutations (payments, reminders, ...) show up
 * immediately -- unlike a frozen-at-import-time constant would. */
export function computeDashboardKpis() {
  return {
    openCases: CASES.filter((c) => !["recovered", "closed", "withdrawn", "archived"].includes(c.status))
      .length,
    amountUnderRecovery: CASES.reduce((s, c) => s + c.principalOutstanding, 0),
    recoveredThisMonth: PAYMENTS.filter((p) => p.clientConfirmed).reduce((s, p) => s + p.amount, 0),
    urgentTasks: TASKS.filter((t) => !t.resolvedAt && t.urgent).length,
    awaitingClient: TASKS.filter((t) => !t.resolvedAt && t.waitingOn === "client").length,
    portalRuns: TASKS.filter((t) => !t.resolvedAt && t.waitingOn === "portal").length,
  };
}
/** @deprecated snapshot at import time -- prefer computeDashboardKpis(). Kept
 * for callers that intentionally want the fixed demo baseline. */
export const DASHBOARD_KPIS = computeDashboardKpis();

/** 30-day recovery trend, integer paise per day (cumulative-ish demo curve). */
export const RECOVERY_TREND: Array<{ date: string; recovered: number; newDebt: number }> =
  Array.from({ length: 30 }, (_, i) => {
    const day = i - 29;
    const wave = Math.sin(i / 4) * 6_00_000;
    return {
      date: date(day),
      recovered: Math.round(9_00_000 + wave + i * 45_000),
      newDebt: Math.round(14_00_000 - wave * 0.5 + (29 - i) * 20_000),
    };
  });

export const AGEING_BUCKETS: Array<{ bucket: string; amount: number; cases: number }> = [
  { bucket: "0–30", amount: 37_30_000, cases: 2 },
  { bucket: "31–60", amount: 96_75_000, cases: 1 },
  { bucket: "61–90", amount: 209_50_000, cases: 2 },
  { bucket: "91–180", amount: 271_00_000, cases: 1 },
  { bucket: "180+", amount: 58_20_000, cases: 1 },
];

export const STAGE_FUNNEL: Array<{ stage: string; cases: number; value: number }> = [
  { stage: "Reminders", cases: 3, value: 251_50_000 },
  { stage: "GST route", cases: 1, value: 96_75_000 },
  { stage: "MSME ODR", cases: 1, value: 58_20_000 },
  { stage: "DD / Hearing", cases: 1, value: 58_20_000 },
  { stage: "Recovered", cases: 1, value: 33_60_000 },
];

/* --------------------------------------------------------- client view --- */

export interface ClientOverview {
  orgId: string;
  actionsRequired: number;
  totalOutstanding: number;
  recovered: number;
  recoveryRatePct: number;
  upcomingAction: { label: string; when: string | null } | null;
  feeSummary: { estimatedFee: number; billed: number; currency: "INR" };
  stageWise: Array<{ stage: string; value: number }>;
  ageing: Array<{ bucket: string; amount: number }>;
}

export function clientOverview(orgId: string): ClientOverview {
  const cs = listCasesForOrg(orgId);
  const outstanding = cs.reduce((s, c) => s + c.principalOutstanding, 0);
  const recovered = cs.reduce((s, c) => s + c.recoveredToDate, 0);
  const denom = outstanding + recovered || 1;
  const jitoMember = getOrg(orgId)?.jitoMember ?? false;
  const nextCase = cs
    .filter((c) => c.nextScheduledAt)
    .sort((a, b) => (a.nextScheduledAt! < b.nextScheduledAt! ? -1 : 1))[0];
  return {
    orgId,
    actionsRequired: TASKS.filter(
      (t) => !t.resolvedAt && t.organisationId === orgId && t.waitingOn === "client",
    ).length,
    totalOutstanding: outstanding,
    recovered,
    recoveryRatePct: Math.round((recovered / denom) * 100),
    upcomingAction: nextCase
      ? {
          label: CLIENT_SAFE_LABEL[nextCase.status] ?? "In progress",
          when: nextCase.nextScheduledAt,
        }
      : null,
    feeSummary: { estimatedFee: estimateSuccessFee(recovered, jitoMember), billed: 0, currency: "INR" },
    stageWise: STAGE_FUNNEL.map((s) => ({ stage: s.stage, value: s.value })),
    ageing: AGEING_BUCKETS.map((a) => ({ bucket: a.bucket, amount: a.amount })),
  };
}

/* ------------------------------------------------- stubbed bulk import --- */

export function stubBulkImport(fileName: string): ImportResult {
  void fileName; // TODO(api): parse the uploaded file server-side
  return {
    totalRows: 8,
    validRows: 5,
    duplicateRows: 1,
    errorRows: 2,
    errors: [
      { rowNumber: 3, column: "debtor_gstin", code: "invalid_gstin", message: "GSTIN checksum failed" },
      { rowNumber: 3, column: "debtor_mobile", code: "invalid_mobile", message: "Not a valid Indian mobile number" },
      { rowNumber: 6, column: "invoice_total", code: "mismatch", message: "invoice_total != taxable_value + tax_amount" },
      { rowNumber: 7, column: "client_certified", code: "not_certified", message: "client_certified must be 'yes' to activate" },
    ],
    preview: [
      { rowNumber: 1, debtorName: "Nirvana Retail Chains Pvt Ltd", invoiceNumber: "ACM/2026/0501", totalDue: 42_00_000 },
      { rowNumber: 2, debtorName: "Delta Packaging Co", invoiceNumber: "VTX/2026/1201", totalDue: 18_75_000 },
      { rowNumber: 4, debtorName: "Cargo Bridge Freight Pvt Ltd", invoiceNumber: "ORB/2026/0088", totalDue: 9_20_000 },
      { rowNumber: 5, debtorName: "Monsoon Apparel Exports Pvt Ltd", invoiceNumber: "SNR/2026/2301", totalDue: 61_00_000 },
      { rowNumber: 8, debtorName: "Kaveri Constructions", invoiceNumber: "ACM/2026/0502", totalDue: 7_50_000 },
    ],
  };
}
export const BULK_IMPORT_NOTE =
  "TODO(api): replace stubBulkImport with a server action returning ImportResult.";

/* ------------------------------------------------------- mutations (demo) - */
/**
 * These mutate the module-level arrays above in place. That's enough to make
 * the running dev/prod server behave statefully for a demo (Node keeps one
 * module instance per process) -- it is NOT multi-instance-safe or durable,
 * which is exactly why MemoryRepository is a named, swappable seam and not
 * the "real" storage. See src/server/repositories/supabase.ts for the
 * durable counterpart.
 */

export interface AuditEntry {
  id: string;
  action: string;
  entity: string;
  entityId: string;
  reason: string | null;
  createdAt: string;
  /** Who performed this action, per the authenticated server-side session --
   * never a value a browser/form supplied (P0-2 requirement 10). `null` only
   * for the seed row below, which predates this field. */
  actorId: string | null;
  actorRole: string | null;
}
const AUDIT_LOG_SEED: AuditEntry[] = [
  {
    id: "audit-1",
    action: "case.activated",
    entity: "recovery_case",
    entityId: "case-1",
    reason: "Certification + validation + age gate cleared",
    createdAt: iso(-6),
    actorId: null,
    actorRole: null,
  },
];
let nextAuditSeq = AUDIT_LOG_SEED.length;
export const AUDIT_LOG: AuditEntry[] = [...AUDIT_LOG_SEED];

/** Global automation kill switch (PRD §5). Module-level state -- see the
 * mutation-helpers note above re: process-lifetime-only, not multi-instance-safe. */
let automationEnabled = true;
export function getAutomationEnabled() {
  return automationEnabled;
}
export function setAutomationEnabled(enabled: boolean) {
  automationEnabled = enabled;
  return automationEnabled;
}

export function appendAudit(entry: Omit<AuditEntry, "id" | "createdAt">) {
  nextAuditSeq += 1;
  AUDIT_LOG.unshift({ ...entry, id: `audit-${nextAuditSeq}`, createdAt: new Date().toISOString() });
}

export function mutateCase(id: string, patch: Partial<RecoveryCase>) {
  const idx = CASES.findIndex((c) => c.id === id);
  if (idx === -1) throw new Error(`mutateCase: case ${id} not found`);
  CASES[idx] = { ...CASES[idx], ...patch };
  return CASES[idx];
}

export function mutateInvoice(id: string, patch: Partial<Invoice>) {
  const idx = INVOICES.findIndex((i) => i.id === id);
  if (idx === -1) return; // demo dataset doesn't carry every case's invoices
  INVOICES[idx] = { ...INVOICES[idx], ...patch };
}

export function insertInvoice(invoice: Invoice) {
  INVOICES.push(invoice);
  return invoice;
}

export function insertCase(kase: RecoveryCase) {
  CASES.push(kase);
  return kase;
}

/** Case-insensitive lookup within one organisation; used by intake to avoid
 * creating duplicate debtor records for the same name. */
export function findDebtorByName(organisationId: string, name: string) {
  const needle = name.trim().toLowerCase();
  return DEBTORS.find((d) => d.organisationId === organisationId && d.name.trim().toLowerCase() === needle);
}

export function insertDebtor(debtor: Debtor) {
  DEBTORS.push(debtor);
  return debtor;
}

export function findOrgByClientCode(clientCode: string) {
  const needle = clientCode.trim().toLowerCase();
  return ORGANISATIONS.find((o) => o.clientCode.trim().toLowerCase() === needle);
}

export function findOrgByGstin(gstin: string) {
  const needle = gstin.trim().toUpperCase();
  return ORGANISATIONS.find((o) => (o.creditorGstin ?? "").trim().toUpperCase() === needle);
}

/** Collapse internal whitespace + case for a name-collision check; "Acme  Pvt.  Ltd"
 * and "acme pvt. ltd" should be treated as the same legal entity name. */
export function normalizeOrgName(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function findOrgByName(legalEntityName: string) {
  const needle = normalizeOrgName(legalEntityName);
  return ORGANISATIONS.find((o) => normalizeOrgName(o.legalEntityName) === needle);
}

export function insertOrganisation(org: Organisation) {
  ORGANISATIONS.push(org);
  return org;
}

export function markPaymentConfirmed(id: string) {
  const idx = PAYMENTS.findIndex((p) => p.id === id);
  if (idx === -1) throw new Error(`markPaymentConfirmed: payment ${id} not found`);
  PAYMENTS[idx] = { ...PAYMENTS[idx], clientConfirmed: true };
  return PAYMENTS[idx];
}

export function insertPayment(payment: PaymentRecord) {
  PAYMENTS.unshift(payment);
  return payment;
}

export function insertCommunication(c: Communication) {
  COMMUNICATIONS.unshift(c);
  return c;
}

export function mutateCommunication(id: string, patch: Partial<Communication>) {
  const idx = COMMUNICATIONS.findIndex((c) => c.id === id);
  if (idx === -1) throw new Error(`mutateCommunication: communication ${id} not found`);
  COMMUNICATIONS[idx] = { ...COMMUNICATIONS[idx], ...patch };
  return COMMUNICATIONS[idx];
}
