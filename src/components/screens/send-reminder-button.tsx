"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Send, CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sendInitialReminderAction } from "@/app/actions/reminders";

type Outcome =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | { kind: "sent"; channels: string[] }
  | { kind: "failed"; channels: string[] }
  | { kind: "ambiguous" };

export function SendReminderButton({ caseId }: { caseId: string }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [outcome, setOutcome] = React.useState<Outcome>({ kind: "idle" });

  const send = (forceRetryAfterAmbiguous: boolean) => {
    setPending(true);
    sendInitialReminderAction(caseId, forceRetryAfterAmbiguous)
      .then((result) => {
        const sentChannels = result.communications.filter((c) => c.deliveryStatus === "sent").map((c) => c.channel);
        const failedChannels = result.communications.filter((c) => c.deliveryStatus === "failed").map((c) => c.channel);
        // A success toast is only shown when the durable delivery result
        // actually says "sent" -- never merely because the action call
        // itself didn't throw (email-delivery task §13).
        if (result.ambiguous) {
          setOutcome({ kind: "ambiguous" });
        } else if (sentChannels.length > 0) {
          setOutcome({ kind: "sent", channels: sentChannels });
        } else {
          setOutcome({ kind: "failed", channels: failedChannels });
        }
        router.refresh();
      })
      .catch((e: unknown) => setOutcome({ kind: "error", message: e instanceof Error ? e.message : "Failed to send reminder" }))
      .finally(() => setPending(false));
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => send(false)} disabled={pending}>
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
      </div>
      {outcome.kind === "ambiguous" ? (
        <div className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning-bg px-2 py-1.5 text-xs text-warning">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
          <span>
            A previous attempt&apos;s outcome is unknown -- retrying could send a duplicate. Confirm with the operator log before retrying.
          </span>
          <Button size="sm" variant="outline" onClick={() => send(true)} disabled={pending}>
            Retry anyway
          </Button>
        </div>
      ) : null}
    </div>
  );
}
