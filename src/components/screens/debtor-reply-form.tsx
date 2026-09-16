"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { MessageSquarePlus, CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { recordDebtorReplyAction, type RecordDebtorReplyState } from "@/app/actions/debtor-replies";
import { CHANNEL, REPLY_CLASSIFICATION } from "@/contract/enums";

const RECORD_DEBTOR_REPLY_IDLE: RecordDebtorReplyState = { result: null, error: null };

function SaveReplyButton() {
  const { pending } = useFormStatus();
  return (
    <Button size="sm" type="submit" disabled={pending}>
      {pending ? "Saving…" : "Save reply"}
    </Button>
  );
}

/** Records + classifies an inbound debtor reply (PRD §8 -- classification is
 * always staff-entered in this build, no AI classification wired). */
export function DebtorReplyForm({ caseId }: { caseId: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [state, formAction] = useActionState<RecordDebtorReplyState, FormData>(
    recordDebtorReplyAction,
    RECORD_DEBTOR_REPLY_IDLE,
  );
  const formRef = React.useRef<HTMLFormElement>(null);
  const lastResultRef = React.useRef<RecordDebtorReplyState["result"]>(null);

  React.useEffect(() => {
    if (state.result && state.result !== lastResultRef.current) {
      lastResultRef.current = state.result;
      formRef.current?.reset();
      setOpen(false);
      router.refresh();
    }
  }, [state.result, router]);

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <MessageSquarePlus className="h-3.5 w-3.5" />
        Log debtor reply
      </Button>
    );
  }

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-2 rounded-md border border-border p-3">
      <input type="hidden" name="caseId" value={caseId} />
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor="reply-channel" className="text-xs">Channel</Label>
        <select
          id="reply-channel"
          name="channel"
          defaultValue="whatsapp"
          className="h-8 rounded-md border border-input bg-background px-2 text-sm"
        >
          {CHANNEL.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <Label htmlFor="reply-classification" className="text-xs">Classification</Label>
        <select
          id="reply-classification"
          name="classification"
          defaultValue="unclear"
          className="h-8 rounded-md border border-input bg-background px-2 text-sm"
        >
          {REPLY_CLASSIFICATION.map((c) => (
            <option key={c} value={c}>{c.replace(/_/g, " ")}</option>
          ))}
        </select>
      </div>
      <Label htmlFor="reply-body" className="sr-only">Reply text</Label>
      <Input id="reply-body" name="rawBody" placeholder="Paste the debtor's reply text" required />
      <div className="flex items-center gap-2">
        <SaveReplyButton />
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
