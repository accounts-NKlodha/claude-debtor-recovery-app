"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, TriangleAlert } from "lucide-react";
import type { PaymentRecord } from "@/contract/types";
import { PAYMENT_KIND } from "@/contract/enums";
import { moneyToPaise } from "@/contract/schemas";
import { recordPaymentAction, confirmPaymentAction } from "@/app/actions/payments";
import { formatInr } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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

export function PaymentsScreen({ rows: initial }: { rows: PaymentRow[] }) {
  const router = useRouter();
  // `initial` is the server-fetched source of truth; router.refresh() after a
  // mutation re-runs the page and gives us fresh props. `optimisticConfirmed`
  // only smooths the gap between click and that refresh landing.
  const [optimisticConfirmed, setOptimisticConfirmed] = React.useState<Set<string>>(new Set());
  const rows = initial.map((r) =>
    optimisticConfirmed.has(r.id) ? { ...r, clientConfirmed: true } : r,
  );
  const [amount, setAmount] = React.useState("");
  const [kind, setKind] = React.useState<PaymentRecord["kind"]>("bank");
  const [reference, setReference] = React.useState("");
  const [confirmNow, setConfirmNow] = React.useState(false);
  const [amountError, setAmountError] = React.useState<string | null>(null);
  const [pendingId, setPendingId] = React.useState<string | null>(null);

  const confirm = (row: PaymentRow) => {
    setPendingId(row.id);
    setOptimisticConfirmed((s) => new Set(s).add(row.id));
    confirmPaymentAction(row.id, row.caseId)
      .catch(() =>
        setOptimisticConfirmed((s) => {
          const next = new Set(s);
          next.delete(row.id);
          return next;
        }),
      )
      .finally(() => {
        setPendingId(null);
        router.refresh();
      });
  };

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = moneyToPaise.safeParse(amount);
    if (!parsed.success) {
      setAmountError("Enter a valid amount, e.g. 1,25,000");
      return;
    }
    setAmountError(null);
    const caseId = rows[0]?.caseId ?? "case-1";
    recordPaymentAction({ caseId, kind, amount: parsed.data, reference: reference || null, clientConfirmed: confirmNow })
      .then(() => router.refresh())
      .catch(() => {
        /* surfaced via router.refresh() reverting to last persisted state */
      });
    setAmount("");
    setReference("");
    setConfirmNow(false);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
      <Card className="lg:sticky lg:top-20 lg:self-start">
        <CardHeader>
          <CardTitle>Record a receipt</CardTitle>
          <CardDescription>
            Full, partial, TDS or settlement. Confirming a receipt immediately cancels any pending
            escalation for the case.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <form onSubmit={add} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="pay-amount">Amount (₹)</Label>
              <Input
                id="pay-amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                aria-invalid={!!amountError}
              />
              {amountError ? (
                <span className="text-[11px] text-danger" role="alert">
                  {amountError}
                </span>
              ) : null}
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="pay-kind">Kind</Label>
              <select
                id="pay-kind"
                value={kind}
                onChange={(e) => setKind(e.target.value as PaymentRecord["kind"])}
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
              <Input id="pay-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
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
            <Button type="submit">Record receipt</Button>
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
            {rows.map((p) => (
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
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pendingId === p.id}
                      onClick={() => confirm(p)}
                    >
                      {pendingId === p.id ? "Confirming…" : "Confirm & stop escalation"}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
