/**
 * TanStack Start adapter for
 * src/components/screens/send-reminder-button.tsx -- identical UX/copy;
 * useActionState/<form action> -> local state + sendInitialReminderFn,
 * next/navigation's router.refresh() -> TanStack Router's
 * router.invalidate({ sync: true }).
 */
"use client";

import * as React from "react";
import { useRouter } from "@tanstack/react-router";
import { Send, CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sendInitialReminderFn, type SendReminderState } from "@/lib/reminders.functions";

const SEND_REMINDER_IDLE: SendReminderState = { kind: "idle" };

export function SendReminderButton({
  caseId,
  invoices = [],
}: {
  caseId: string;
  /** With several invoices the WhatsApp reminder needs an explicit invoice; it never defaults to the first. */
  invoices?: { id: string; invoiceNumber: string }[];
}) {
  const router = useRouter();
  const [outcome, setOutcome] = React.useState<SendReminderState>(SEND_REMINDER_IDLE);
  const [pending, setPending] = React.useState(false);
  const [invoiceId, setInvoiceId] = React.useState("");

  async function send(forceRetryAfterAmbiguous: boolean) {
    setPending(true);
    try {
      const result = await sendInitialReminderFn({
        data: { caseId, forceRetryAfterAmbiguous, invoiceId: invoiceId || null },
      });
      setOutcome(result);
      if (result.kind !== "idle") await router.invalidate({ sync: true });
    } catch {
      setOutcome({ kind: "error", message: "Failed to send reminder" });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send(false);
        }}
      >
        {invoices.length > 1 ? (
          <select
            name="invoiceId"
            value={invoiceId}
            onChange={(e) => setInvoiceId(e.target.value)}
            aria-label="Invoice for the WhatsApp reminder"
            className="h-8 rounded-md border border-input bg-card px-2 text-xs text-foreground shadow-sm"
          >
            <option value="">WhatsApp invoice…</option>
            {invoices.map((i) => (
              <option key={i.id} value={i.id}>
                {i.invoiceNumber}
              </option>
            ))}
          </select>
        ) : null}
        <Button size="sm" type="submit" disabled={pending}>
          <Send className="h-3.5 w-3.5" />
          {pending ? "Sending…" : "Send initial reminder"}
        </Button>
        {outcome.kind === "sent" ? (
          <span className="inline-flex items-center gap-1 text-xs text-success">
            <CircleCheck className="h-3.5 w-3.5" /> Sent via {outcome.channels.join(", ")}
          </span>
        ) : null}
        {outcome.kind === "failed" ? (
          <span className="inline-flex items-center gap-1 text-xs text-danger">
            <CircleAlert className="h-3.5 w-3.5" />
            {outcome.channels.length > 0 ? `Failed on ${outcome.channels.join(", ")} -- safe to retry` : "Failed -- safe to retry"}
          </span>
        ) : null}
        {outcome.kind === "error" ? (
          <span className="inline-flex items-center gap-1 text-xs text-danger">
            <CircleAlert className="h-3.5 w-3.5" /> {outcome.message}
          </span>
        ) : null}
      </form>
      {outcome.kind !== "idle" && outcome.kind !== "error" && outcome.warnings.length > 0 ? (
        <div className="flex flex-col gap-1" role="status">
          {outcome.warnings.map((w) => (
            <span key={w} className="inline-flex items-start gap-1 text-xs text-warning">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {w}
            </span>
          ))}
        </div>
      ) : null}
      {outcome.kind === "ambiguous" ? (
        <div className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning-bg px-2 py-1.5 text-xs text-warning">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
          <span>
            A previous attempt&apos;s outcome is unknown -- retrying could send a duplicate. Confirm with the operator log before retrying.
          </span>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(true);
            }}
          >
            <Button size="sm" variant="outline" type="submit" disabled={pending}>
              Retry anyway
            </Button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
