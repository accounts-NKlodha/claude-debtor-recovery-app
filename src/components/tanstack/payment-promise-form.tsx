/**
 * TanStack Start adapter for
 * src/components/screens/payment-promise-form.tsx -- identical UX/copy and
 * field-reset-on-success behavior; useActionState/<form action> -> local
 * state + recordPaymentPromiseFn, next/navigation's router.refresh() ->
 * TanStack Router's router.invalidate({ sync: true }).
 */
"use client";

import * as React from "react";
import { useRouter } from "@tanstack/react-router";
import { CircleAlert, CircleCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { recordPaymentPromiseFn, type RecordPaymentPromiseState } from "@/lib/whatsapp.functions";

const IDLE: RecordPaymentPromiseState = { kind: "idle" };

/**
 * Records the debtor's promise-to-pay (date, optional amount). Recording a
 * new date keeps the earlier promise as history. With several invoices the
 * operator must say which invoice the promise concerns -- it never defaults
 * to the first.
 */
export function PaymentPromiseForm({
  caseId,
  invoices,
  sourceReplyId,
}: {
  caseId: string;
  invoices: { id: string; invoiceNumber: string }[];
  sourceReplyId?: string | null;
}) {
  const router = useRouter();
  const [state, setState] = React.useState<RecordPaymentPromiseState>(IDLE);
  const [pending, setPending] = React.useState(false);
  const [promisedOn, setPromisedOn] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [invoiceId, setInvoiceId] = React.useState("");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    try {
      const result = await recordPaymentPromiseFn({
        data: { caseId, invoiceId: invoiceId || null, promisedOn, promisedAmount: amount, sourceReplyId: sourceReplyId ?? null },
      });
      setState(result);
      if (result.kind === "saved") {
        setPromisedOn("");
        setAmount("");
        await router.invalidate({ sync: true });
      }
    } catch {
      setState({ kind: "error", message: "Failed to record the promise" });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 rounded-md border border-border px-3 py-2">
      <p className="text-sm font-medium">Record a promise to pay</p>
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="promise-date">Promised payment date</Label>
          <Input id="promise-date" name="promisedOn" type="date" required value={promisedOn} onChange={(e) => setPromisedOn(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="promise-amount">Promised amount (₹, optional)</Label>
          <Input id="promise-amount" name="promisedAmount" inputMode="decimal" placeholder="e.g. 25000" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        {invoices.length > 1 ? (
          <div className="flex flex-col gap-1">
            <Label htmlFor="promise-invoice">Invoice</Label>
            <select
              id="promise-invoice"
              name="invoiceId"
              required
              value={invoiceId}
              onChange={(e) => setInvoiceId(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-card px-3 py-1 text-sm text-foreground shadow-sm"
            >
              <option value="">Select invoice…</option>
              {invoices.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.invoiceNumber}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" type="submit" disabled={pending}>
          {pending ? "Saving…" : "Record promise"}
        </Button>
        {state.kind === "saved" ? (
          <span className="inline-flex items-center gap-1 text-xs text-success" role="status">
            <CircleCheck className="h-3.5 w-3.5" /> Promise recorded.
          </span>
        ) : null}
        {state.kind === "error" ? (
          <span className="inline-flex items-center gap-1 text-xs text-danger" role="alert">
            <CircleAlert className="h-3.5 w-3.5" /> {state.message}
          </span>
        ) : null}
      </div>
    </form>
  );
}
