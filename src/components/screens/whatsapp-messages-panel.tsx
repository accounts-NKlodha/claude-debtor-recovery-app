"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { CircleAlert, CircleCheck, Clock, MessageCircle, TriangleAlert } from "lucide-react";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { sendWhatsAppMessageAction, type SendWhatsAppMessageState } from "@/app/actions/whatsapp";
import type { WhatsAppOfferView } from "@/domain/whatsapp-messages";

const IDLE: SendWhatsAppMessageState = { kind: "idle" };

const STATUS_BADGE: Record<WhatsAppOfferView["status"], { label: string; tone: Tone }> = {
  available: { label: "Available", tone: "success" },
  sent: { label: "Accepted by provider", tone: "info" },
  unavailable: { label: "Not available", tone: "neutral" },
};

const OUTCOME_LABEL = { accepted: "accepted", rejected: "rejected", ambiguous: "outcome unknown" } as const;

function fmtWhen(iso: string) {
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
}

function SendButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button size="sm" type="submit" disabled={pending}>
      {pending ? "Sending…" : label}
    </Button>
  );
}

/** One row: what the message is, why it is/isn't available, what happened to it before. */
function OfferRow({ caseId, offer }: { caseId: string; offer: WhatsAppOfferView }) {
  const router = useRouter();
  const [state, formAction] = useActionState<SendWhatsAppMessageState, FormData>(sendWhatsAppMessageAction, IDLE);
  const prev = React.useRef<SendWhatsAppMessageState>(IDLE);
  React.useEffect(() => {
    if (state !== prev.current) {
      prev.current = state;
      if (state.kind !== "idle") router.refresh();
    }
  }, [state, router]);

  const badge = STATUS_BADGE[offer.status];
  // The initial reminder is sent from the dedicated "Send initial reminder"
  // control (which also covers the debtor's email); this row only reports it.
  const canSendHere = offer.status === "available" && offer.kind !== "initial_reminder" && offer.eventKey;

  return (
    <li className="flex flex-col gap-1 rounded-md border border-border px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{offer.label}</span>
          <Badge tone={badge.tone}>{badge.label}</Badge>
          {offer.ambiguous ? <Badge tone="warning">Earlier attempt: outcome unknown</Badge> : null}
        </div>
        {canSendHere ? (
          offer.ambiguous ? null : (
            <form action={formAction}>
              <input type="hidden" name="caseId" value={caseId} />
              <input type="hidden" name="eventKey" value={offer.eventKey!} />
              <SendButton label="Send on WhatsApp" />
            </form>
          )
        ) : null}
      </div>

      {offer.detail ? <p className="text-xs text-foreground">{offer.detail}</p> : null}
      <p className="text-xs text-muted-foreground">{offer.reason}</p>

      {offer.history ? (
        <p className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          Last attempt {fmtWhen(offer.history.attemptedAt)} — provider {OUTCOME_LABEL[offer.history.outcome]}
          {offer.history.attempts > 1 ? ` (${offer.history.attempts} attempts)` : ""}
        </p>
      ) : null}

      {canSendHere && offer.ambiguous ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-warning/40 bg-warning-bg px-2 py-1.5 text-xs text-warning">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
          <span>An earlier attempt&apos;s outcome is unknown — retrying could send a duplicate. Check the thread first.</span>
          <form action={formAction}>
            <input type="hidden" name="caseId" value={caseId} />
            <input type="hidden" name="eventKey" value={offer.eventKey!} />
            <input type="hidden" name="forceRetryAfterAmbiguous" value="true" />
            <SendButton label="Retry anyway" />
          </form>
        </div>
      ) : null}

      {state.kind === "accepted" ? (
        <span className="inline-flex items-center gap-1 text-xs text-success">
          <CircleCheck className="h-3.5 w-3.5" /> Accepted by the WhatsApp provider (delivery is not confirmed).
        </span>
      ) : null}
      {state.kind === "already_sent" ? (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <CircleCheck className="h-3.5 w-3.5" /> Already sent — no second message was sent.
        </span>
      ) : null}
      {state.kind === "rejected" ? (
        <span className="inline-flex items-center gap-1 text-xs text-danger">
          <CircleAlert className="h-3.5 w-3.5" /> The provider rejected this message — safe to retry.
        </span>
      ) : null}
      {state.kind === "ambiguous" ? (
        <span className="inline-flex items-center gap-1 text-xs text-warning">
          <TriangleAlert className="h-3.5 w-3.5" /> Outcome unknown — check before retrying.
        </span>
      ) : null}
      {state.kind === "error" ? (
        <span className="inline-flex items-center gap-1 text-xs text-danger" role="alert">
          <CircleAlert className="h-3.5 w-3.5" /> {state.message}
        </span>
      ) : null}
    </li>
  );
}

/**
 * The case's WhatsApp messages in one place: which are available and why,
 * which are not and why, and what already happened. Operator-triggered
 * only. Deliberately shows nothing about the provider's internals.
 */
export function WhatsAppMessagesPanel({ caseId, offers }: { caseId: string; offers: WhatsAppOfferView[] }) {
  if (offers.length === 0) return null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <MessageCircle className="h-4 w-4" /> WhatsApp messages
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <ul className="flex flex-col gap-2">
          {offers.map((o) => (
            <OfferRow key={o.eventKey ?? o.kind} caseId={caseId} offer={o} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
