"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { MessageSquarePlus, CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { recordDebtorReplyAction } from "@/app/actions/debtor-replies";
import { CHANNEL, REPLY_CLASSIFICATION, type Channel, type ReplyClassification } from "@/contract/enums";

/** Records + classifies an inbound debtor reply (PRD §8 -- classification is
 * always staff-entered in this build, no AI classification wired). */
export function DebtorReplyForm({ caseId }: { caseId: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [channel, setChannel] = React.useState<Channel>("whatsapp");
  const [classification, setClassification] = React.useState<ReplyClassification>("unclear");
  const [rawBody, setRawBody] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <MessageSquarePlus className="h-3.5 w-3.5" />
        Log debtor reply
      </Button>
    );
  }

  const submit = () => {
    if (!rawBody.trim()) return;
    setPending(true);
    setError(null);
    recordDebtorReplyAction(caseId, { channel, rawBody, classification })
      .then(() => {
        setRawBody("");
        setOpen(false);
        router.refresh();
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to record reply"))
      .finally(() => setPending(false));
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor="reply-channel" className="text-xs">Channel</Label>
        <select
          id="reply-channel"
          className="h-8 rounded-md border border-input bg-background px-2 text-sm"
          value={channel}
          onChange={(e) => setChannel(e.target.value as Channel)}
        >
          {CHANNEL.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <Label htmlFor="reply-classification" className="text-xs">Classification</Label>
        <select
          id="reply-classification"
          className="h-8 rounded-md border border-input bg-background px-2 text-sm"
          value={classification}
          onChange={(e) => setClassification(e.target.value as ReplyClassification)}
        >
          {REPLY_CLASSIFICATION.map((c) => (
            <option key={c} value={c}>{c.replace(/_/g, " ")}</option>
          ))}
        </select>
      </div>
      <Label htmlFor="reply-body" className="sr-only">Reply text</Label>
      <Input
        id="reply-body"
        placeholder="Paste the debtor's reply text"
        value={rawBody}
        onChange={(e) => setRawBody(e.target.value)}
      />
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={submit} disabled={pending || !rawBody.trim()}>
          {pending ? "Saving…" : "Save reply"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </Button>
      </div>
      {error ? (
        <span className="flex items-center gap-1.5 text-xs text-danger" role="alert">
          <CircleAlert className="h-3.5 w-3.5" /> {error}
        </span>
      ) : null}
    </div>
  );
}
