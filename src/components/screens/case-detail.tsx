"use client";

import * as React from "react";
import {
  Clock,
  MapPin,
  FileText,
  MessageSquare,
  Wallet,
  Paperclip,
  ListChecks,
  Server,
} from "lucide-react";
import type {
  Communication,
  Invoice,
  PaymentRecord,
  RecoveryCase,
  WorkflowTask,
} from "@/contract/types";
import { formatInr } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { StatusPill, WaitingOnPill } from "@/components/ui/status-pill";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkButton } from "@/components/ui/link-button";
import { SendReminderButton } from "./send-reminder-button";

export interface CaseDetailVM {
  kase: RecoveryCase;
  clientName: string;
  debtorName: string;
  debtorGstin: string | null;
  debtorAddress: string | null;
  assignee: string;
  invoices: Invoice[];
  communications: Communication[];
  payments: PaymentRecord[];
  tasks: WorkflowTask[];
}

function fmtDate(s: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-sm">{children}</span>
    </div>
  );
}

export function CaseDetail({ vm }: { vm: CaseDetailVM }) {
  const { kase } = vm;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="flex min-w-0 flex-col gap-6">
        <div className="flex flex-col gap-3 border-b border-border pb-4">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold tracking-tight">{vm.debtorName}</h1>
            <StatusPill status={kase.status} />
            <WaitingOnPill value={kase.waitingOn} />
          </div>
          <p className="text-sm text-muted-foreground">
            {vm.clientName} &middot; Case {kase.id} &middot; Assignee {vm.assignee}
          </p>
          <div className="grid gap-x-6 sm:grid-cols-3">
            <Row label="Automation started">{fmtDate(kase.automationStartedAt)}</Row>
            <Row label="Current step">{kase.currentStep}</Row>
            <Row label="Next scheduled action">
              {kase.nextScheduledAction ? (
                <>
                  {kase.nextScheduledAction}
                  {kase.nextScheduledAt ? (
                    <span className="block text-xs text-muted-foreground">
                      {fmtDate(kase.nextScheduledAt)}
                    </span>
                  ) : null}
                </>
              ) : (
                "None"
              )}
            </Row>
          </div>
          {kase.blocker ? (
            <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning-bg px-3 py-2 text-xs text-warning">
              <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                <strong>Blocker / prerequisite:</strong> {kase.blocker}
              </span>
            </div>
          ) : null}
          {kase.status === "active" ? <SendReminderButton caseId={kase.id} /> : null}
        </div>

        <Tabs defaultValue="timeline">
          <TabsList className="flex-wrap">
            <TabsTrigger value="timeline">Timeline</TabsTrigger>
            <TabsTrigger value="invoices">Invoices</TabsTrigger>
            <TabsTrigger value="communications">Communications</TabsTrigger>
            <TabsTrigger value="payments">Payments</TabsTrigger>
            <TabsTrigger value="evidence">Evidence</TabsTrigger>
            <TabsTrigger value="tasks">Tasks</TabsTrigger>
          </TabsList>

          <TabsContent value="timeline">
            <ol className="flex flex-col gap-3">
              {[
                { at: kase.createdAt, label: "Case created from accepted upload" },
                kase.activatedAt
                  ? { at: kase.activatedAt, label: "Case activated (certification + validation + age gate passed)" }
                  : null,
                ...vm.communications.map((c) => ({
                  at: c.createdAt,
                  label: `${c.direction === "outbound" ? "Sent" : "Received"} ${c.channel} — ${c.deliveryStatus}`,
                })),
                ...vm.payments.map((p) => ({
                  at: p.createdAt,
                  label: `Payment recorded: ${formatInr(p.amount)} (${p.kind})`,
                })),
                kase.closedAt ? { at: kase.closedAt, label: "Case closed" } : null,
              ]
                .filter(Boolean)
                .map((e, i) => {
                  const ev = e as { at: string; label: string };
                  return (
                    <li key={i} className="flex gap-3">
                      <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />
                      <div className="flex flex-col">
                        <span className="text-sm">{ev.label}</span>
                        <span className="text-xs text-muted-foreground">{fmtDate(ev.at)}</span>
                      </div>
                    </li>
                  );
                })}
            </ol>
          </TabsContent>

          <TabsContent value="invoices">
            {vm.invoices.length === 0 ? (
              <EmptyState icon={<FileText />} title="No invoices linked yet" />
            ) : (
              <div className="flex flex-col gap-2">
                {vm.invoices.map((inv) => (
                  <Card key={inv.id}>
                    <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                      <div>
                        <p className="font-mono text-sm">{inv.invoiceNumber}</p>
                        <p className="text-xs text-muted-foreground">
                          Dated {inv.invoiceDate} &middot; due {inv.dueDate ?? "—"}
                        </p>
                      </div>
                      <div className="flex items-center gap-4">
                        {inv.extractionConfidence != null && inv.extractionConfidence < 0.75 ? (
                          <Badge tone="warning">
                            OCR {(inv.extractionConfidence * 100).toFixed(0)}%
                          </Badge>
                        ) : null}
                        <span className="text-sm font-semibold tabular-nums">
                          {formatInr(inv.outstandingBalance)}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="communications">
            {vm.communications.length === 0 ? (
              <EmptyState icon={<MessageSquare />} title="No communications yet" />
            ) : (
              <div className="flex flex-col gap-2">
                {vm.communications.map((c) => (
                  <Card key={c.id}>
                    <CardContent className="p-4">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <Badge tone={c.direction === "outbound" ? "info" : "primary"}>
                          {c.direction}
                        </Badge>
                        <Badge tone="neutral">{c.channel}</Badge>
                        <Badge
                          tone={
                            c.deliveryStatus === "failed" || c.deliveryStatus === "bounced"
                              ? "danger"
                              : "neutral"
                          }
                        >
                          {c.deliveryStatus}
                        </Badge>
                        <span className="ml-auto text-xs text-muted-foreground">
                          {fmtDate(c.createdAt)}
                        </span>
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
                {vm.payments.map((p) => (
                  <Card key={p.id}>
                    <CardContent className="flex items-center justify-between gap-3 p-4">
                      <div>
                        <p className="text-sm font-medium tabular-nums">{formatInr(p.amount)}</p>
                        <p className="text-xs text-muted-foreground">
                          {p.kind} &middot; {p.receivedOn} &middot; {p.reference ?? "no ref"}
                        </p>
                      </div>
                      <Badge tone={p.clientConfirmed ? "success" : "warning"}>
                        {p.clientConfirmed ? "Client confirmed" : "Awaiting confirmation"}
                      </Badge>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="evidence">
            <EmptyState
              icon={<Paperclip />}
              title="Evidence vault"
              description="Immutable source documents, OCR output and portal receipts are registered here. TODO(api): wire to evidence store."
            />
          </TabsContent>

          <TabsContent value="tasks">
            {vm.tasks.length === 0 ? (
              <EmptyState icon={<ListChecks />} title="No open tasks on this case" />
            ) : (
              <div className="flex flex-col gap-2">
                {vm.tasks.map((t) => (
                  <Card key={t.id}>
                    <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                      <div>
                        <p className="text-sm font-medium">{t.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {t.type.replace(/_/g, " ")} &middot; due {fmtDate(t.dueAt)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {t.urgent ? <Badge tone="danger">Urgent</Badge> : null}
                        <WaitingOnPill value={t.waitingOn} />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Automation state panel */}
      <aside className="lg:sticky lg:top-20 lg:self-start">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Server className="h-4 w-4" /> Automation state
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <Row label="Mode">
              <Badge tone={kase.automationMode === "automatic" ? "primary" : "neutral"}>
                {kase.automationMode}
              </Badge>
            </Row>
            <Separator />
            <Row label="Waiting on">
              <WaitingOnPill value={kase.waitingOn} />
            </Row>
            <Separator />
            <Row label="Eligibility route">{kase.eligibilityRoute ?? "Not yet evaluated"}</Row>
            <Separator />
            <Row label="Principal outstanding">
              <span className="tabular-nums">{formatInr(kase.principalOutstanding)}</span>
            </Row>
            <Row label="Recovered to date">
              <span className="tabular-nums">{formatInr(kase.recoveredToDate)}</span>
            </Row>
            <Separator />
            <Row label="Debtor">
              <span className="flex items-start gap-1.5">
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span>
                  {vm.debtorGstin ? <span className="font-mono text-xs">{vm.debtorGstin}</span> : "No GSTIN"}
                  <span className="block text-xs text-muted-foreground">
                    {vm.debtorAddress ?? "No address on file"}
                  </span>
                </span>
              </span>
            </Row>
            <div className="mt-3 flex flex-col gap-2">
              {kase.eligibilityRoute === "gst" || kase.status.startsWith("gst") ? (
                <LinkButton href={`/gst/${kase.id}`} variant="primary">
                  Open GST communication
                </LinkButton>
              ) : null}
              {kase.eligibilityRoute === "msme" || kase.status.startsWith("msme") ? (
                <LinkButton href={`/msme/${kase.id}`} variant="primary">
                  Open MSME ODR wizard
                </LinkButton>
              ) : null}
              <LinkButton href={`/communications?case=${kase.id}`}>View full thread</LinkButton>
            </div>
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}
