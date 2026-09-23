/**
 * TanStack Start adapter for src/components/screens/payments-screen.tsx --
 * identical UX/copy/business logic (explicit Organisation -> Case
 * selection preserved exactly -- no silent/automatic case selection is
 * introduced). useActionState/<form action> -> local state calling
 * payments.functions.ts directly; next/navigation's router.refresh() ->
 * TanStack Router's router.invalidate({ sync: true }).
 */
"use client";

import * as React from "react";
import { useRouter } from "@tanstack/react-router";
import { CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";
import type { PaymentRecord } from "@/contract/types";
import { PAYMENT_KIND } from "@/contract/enums";
import { recordPaymentFn, confirmPaymentFn, type RecordPaymentState, type ConfirmPaymentState } from "@/lib/payments.functions";
import { formatInr } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ChipFilterRow, type ChipOption } from "@/components/ui/chip-filter";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface PaymentRow extends PaymentRecord {
  debtorName: string;
  clientName: string;
}

export interface PaymentCaseOption {
  id: string;
  organisationId: string;
  debtorName: string;
  status: string;
}

export interface PaymentInvoiceOption {
  id: string;
  invoiceNumber: string;
  outstandingBalance: number;
}

const RECORD_PAYMENT_IDLE: RecordPaymentState = { payment: null, error: null };
const CONFIRM_PAYMENT_IDLE: ConfirmPaymentState = { confirmed: false, error: null };

/** One row's "Confirm & stop escalation" button -- its own local state so
 * each row's pending/error state is independent. */
