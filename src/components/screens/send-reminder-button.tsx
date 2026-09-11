"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Send, CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sendInitialReminderAction } from "@/app/actions/reminders";

export function SendReminderButton({ caseId }: { caseId: string }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const send = () => {
    setPending(true);
    setError(null);
    sendInitialReminderAction(caseId)
      .then(() => router.refresh())
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to send reminder"))
      .finally(() => setPending(false));
  };

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" onClick={send} disabled={pending}>
        <Send className="h-3.5 w-3.5" />
        {pending ? "Sending…" : "Send initial reminder"}
      </Button>
      {error ? (
        <span className="inline-flex items-center gap-1 text-xs text-danger">
          <CircleAlert className="h-3.5 w-3.5" /> {error}
        </span>
      ) : null}
    </div>
  );
}
