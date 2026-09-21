"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Send, CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sendInitialReminderAction, type SendReminderState } from "@/app/actions/reminders";

const SEND_REMINDER_IDLE: SendReminderState = { kind: "idle" };

function SendButton() {
  const { pending } = useFormStatus();
  return (
    <Button size="sm" type="submit" disabled={pending}>
      <Send className="h-3.5 w-3.5" />
      {pending ? "Sending…" : "Send initial reminder"}
    </Button>
  );
}

function RetryButton() {
  const { pending } = useFormStatus();
  return (
    <Button size="sm" variant="outline" type="submit" disabled={pending}>
      Retry anyway
    </Button>
  );
}

export function SendReminderButton({
  caseId,
  invoices = [],
}: {
  caseId: string;
  /** With several invoices the WhatsApp reminder needs an explicit invoice; it never defaults to the first. */
  invoices?: { id: string; invoiceNumber: string }[];
}) {
  const router = useRouter();
  const [outcome, formAction] = useActionState<SendReminderState, FormData>(sendInitialReminderAction, SEND_REMINDER_IDLE);
  const prevOutcomeRef = React.useRef<SendReminderState>(SEND_REMINDER_IDLE);

  React.useEffect(() => {
    if (outcome !== prevOutcomeRef.current) {
      prevOutcomeRef.current = outcome;
      if (outcome.kind !== "idle") router.refresh();
    }
  }, [outcome, router]);

  return (
    <div className="flex flex-col gap-1">
      <form action={formAction} className="flex items-center gap-2">
        <input type="hidden" name="caseId" value={caseId} />
        <input type="hidden" name="forceRetryAfterAmbiguous" value="false" />
        {invoices.length > 1 ? (
          <select
            name="invoiceId"
            defaultValue=""
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
        <SendButton />
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
          <form action={formAction}>
            <input type="hidden" name="caseId" value={caseId} />
            <input type="hidden" name="forceRetryAfterAmbiguous" value="true" />
            <RetryButton />
          </form>
        </div>
      ) : null}
    </div>
  );
}
