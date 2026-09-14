"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FileClock, CalendarPlus, CircleAlert, CheckCircle2, CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { formatInr } from "@/lib/utils";
import {
  prepareDdTaskAction,
  recordDdSubmittedAction,
  recordHearingOutcomeAction,
  rescheduleHearingAction,
  scheduleHearingAction,
} from "@/app/actions/hearing";
import type { CaseStatus } from "@/contract/enums";
import type { CaseHearing, DdRecord } from "@/contract/types";

function fmtDate(s: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function DdPanel({ caseId, ddRecord }: { caseId: string; ddRecord: DdRecord | undefined }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [amount, setAmount] = React.useState(ddRecord?.amount ? String(ddRecord.amount / 100) : "1000");
  const [payee, setPayee] = React.useState(ddRecord?.payee ?? "MSEFC");
  const [reference, setReference] = React.useState(ddRecord?.reference ?? "");

  const prepare = () => {
    setPending(true);
    setError(null);
    const paise = Math.round(Number(amount) * 100);
    prepareDdTaskAction(caseId, { amount: Number.isFinite(paise) ? paise : null, payee, reference: reference || null })
      .then(() => router.refresh())
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to prepare DD"))
      .finally(() => setPending(false));
  };

  const submitDd = () => {
    setPending(true);
    setError(null);
    recordDdSubmittedAction(caseId, { submittedAt: new Date().toISOString() })
      .then(() => router.refresh())
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to record DD submitted"))
      .finally(() => setPending(false));
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <FileClock className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium">Demand draft (DD)</span>
        {ddRecord ? (
          <Badge tone={ddRecord.status === "submitted" ? "success" : "warning"}>
            {ddRecord.status.replace(/_/g, " ")}
          </Badge>
        ) : null}
      </div>
      {ddRecord?.status === "submitted" ? (
        <p className="text-xs text-muted-foreground">
          {ddRecord.payee ?? "—"} &middot; {formatInr(ddRecord.amount ?? 0)} &middot; ref{" "}
          {ddRecord.reference ?? "—"} &middot; submitted {fmtDate(ddRecord.submittedAt)}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor="dd-amount" className="text-xs">Amount (₹)</Label>
            <Input id="dd-amount" className="h-8 w-24" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <Label htmlFor="dd-payee" className="text-xs">Payee</Label>
            <Input id="dd-payee" className="h-8 w-40" value={payee} onChange={(e) => setPayee(e.target.value)} />
            <Label htmlFor="dd-ref" className="text-xs">Reference</Label>
            <Input
              id="dd-ref"
              className="h-8 w-32"
              placeholder="DD number"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={prepare} disabled={pending}>
              {ddRecord ? "Update DD details" : "Prepare DD task"}
            </Button>
            {ddRecord ? (
              <Button size="sm" onClick={submitDd} disabled={pending}>
                <CheckCircle2 className="h-3.5 w-3.5" />
                Mark DD submitted
              </Button>
            ) : null}
          </div>
        </>
      )}
      {error ? (
        <span className="flex items-center gap-1.5 text-xs text-danger" role="alert">
          <CircleAlert className="h-3.5 w-3.5" /> {error}
        </span>
      ) : null}
    </div>
  );
}

function HearingPanel({ caseId, hearings }: { caseId: string; hearings: CaseHearing[] }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [date, setDate] = React.useState("");
  const open = hearings.find((h) => h.status === "scheduled");
  const history = hearings.filter((h) => h.id !== open?.id);

  const schedule = () => {
    if (!date) return;
    setPending(true);
    setError(null);
    scheduleHearingAction(caseId, new Date(date).toISOString())
      .then(() => router.refresh())
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to schedule hearing"))
      .finally(() => setPending(false));
  };

  const reschedule = () => {
    if (!date || !open) return;
    setPending(true);
    setError(null);
    rescheduleHearingAction(open.id, caseId, new Date(date).toISOString())
      .then(() => router.refresh())
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to reschedule hearing"))
      .finally(() => setPending(false));
  };

  const recordOutcome = (status: "completed" | "cancelled", recovered: boolean) => {
    if (!open) return;
    setPending(true);
    setError(null);
    recordHearingOutcomeAction(open.id, caseId, status, recovered)
      .then(() => router.refresh())
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to record hearing outcome"))
      .finally(() => setPending(false));
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium">Hearing</span>
        {open ? <Badge tone="info">Scheduled {fmtDate(open.scheduledAt)}</Badge> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor="hearing-date" className="sr-only">Hearing date</Label>
        <Input
          id="hearing-date"
          type="datetime-local"
          className="h-8 w-auto"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        {open ? (
          <>
            <Button size="sm" variant="outline" onClick={reschedule} disabled={!date || pending}>
              Reschedule
            </Button>
            <Button size="sm" onClick={() => recordOutcome("completed", true)} disabled={pending}>
              Order in favour
            </Button>
            <Button size="sm" variant="outline" onClick={() => recordOutcome("completed", false)} disabled={pending}>
              Order against
            </Button>
            <Button size="sm" variant="outline" onClick={() => recordOutcome("cancelled", false)} disabled={pending}>
              Cancel hearing
            </Button>
          </>
        ) : (
          <Button size="sm" onClick={schedule} disabled={!date || pending}>
            <CalendarPlus className="h-3.5 w-3.5" />
            {pending ? "Scheduling…" : "Schedule hearing"}
          </Button>
        )}
      </div>
      {history.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {history.length} earlier occurrence{history.length > 1 ? "s" : ""} on record.
        </p>
      ) : null}
      {error ? (
        <span className="flex items-center gap-1.5 text-xs text-danger" role="alert">
          <CircleAlert className="h-3.5 w-3.5" /> {error}
        </span>
      ) : null}
    </div>
  );
}

export function DdHearingActions({
  caseId,
  status,
  ddRecord,
  hearings,
}: {
  caseId: string;
  status: CaseStatus;
  ddRecord: DdRecord | undefined;
  hearings: CaseHearing[];
}) {
  const relevant =
    status === "msme_odr_filed" || status === "msefc_dd" || status === "hearing_scheduled" || status === "adjourned";
  if (!relevant && !ddRecord && hearings.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {status === "msme_odr_filed" || ddRecord ? <DdPanel caseId={caseId} ddRecord={ddRecord} /> : null}
      {relevant || hearings.length > 0 ? <HearingPanel caseId={caseId} hearings={hearings} /> : null}
    </div>
  );
}
