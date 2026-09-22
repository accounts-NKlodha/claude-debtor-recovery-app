/**
 * TanStack Start adapter for src/components/screens/dd-hearing-actions.tsx
 * -- identical UX/copy for both sub-panels (DD, hearing); useActionState/
 * <form action> -> local state + the 5 hearing.functions.ts server
 * functions, next/navigation's router.refresh() -> TanStack Router's
 * router.invalidate({ sync: true }).
 */
"use client";

import * as React from "react";
import { useRouter } from "@tanstack/react-router";
import { FileClock, CalendarPlus, CircleAlert, CheckCircle2, CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { formatInr } from "@/lib/utils";
import {
  prepareDdTaskFn,
  recordDdSubmittedFn,
  recordHearingOutcomeFn,
  rescheduleHearingFn,
  scheduleHearingFn,
  type PrepareDdTaskState,
  type RecordDdSubmittedState,
  type RecordHearingOutcomeState,
  type RescheduleHearingState,
  type ScheduleHearingState,
} from "@/lib/hearing.functions";
import type { CaseStatus } from "@/contract/enums";
import type { CaseHearing, DdRecord } from "@/contract/types";

const PREPARE_DD_IDLE: PrepareDdTaskState = { result: null, error: null };
const RECORD_DD_SUBMITTED_IDLE: RecordDdSubmittedState = { result: null, error: null };
const SCHEDULE_HEARING_IDLE: ScheduleHearingState = { result: null, error: null };
const RESCHEDULE_HEARING_IDLE: RescheduleHearingState = { result: null, error: null };
const RECORD_OUTCOME_IDLE: RecordHearingOutcomeState = { result: null, error: null };

function fmtDate(s: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function DdPanel({ caseId, ddRecord }: { caseId: string; ddRecord: DdRecord | undefined }) {
  const router = useRouter();
  const [prepareState, setPrepareState] = React.useState<PrepareDdTaskState>(PREPARE_DD_IDLE);
  const [submitState, setSubmitState] = React.useState<RecordDdSubmittedState>(RECORD_DD_SUBMITTED_IDLE);
  const [pending, setPending] = React.useState(false);
  const [amount, setAmount] = React.useState(ddRecord?.amount ? String(ddRecord.amount / 100) : "1000");
  const [payee, setPayee] = React.useState(ddRecord?.payee ?? "MSEFC");
  const [reference, setReference] = React.useState(ddRecord?.reference ?? "");

  async function handlePrepare(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    try {
      const result = await prepareDdTaskFn({ data: { caseId, amount, payee, reference } });
      setPrepareState(result);
      if (result.result) await router.invalidate({ sync: true });
    } catch {
      setPrepareState({ result: null, error: "Failed to prepare the DD" });
    } finally {
      setPending(false);
    }
  }

  async function handleSubmitted(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    try {
      const result = await recordDdSubmittedFn({ data: { caseId } });
      setSubmitState(result);
      if (result.result) await router.invalidate({ sync: true });
    } catch {
      setSubmitState({ result: null, error: "Failed to record the DD as submitted" });
    } finally {
      setPending(false);
    }
  }

  const error = submitState.error ?? prepareState.error;

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
          <form onSubmit={handlePrepare} className="flex flex-wrap items-center gap-2">
            <Label htmlFor="dd-amount" className="text-xs">Amount (₹)</Label>
            <Input id="dd-amount" name="amount" className="h-8 w-24" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <Label htmlFor="dd-payee" className="text-xs">Payee</Label>
            <Input id="dd-payee" name="payee" className="h-8 w-40" value={payee} onChange={(e) => setPayee(e.target.value)} />
            <Label htmlFor="dd-ref" className="text-xs">Reference</Label>
            <Input
              id="dd-ref"
              name="reference"
              className="h-8 w-32"
              placeholder="DD number"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
            <Button size="sm" type="submit" variant="outline" disabled={pending}>
              {ddRecord ? "Update DD details" : "Prepare DD task"}
            </Button>
          </form>
          {ddRecord ? (
            <form onSubmit={handleSubmitted}>
              <Button size="sm" type="submit" disabled={pending}>
                <CheckCircle2 className="h-3.5 w-3.5" />
                Mark DD submitted
              </Button>
            </form>
          ) : null}
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
  const open = hearings.find((h) => h.status === "scheduled");
  const history = hearings.filter((h) => h.id !== open?.id);

  const [scheduleState, setScheduleState] = React.useState<ScheduleHearingState>(SCHEDULE_HEARING_IDLE);
  const [rescheduleState, setRescheduleState] = React.useState<RescheduleHearingState>(RESCHEDULE_HEARING_IDLE);
  const [outcomeState, setOutcomeState] = React.useState<RecordHearingOutcomeState>(RECORD_OUTCOME_IDLE);
  const [pending, setPending] = React.useState(false);
  const [newStartsAt, setNewStartsAt] = React.useState("");
  const [startsAt, setStartsAt] = React.useState("");

  async function refreshAfter<T extends { result: unknown }>(run: () => Promise<T>, setState: (s: T) => void) {
    setPending(true);
    try {
      const result = await run();
      setState(result);
      if (result.result) await router.invalidate({ sync: true });
    } finally {
      setPending(false);
    }
  }

  const error = scheduleState.error ?? rescheduleState.error ?? outcomeState.error;

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium">Hearing</span>
        {open ? <Badge tone="info">Scheduled {fmtDate(open.scheduledAt)}</Badge> : null}
      </div>

      {open ? (
        <div className="flex flex-wrap items-center gap-2">
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void refreshAfter(
                () => rescheduleHearingFn({ data: { hearingId: open.id, caseId, newStartsAt } }),
                setRescheduleState,
              );
            }}
          >
            <Label htmlFor="hearing-reschedule-date" className="sr-only">New hearing date</Label>
            <Input
              id="hearing-reschedule-date"
              name="newStartsAt"
              type="datetime-local"
              className="h-8 w-auto"
              required
              value={newStartsAt}
              onChange={(e) => setNewStartsAt(e.target.value)}
            />
            <Button size="sm" type="submit" variant="outline" disabled={pending}>
              Reschedule
            </Button>
          </form>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void refreshAfter(
                () =>
                  recordHearingOutcomeFn({
                    data: { hearingId: open.id, caseId, status: "completed", recovered: true },
                  }),
                setOutcomeState,
              );
            }}
          >
            <Button size="sm" type="submit" disabled={pending}>Order in favour</Button>
          </form>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void refreshAfter(
                () =>
                  recordHearingOutcomeFn({
                    data: { hearingId: open.id, caseId, status: "completed", recovered: false },
                  }),
                setOutcomeState,
              );
            }}
          >
            <Button size="sm" type="submit" variant="outline" disabled={pending}>Order against</Button>
          </form>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void refreshAfter(
                () =>
                  recordHearingOutcomeFn({
                    data: { hearingId: open.id, caseId, status: "cancelled", recovered: false },
                  }),
                setOutcomeState,
              );
            }}
          >
            <Button size="sm" type="submit" variant="outline" disabled={pending}>Cancel hearing</Button>
          </form>
        </div>
      ) : (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void refreshAfter(() => scheduleHearingFn({ data: { caseId, startsAt } }), setScheduleState);
          }}
        >
          <Label htmlFor="hearing-date" className="sr-only">Hearing date</Label>
          <Input
            id="hearing-date"
            name="startsAt"
            type="datetime-local"
            className="h-8 w-auto"
            required
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
          />
          <Button size="sm" type="submit" disabled={pending}>
            <CalendarPlus className="h-3.5 w-3.5" />
            Schedule hearing
          </Button>
        </form>
      )}

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
