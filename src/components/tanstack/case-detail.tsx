/**
 * TanStack Start adapter for src/components/screens/case-detail.tsx. Same
 * view-model, same embedded panels with the same props and the same
 * status conditions for when each panel appears; only the page layout and
 * presentation differ from the Next.js original.
 */
"use client";

import * as React from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  ChevronRight,
  FileText,
  Gavel,
  ListChecks,
  Mail,
  MapPin,
  MessageSquare,
  Paperclip,
  Phone,
  Server,
  ShieldCheck,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import type {
  CaseHearing,
  Communication,
  DdRecord,
  DebtorReply,
  Invoice,
  PaymentAllocation,
  PaymentPromise,
  PaymentRecord,
  RecoveryCase,
  WorkflowTask,
} from "@/contract/types";
import type { WhatsAppOfferView } from "@/domain/whatsapp-messages";
import { PROMISE_ALLOWED_STATUSES } from "@/domain/promise";
import { cn, formatInr } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusPill, WaitingOnPill } from "@/components/ui/status-pill";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkButton } from "@/components/tanstack/link-button";
import { SpotlightCard } from "@/components/ui/spotlight-card";
import { SendReminderButton } from "./send-reminder-button";
import { WhatsAppMessagesPanel } from "./whatsapp-messages-panel";
import { PaymentPromiseForm } from "./payment-promise-form";
import { DebtorContactPanel } from "./debtor-contact-panel";
import { DdHearingActions } from "./dd-hearing-actions";
import { OcrReviewPanel } from "./ocr-review-panel";
import { ActivationGatesPanel } from "./activation-gates-panel";
import type { ActivationGates } from "@/domain/activation";
import { ResolveTaskButton } from "./resolve-task-button";
import { DebtorReplyForm } from "./debtor-reply-form";

export interface CaseDetailVM {
  kase: RecoveryCase;
  clientName: string;
  debtorId: string;
  debtorName: string;
  debtorGstin: string | null;
  debtorAddress: string | null;
  debtorEmail: string | null;
  debtorMobile: string | null;
  assignee: string;
  invoices: Invoice[];
  communications: Communication[];
  payments: PaymentRecord[];
  tasks: WorkflowTask[];
  allocations: PaymentAllocation[];
  ddRecord: DdRecord | undefined;
  hearings: CaseHearing[];
  debtorReplies: DebtorReply[];
  /** Every WhatsApp message family evaluated for this case (server-only send details already stripped). */
  whatsAppOffers: WhatsAppOfferView[];
  promises: PaymentPromise[];
  /** Only loaded for cases that are not yet activated. */
  activationGates: ActivationGates | null;
}

function fmtDate(s: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right text-sm">{children}</dd>
    </div>
  );
}

function Figure({
  label,
  children,
  sub,
  className,
}: {
  label: string;
  children: React.ReactNode;
  sub?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1 px-4 py-3", className)}>
      <dt className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="min-w-0">
        {children}
        {sub ? <span className="mt-0.5 block text-xs text-muted-foreground">{sub}</span> : null}
      </dd>
    </div>
  );
}

