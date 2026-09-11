/**
 * Typed demo data for the Debtrecover UI slice.
 * TODO(api): replace every selector in this file with a server fetch.
 * All money is integer paise (see contract/types Paise).
 */

import type {
  Communication,
  Debtor,
  ImportResult,
  Invoice,
  Organisation,
  PaymentRecord,
  RecoveryCase,
  WorkflowTask,
} from "@/contract/types";
import { CLIENT_SAFE_LABEL } from "@/contract/enums";
import type { CaseStatus } from "@/contract/enums";

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
    blocker: "Settlement offer of ₹18,00,000 needs staff/legal review before response",
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
    blocker: "Client must confirm ₹25,00,000 receipt before escalation is cancelled",
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
    body: "Payment of 25 lakh done by RTGS on 5th, UTR SBIN0026XXXX. Please confirm.",
    providerMessageId: "wamid.HBg9",
    threadRef: "thread-8",
    deliveryStatus: "delivered",
    hasSecureLink: false,
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
    body: "We dispute invoices SNR/2026/2210 and 2214 due to defective goods. We can settle the balance at ₹18,00,000.",
    providerMessageId: "ses-0044",
    threadRef: "thread-6",
    deliveryStatus: "delivered",
    hasSecureLink: false,
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
    title: "Approve or reject ₹18,00,000 settlement offer — Monsoon Apparel",
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
    title: "Client to confirm ₹25,00,000 RTGS receipt — Nirvana Retail",
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
    feeSummary: { estimatedFee: Math.round(recovered * 0.08), billed: 0, currency: "INR" },
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
}
const AUDIT_LOG_SEED: AuditEntry[] = [
  {
    id: "audit-1",
    action: "case.activated",
    entity: "recovery_case",
    entityId: "case-1",
    reason: "Certification + validation + age gate cleared",
    createdAt: iso(-6),
  },
];
let nextAuditSeq = AUDIT_LOG_SEED.length;
export const AUDIT_LOG: AuditEntry[] = [...AUDIT_LOG_SEED];

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