function ConfirmReceiptButton({ paymentId, caseId, onConfirmed }: { paymentId: string; caseId: string; onConfirmed: () => void }) {
  const [state, setState] = React.useState<ConfirmPaymentState>(CONFIRM_PAYMENT_IDLE);
  const [pending, setPending] = React.useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    try {
      const result = await confirmPaymentFn({ data: { paymentId, caseId } });
      setState(result);
      if (result.confirmed) onConfirmed();
    } catch {
      setState({ confirmed: false, error: "Failed to confirm receipt" });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="inline-flex flex-col items-end gap-1">
      <Button size="sm" variant="outline" type="submit" disabled={pending}>
        {pending ? "Confirming…" : "Confirm & stop escalation"}
      </Button>
      {state.error ? (
        <span className="max-w-[220px] text-right text-[11px] text-danger" role="alert">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}

export function PaymentsScreen({
  rows: initial,
  organisations,
  cases,
  invoicesByCase,
}: {
  rows: PaymentRow[];
  organisations: { id: string; legalEntityName: string }[];
  cases: PaymentCaseOption[];
  invoicesByCase: Record<string, PaymentInvoiceOption[]>;
}) {
  const router = useRouter();
  // `initial` is the server-fetched source of truth; router.invalidate()
  // after a mutation re-runs the route's loader and gives us fresh props.
  // `optimisticConfirmed` only smooths the gap between click and that
  // refresh landing.
  const [optimisticConfirmed, setOptimisticConfirmed] = React.useState<Set<string>>(new Set());
  const rows = initial.map((r) =>
    optimisticConfirmed.has(r.id) ? { ...r, clientConfirmed: true } : r,
  );
  const [statusFilter, setStatusFilter] = React.useState<"all" | "unconfirmed" | "confirmed">("all");
  const [selectedOrgId, setSelectedOrgId] = React.useState("");
  const [selectedCaseId, setSelectedCaseId] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [kind, setKind] = React.useState<string>("bank");
  const [reference, setReference] = React.useState("");
  const [confirmNow, setConfirmNow] = React.useState(false);

  const [state, setState] = React.useState<RecordPaymentState>(RECORD_PAYMENT_IDLE);
  const [pending, setPending] = React.useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    try {
      const result = await recordPaymentFn({
        data: { caseId: selectedCaseId, kind, amount, reference, clientConfirmed: confirmNow },
      });
      setState(result);
      if (result.payment) {
        setAmount("");
        setReference("");
        setConfirmNow(false);
        await router.invalidate({ sync: true });
      }
    } catch {
      setState({ payment: null, error: "Failed to record receipt" });
    } finally {
      setPending(false);
    }
  }

  const unconfirmedTotal = rows.filter((r) => !r.clientConfirmed).reduce((s, r) => s + r.amount, 0);
  const confirmedTotal = rows.filter((r) => r.clientConfirmed).reduce((s, r) => s + r.amount, 0);
  const filterOptions: ChipOption<typeof statusFilter>[] = [
    { value: "all", label: "All receipts", count: rows.length },
    { value: "unconfirmed", label: "Awaiting confirmation", count: rows.filter((r) => !r.clientConfirmed).length },
    { value: "confirmed", label: "Confirmed", count: rows.filter((r) => r.clientConfirmed).length },
  ];
  const filteredRows =
    statusFilter === "all" ? rows : rows.filter((r) => (statusFilter === "confirmed") === r.clientConfirmed);

  const casesInOrg = cases.filter((c) => c.organisationId === selectedOrgId);
  const invoicesForCase = selectedCaseId ? (invoicesByCase[selectedCaseId] ?? []) : [];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xl font-semibold tabular-nums">{formatInr(unconfirmedTotal)}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Awaiting confirmation</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xl font-semibold tabular-nums">{formatInr(confirmedTotal)}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Confirmed this view</p>
          </CardContent>
        </Card>
        <Card className="hidden sm:block">
          <CardContent className="p-4">
            <p className="text-xl font-semibold tabular-nums">{rows.length}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Total receipts recorded</p>
          </CardContent>
        </Card>
      </div>
      <ChipFilterRow aria-label="Filter receipts" options={filterOptions} value={statusFilter} onChange={setStatusFilter} />
    <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
      <Card className="lg:sticky lg:top-20 lg:self-start">
        <CardHeader>
          <CardTitle>Record a receipt</CardTitle>
          <CardDescription>
            Select the organisation and case this receipt belongs to, then enter the amount. Full,
            partial, TDS or settlement. Confirming a receipt immediately cancels any pending
            escalation for the case.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="pay-org">Organisation</Label>
              <select
                id="pay-org"
                value={selectedOrgId}
                onChange={(e) => {
                  setSelectedOrgId(e.target.value);
                  setSelectedCaseId("");
                }}
                className="h-9 rounded-md border border-input bg-card px-2 text-sm"
              >
                <option value="">Select an organisation…</option>
                {organisations.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.legalEntityName}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="pay-case">Recovery case</Label>
              <select
                id="pay-case"
                name="caseId"
                value={selectedCaseId}
                onChange={(e) => setSelectedCaseId(e.target.value)}
                disabled={!selectedOrgId}
                className="h-9 rounded-md border border-input bg-card px-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">
                  {selectedOrgId ? "Select a case…" : "Select an organisation first"}
                </option>
                {casesInOrg.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.debtorName} — {c.status.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
              {selectedOrgId && casesInOrg.length === 0 ? (
                <span className="text-[11px] text-muted-foreground">No cases on file for this organisation yet.</span>
              ) : null}
            </div>
            {selectedCaseId ? (
              <div className="rounded-md border border-dashed border-border p-2 text-[11px] text-muted-foreground">
                {invoicesForCase.length > 0 ? (
                  <>
                    <span className="font-medium">Open invoices on this case (for reference only —</span>{" "}
                    allocation happens automatically, oldest-first, when this receipt is confirmed):
                    <ul className="mt-1 flex flex-col gap-0.5">
                      {invoicesForCase.map((inv) => (
                        <li key={inv.id} className="font-mono">
                          {inv.invoiceNumber} — {formatInr(inv.outstandingBalance)} outstanding
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  "No invoices linked to this case yet."
                )}
              </div>
            ) : null}
            <div className="flex flex-col gap-1">
              <Label htmlFor="pay-amount">Amount (₹)</Label>
              <Input id="pay-amount" name="amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="pay-kind">Kind</Label>
              <select
                id="pay-kind"
                name="kind"
                value={kind}
                onChange={(e) => setKind(e.target.value)}
                className="h-9 rounded-md border border-input bg-card px-2 text-sm"
              >
                {PAYMENT_KIND.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="pay-ref">Reference (UTR / note)</Label>
              <Input id="pay-ref" name="reference" value={reference} onChange={(e) => setReference(e.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                name="clientConfirmed"
                checked={confirmNow}
                onChange={(e) => setConfirmNow(e.target.checked)}
                className="h-4 w-4"
              />
              Client has confirmed this receipt
            </label>
            {confirmNow ? (
              <p className="flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning-bg px-2.5 py-1.5 text-[11px] text-warning">
                <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
                Confirming cancels pending GST / MSME escalation for this case.
              </p>
            ) : null}
            {state.error ? (
              <span className="flex items-center gap-1.5 text-[11px] text-danger" role="alert">
                <CircleAlert className="h-3.5 w-3.5 shrink-0" /> {state.error}
              </span>
            ) : null}
            <Button type="submit" disabled={pending}>
              {pending ? "Recording…" : "Record receipt"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Debtor</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Received</TableHead>
              <TableHead>Reference</TableHead>
              <TableHead>Confirmation</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredRows.map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  <span className="font-medium">{p.debtorName}</span>
                  <span className="block text-[11px] text-muted-foreground">{p.clientName}</span>
                </TableCell>
                <TableCell>
                  <Badge tone="neutral">{p.kind}</Badge>
                </TableCell>
                <TableCell className="tabular-nums">{formatInr(p.amount)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{p.receivedOn}</TableCell>
                <TableCell className="font-mono text-xs">{p.reference ?? "—"}</TableCell>
                <TableCell>
                  {p.clientConfirmed ? (
                    <Badge tone="success" icon={<CircleCheck />}>
                      Confirmed
                    </Badge>
                  ) : (
                    <ConfirmReceiptButton
                      paymentId={p.id}
                      caseId={p.caseId}
                      onConfirmed={() => {
                        setOptimisticConfirmed((s) => new Set(s).add(p.id));
                        void router.invalidate({ sync: true });
                      }}
                    />
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
    </div>
  );
}