function SectionHeading({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
      {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
    </div>
  );
}

function TabCount({ n }: { n: number }) {
  return (
    <span className="rounded-full bg-muted px-1.5 text-[11px] font-semibold tabular-nums text-muted-foreground">
      {n}
    </span>
  );
}

export function CaseDetail({ vm }: { vm: CaseDetailVM }) {
  const { kase } = vm;

  const showContactAndReminder = kase.status === "active";
  const showPromiseForm = (PROMISE_ALLOWED_STATUSES as readonly string[]).includes(kase.status);
  const showGst = kase.eligibilityRoute === "gst" || kase.status.startsWith("gst");
  const showMsme = kase.eligibilityRoute === "msme" || kase.status.startsWith("msme");

  const timeline = [
    { at: kase.createdAt, label: "Case created from accepted upload", kind: "case" as const },
    kase.activatedAt
      ? {
          at: kase.activatedAt,
          label: "Case activated (certification + validation + age gate passed)",
          kind: "case" as const,
        }
      : null,
    ...vm.communications.map((c) => ({
      at: c.createdAt,
      label: `${c.direction === "outbound" ? "Sent" : "Received"} ${c.channel} — ${c.deliveryStatus}`,
      kind: "comm" as const,
    })),
    ...vm.payments.map((p) => ({
      at: p.createdAt,
      label: `Payment recorded: ${formatInr(p.amount)} (${p.kind})`,
      kind: "payment" as const,
    })),
    kase.closedAt ? { at: kase.closedAt, label: "Case closed", kind: "case" as const } : null,
  ]
    .filter((e): e is { at: string; label: string; kind: "case" | "comm" | "payment" } => e !== null)
    .sort((a, b) => a.at.localeCompare(b.at));

  const TIMELINE_ICON = { case: FileText, comm: MessageSquare, payment: Wallet };

  return (
    <div className="flex flex-col gap-6">
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-muted-foreground">
        <Link
          to="/cases"
          className="rounded hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          Cases
        </Link>
        <ChevronRight aria-hidden="true" className="h-3 w-3" />
        <span aria-current="page" className="font-mono text-foreground">
          {kase.id}
        </span>
      </nav>

      {/* Summary */}
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 p-5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">
            Case {kase.id} &middot; {vm.clientName}
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{vm.debtorName}</h1>
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusPill status={kase.status} />
              <WaitingOnPill value={kase.waitingOn} />
            </div>
          </div>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>
              Assignee <span className="font-medium text-foreground">{vm.assignee}</span>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {vm.debtorGstin ? (
                <>
                  GSTIN <span className="font-mono text-foreground">{vm.debtorGstin}</span>
                </>
              ) : (
                "No GSTIN"
              )}
            </span>
            <span aria-hidden="true">·</span>
            <span>Automation started {fmtDate(kase.automationStartedAt)}</span>
          </p>
        </div>
        <dl className="grid gap-px border-t border-border bg-border sm:grid-cols-2 lg:grid-cols-4 [&>div]:bg-[color-mix(in_srgb,var(--muted)_45%,var(--card))]">
          <Figure label="Principal outstanding">
            <span className="text-xl font-semibold tabular-nums">{formatInr(kase.principalOutstanding)}</span>
          </Figure>
          <Figure label="Recovered to date">
            <span
              className={cn(
                "text-xl font-semibold tabular-nums",
                kase.recoveredToDate > 0 ? "text-success" : "text-foreground",
              )}
            >
              {formatInr(kase.recoveredToDate)}
            </span>
          </Figure>
          <Figure label="Current step">
            <span className="text-sm font-medium">{kase.currentStep}</span>
          </Figure>
          <Figure
            label="Next scheduled action"
            sub={kase.nextScheduledAction && kase.nextScheduledAt ? fmtDate(kase.nextScheduledAt) : undefined}
          >
            <span className="text-sm font-medium">{kase.nextScheduledAction ?? "None"}</span>
          </Figure>
        </dl>
        {kase.blocker ? (
          <div
            role="note"
            className="flex items-start gap-2 border-t border-warning/30 bg-warning-bg px-5 py-2.5 text-sm text-warning"
          >
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <strong className="font-semibold">Blocker / prerequisite:</strong> {kase.blocker}
            </span>
          </div>
        ) : null}
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          {vm.activationGates ? (
            <ActivationGatesPanel caseId={kase.id} status={kase.status} gates={vm.activationGates} />
          ) : null}

          {kase.status === "correction_required" && vm.invoices[0] ? (
            <OcrReviewPanel caseId={kase.id} invoice={vm.invoices[0]} />
          ) : null}

          <section aria-labelledby="case-actions" className="flex flex-col gap-3">
            <div id="case-actions">
              <SectionHeading
                title="Actions"
                description="Operator-triggered steps available at this stage."
              />
            </div>
            {showContactAndReminder ? (
              <div className="flex flex-col gap-3">
                <DebtorContactPanel
                  debtorId={vm.debtorId}
                  caseId={kase.id}
                  email={vm.debtorEmail}
                  mobile={vm.debtorMobile}
                />
                <SendReminderButton
                  caseId={kase.id}
                  invoices={vm.invoices.map((i) => ({ id: i.id, invoiceNumber: i.invoiceNumber }))}
                />
              </div>
            ) : null}
            <WhatsAppMessagesPanel caseId={kase.id} offers={vm.whatsAppOffers} />
            {showPromiseForm ? (
              <PaymentPromiseForm
                caseId={kase.id}
                invoices={vm.invoices.map((i) => ({ id: i.id, invoiceNumber: i.invoiceNumber }))}
              />
            ) : null}
            <DdHearingActions caseId={kase.id} status={kase.status} ddRecord={vm.ddRecord} hearings={vm.hearings} />
          </section>

          <section aria-labelledby="case-record" className="flex flex-col gap-3">
            <div id="case-record">
              <SectionHeading title="Case record" />
            </div>
            <Tabs defaultValue="timeline">
              <TabsList aria-label="Case record">
                <TabsTrigger value="timeline">Timeline</TabsTrigger>
                <TabsTrigger value="invoices">
                  Invoices <TabCount n={vm.invoices.length} />
                </TabsTrigger>
                <TabsTrigger value="communications">
                  Communications <TabCount n={vm.communications.length + vm.debtorReplies.length} />
                </TabsTrigger>
                <TabsTrigger value="payments">
                  Payments <TabCount n={vm.payments.length} />
                </TabsTrigger>
                <TabsTrigger value="evidence">Evidence</TabsTrigger>
                <TabsTrigger value="tasks">
                  Tasks <TabCount n={vm.tasks.length} />
                </TabsTrigger>
              </TabsList>

              <TabsContent value="timeline">
                <Card>
                  <CardContent className="p-5">
                    <ol className="relative flex flex-col gap-5 before:absolute before:bottom-2 before:left-[11px] before:top-2 before:w-px before:bg-border">
                      {timeline.map((ev, i) => {
                        const Icon = TIMELINE_ICON[ev.kind];
                        return (
                          <li key={i} className="relative flex gap-3">
                            <span
                              aria-hidden="true"
                              className={cn(
                                "z-10 grid h-6 w-6 shrink-0 place-items-center rounded-full border bg-card",
                                ev.kind === "payment"
                                  ? "border-success/40 text-success"
                                  : ev.kind === "comm"
                                    ? "border-info/40 text-info"
                                    : "border-primary/40 text-primary",
                              )}
                            >
                              <Icon className="h-3 w-3" />
                            </span>
                            <div className="flex flex-col pt-0.5">
                              <span className="text-sm">{ev.label}</span>
                              <span className="text-xs text-muted-foreground">{fmtDate(ev.at)}</span>
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="invoices">
                {vm.invoices.length === 0 ? (
                  <EmptyState icon={<FileText />} title="No invoices linked yet" />
                ) : (
                  <Card>
                    <ul className="divide-y divide-border">
                      {vm.invoices.map((inv) => (
                        <li key={inv.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                          <div>
                            <p className="font-mono text-sm font-medium">{inv.invoiceNumber}</p>
                            <p className="text-xs text-muted-foreground">
                              Dated {inv.invoiceDate} &middot; due {inv.dueDate ?? "—"}
                            </p>
                          </div>
                          <div className="flex items-center gap-4">
                            {inv.extractionConfidence != null && inv.extractionConfidence < 0.75 ? (
                              <Badge tone="warning">OCR {(inv.extractionConfidence * 100).toFixed(0)}%</Badge>
                            ) : null}
                            <div className="text-right">
                              <p className="text-sm font-semibold tabular-nums">{formatInr(inv.outstandingBalance)}</p>
                              <p className="text-[11px] text-muted-foreground">outstanding</p>
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </Card>
                )}
              </TabsContent>

              <TabsContent value="communications">
                <div className="mb-4">
                  <DebtorReplyForm caseId={kase.id} />
                </div>
                {vm.debtorReplies.length > 0 ? (
                  <div className="mb-4 flex flex-col gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Recorded debtor replies
                    </span>
                    {vm.debtorReplies.map((r) => (
                      <Card key={r.id}>
                        <CardContent className="p-4">
                          <div className="mb-1.5 flex flex-wrap items-center gap-2">
                            <Badge tone="primary">{r.channel}</Badge>
                            {r.classification ? (
                              <Badge tone="neutral">{r.classification.replace(/_/g, " ")}</Badge>
                            ) : null}
                            <span className="ml-auto text-xs text-muted-foreground">{fmtDate(r.receivedAt)}</span>
                          </div>
                          <p className="text-sm text-muted-foreground">{r.rawBody}</p>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : null}
                {vm.communications.length === 0 ? (
                  <EmptyState icon={<MessageSquare />} title="No communications yet" />
                ) : (
                  <div className="flex flex-col gap-2">
                    {vm.communications.map((c) => (
                      <Card key={c.id}>
                        <CardContent className="p-4">
                          <div className="mb-1.5 flex flex-wrap items-center gap-2">
                            <Badge tone={c.direction === "outbound" ? "info" : "primary"}>{c.direction}</Badge>
                            <Badge tone="neutral">{c.channel}</Badge>
                            <Badge
                              tone={
                                c.deliveryStatus === "failed" || c.deliveryStatus === "bounced" ? "danger" : "neutral"
                              }
                            >
                              {c.deliveryStatus}
                            </Badge>
                            <span className="ml-auto text-xs text-muted-foreground">{fmtDate(c.createdAt)}</span>
                          </div>
                          {c.subject ? <p className="text-sm font-medium">{c.subject}</p> : null}
                          <p className="text-sm text-muted-foreground">{c.body}</p>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="payments">
                {vm.payments.length === 0 ? (
                  <EmptyState icon={<Wallet />} title="No payments recorded" />
                ) : (
                  <div className="flex flex-col gap-2">
                    {vm.payments.map((p) => {
                      const allocs = vm.allocations.filter((a) => a.paymentRecordId === p.id);
                      return (
                        <Card key={p.id}>
                          <CardContent className="flex flex-col gap-2 p-4">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold tabular-nums">{formatInr(p.amount)}</p>
                                <p className="text-xs text-muted-foreground">
                                  {p.kind} &middot; {p.receivedOn} &middot; {p.reference ?? "no ref"}
                                </p>
                              </div>
                              <Badge tone={p.clientConfirmed ? "success" : "warning"}>
                                {p.clientConfirmed ? "Client confirmed" : "Awaiting confirmation"}
                              </Badge>
                            </div>
                            {allocs.length > 0 ? (
                              <div className="flex flex-col gap-1 border-t border-border pt-2">
                                <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                                  Allocated to invoices
                                </span>
                                {allocs.map((a) => (
                                  <span key={a.id} className="text-xs tabular-nums text-muted-foreground">
                                    Invoice {a.invoiceId.slice(0, 8)} — {formatInr(a.amount)}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="evidence">
                <EmptyState
                  icon={<Paperclip />}
                  title="Evidence vault"
                  description="Immutable source documents, OCR output and portal receipts will be listed here once the evidence store is connected."
                />
              </TabsContent>

              <TabsContent value="tasks">
                {vm.tasks.length === 0 ? (
                  <EmptyState icon={<ListChecks />} title="No open tasks on this case" />
                ) : (
                  <Card>
                    <ul className="divide-y divide-border">
                      {vm.tasks.map((t) => (
                        <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                          <div>
                            <p className="text-sm font-medium">{t.title}</p>
                            <p className="text-xs text-muted-foreground">
                              {t.type.replace(/_/g, " ")} &middot; due {fmtDate(t.dueAt)}
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            {t.urgent ? <Badge tone="danger">Urgent</Badge> : null}
                            <WaitingOnPill value={t.waitingOn} />
                            <ResolveTaskButton taskId={t.id} caseId={kase.id} />
                          </div>
                        </li>
                      ))}
                    </ul>
                  </Card>
                )}
              </TabsContent>
            </Tabs>
          </section>
        </div>

        {/* Right rail */}
        <aside aria-label="Case summary" className="flex flex-col gap-4 lg:sticky lg:top-20 lg:self-start">
          {kase.nextScheduledAction ? (
            <SpotlightCard
              eyebrow="Next safe action"
              title={kase.nextScheduledAction}
              description={
                kase.blocker ?? (kase.nextScheduledAt ? `Scheduled ${fmtDate(kase.nextScheduledAt)}` : undefined)
              }
            />
          ) : null}

          {showGst || showMsme ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Gavel className="h-4 w-4 text-muted-foreground" /> Escalation
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {showGst ? (
                  <LinkButton href={`/gst/${kase.id}`} variant="primary" className="h-9 justify-between">
                    <span className="inline-flex items-center gap-1.5">
                      <ShieldCheck className="h-3.5 w-3.5" /> Open GST communication
                    </span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </LinkButton>
                ) : null}
                {showMsme ? (
                  <LinkButton href={`/msme/${kase.id}`} variant="primary" className="h-9 justify-between">
                    <span className="inline-flex items-center gap-1.5">
                      <Gavel className="h-3.5 w-3.5" /> Open MSME ODR wizard
                    </span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </LinkButton>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="flex items-center gap-2">
                <Server className="h-4 w-4 text-muted-foreground" /> Automation state
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="divide-y divide-border">
                <Row label="Mode">
                  <Badge tone={kase.automationMode === "automatic" ? "primary" : "neutral"}>{kase.automationMode}</Badge>
                </Row>
                <Row label="Waiting on">
                  <WaitingOnPill value={kase.waitingOn} />
                </Row>
                <Row label="Eligibility route">{kase.eligibilityRoute ?? "Not yet evaluated"}</Row>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-muted-foreground" /> Debtor
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-col gap-1 text-sm">
                <span className="font-medium">{vm.debtorName}</span>
                {vm.debtorGstin ? (
                  <span className="font-mono text-xs">{vm.debtorGstin}</span>
                ) : (
                  <span className="text-xs text-muted-foreground">No GSTIN</span>
                )}
                <span className="text-xs text-muted-foreground">{vm.debtorAddress ?? "No address on file"}</span>
              </div>
              <div className="flex flex-col gap-1.5 border-t border-border pt-3 text-xs">
                <span className="flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                  {vm.debtorEmail ?? <span className="text-muted-foreground">No email on file</span>}
                </span>
                <span className="flex items-center gap-1.5">
                  <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                  {vm.debtorMobile ?? <span className="text-muted-foreground">No mobile on file</span>}
                </span>
              </div>
              <LinkButton href={`/communications?case=${kase.id}`}>
                <MessageSquare className="h-3.5 w-3.5" /> View full thread
              </LinkButton>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
