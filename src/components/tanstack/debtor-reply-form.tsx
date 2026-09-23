/**
 * TanStack Start adapter for src/components/screens/debtor-reply-form.tsx
 * -- identical UX/copy; useActionState/<form action> -> local state +
 * recordDebtorReplyFn, next/navigation's router.refresh() -> TanStack
 * Router's router.invalidate({ sync: true }).
 */
"use client";

import * as React from "react";
import { useRouter } from "@tanstack/react-router";
import { MessageSquarePlus, CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { recordDebtorReplyFn, type RecordDebtorReplyState } from "@/lib/debtor-replies.functions";
import { CHANNEL, REPLY_CLASSIFICATION } from "@/contract/enums";

const RECORD_DEBTOR_REPLY_IDLE: RecordDebtorReplyState = { result: null, error: null };

/** Records + classifies an inbound debtor reply (classification is always
 * staff-entered in this build, no AI classification wired). */
export function DebtorReplyForm({ caseId }: { caseId: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [state, setState] = React.useState<RecordDebtorReplyState>(RECORD_DEBTOR_REPLY_IDLE);
  const [pending, setPending] = React.useState(false);
  const [channel, setChannel] = React.useState("whatsapp");
  const [classification, setClassification] = React.useState("unclear");
  const [rawBody, setRawBody] = React.useState("");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    try {
      const result = await recordDebtorReplyFn({ data: { caseId, channel, rawBody, classification } });
      setState(result);
      if (result.result) {
        setRawBody("");
        setOpen(false);
        await router.invalidate({ sync: true });
      }
    } catch {
      setState({ result: null, error: "Failed to record the reply" });
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <MessageSquarePlus className="h-3.5 w-3.5" />
        Log debtor reply
      </Button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 shadow-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor="reply-channel" className="text-xs">Channel</Label>
        <select
          id="reply-channel"
          name="channel"
          value={channel}
          onChange={(e) => setChannel(e.target.value)}
          className="h-8 rounded-md border border-input bg-card px-2 text-sm text-foreground shadow-xs"
        >
          {CHANNEL.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <Label htmlFor="reply-classification" className="text-xs">Classification</Label>
        <select
          id="reply-classification"
          name="classification"
          value={classification}
          onChange={(e) => setClassification(e.target.value)}
          className="h-8 rounded-md border border-input bg-card px-2 text-sm text-foreground shadow-xs"
        >
          {REPLY_CLASSIFICATION.map((c) => (
            <option key={c} value={c}>{c.replace(/_/g, " ")}</option>
          ))}
        </select>
      </div>
      <Label htmlFor="reply-body" className="sr-only">Reply text</Label>
      <Input id="reply-body" name="rawBody" placeholder="Paste the debtor's reply text" required value={rawBody} onChange={(e) => setRawBody(e.target.value)} />
      <div className="flex items-center gap-2">
        <Button size="sm" type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save reply"}
        </Button>
        <Button size="sm" variant="outline" type="button" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {state.error ? (
        <span className="flex items-center gap-1.5 text-xs text-danger" role="alert">
          <CircleAlert className="h-3.5 w-3.5" /> {state.error}
        </span>
      ) : null}
    </form>
  );
}
