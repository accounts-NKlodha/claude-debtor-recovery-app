"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
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
  type PrepareDdTaskState,
  type RecordDdSubmittedState,
  type RecordHearingOutcomeState,
  type RescheduleHearingState,
  type ScheduleHearingState,
} from "@/app/actions/hearing";
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

function SubmitButton({ children, variant }: { children: React.ReactNode; variant?: "outline" }) {
  const { pending } = useFormStatus();
  return (
    <Button size="sm" type="submit" variant={variant} disabled={pending}>
      {children}
    </Button>
  );
}

function DdPanel({ caseId, ddRecord }: { caseId: string; ddRecord: DdRecord | undefined }) {
  const router = useRouter();
  const [prepareState, prepareAction] = useActionState<PrepareDdTaskState, FormData>(
    prepareDdTaskAction,
    PREPARE_DD_IDLE,
  );
  const [submitState, submitAction] = useActionState<RecordDdSubmittedState, FormData>(
    recordDdSubmittedAction,
    RECORD_DD_SUBMITTED_IDLE,
  );
  const lastResultRef = React.useRef<unknown>(null);

  React.useEffect(() => {
    const latest = submitState.result ?? prepareState.result;
    if (latest && latest !== lastResultRef.current) {
      lastResultRef.current = latest;
      router.refresh();
    }
  }, [prepareState.result, submitState.result, router]);

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
          <form action={prepareAction} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="caseId" value={caseId} />
            <Label htmlFor="dd-amount" className="text-xs">Amount (₹)</Label>
            <Input
              id="dd-amount"
              name="amount"
              className="h-8 w-24"
              defaultValue={ddRecord?.amount ? String(ddRecord.amount / 100) : "1000"}
            />
            <Label htmlFor="dd-payee" className="text-xs">Payee</Label>
            <Input id="dd-payee" name="payee" className="h-8 w-40" defaultValue={ddRecord?.payee ?? "MSEFC"} />
            <Label htmlFor="dd-ref" className="text-xs">Reference</Label>
            <Input
              id="dd-ref"
              name="reference"
              className="h-8 w-32"
              placeholder="DD number"
              defaultValue={ddRecord?.reference ?? ""}
            />
            <SubmitButton variant="outline">{ddRecord ? "Update DD details" : "Prepare DD task"}</SubmitButton>
          </form>
          {ddRecord ? (
            <form action={submitAction}>
              <input type="hidden" name="caseId" value={caseId} />
              <SubmitButton>
                <CheckCircle2 className="h-3.5 w-3.5" />
                Mark DD submitted
              </SubmitButton>
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

  const [scheduleState, scheduleAction] = useActionState<ScheduleHearingState, FormData>(
    scheduleHearingAction,
    SCHEDULE_HEARING_IDLE,
  );
  const [rescheduleState, rescheduleAction] = useActionState<RescheduleHearingState, FormData>(
    rescheduleHearingAction,
    RESCHEDULE_HEARING_IDLE,
  );
  const [outcomeState, outcomeAction] = useActionState<RecordHearingOutcomeState, FormData>(
    recordHearingOutcomeAction,
    RECORD_OUTCOME_IDLE,
  );
  const lastResultRef = React.useRef<unknown>(null);

  React.useEffect(() => {
    const latest = scheduleState.result ?? rescheduleState.result ?? outcomeState.result;
    if (latest && latest !== lastResultRef.current) {
      lastResultRef.current = latest;
      router.refresh();
    }
  }, [scheduleState.result, rescheduleState.result, outcomeState.result, router]);

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
          <form action={rescheduleAction} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="hearingId" value={open.id} />
            <input type="hidden" name="caseId" value={caseId} />
            <Label htmlFor="hearing-reschedule-date" className="sr-only">New hearing date</Label>
            <Input id="hearing-reschedule-date" name="newStartsAt" type="datetime-local" className="h-8 w-auto" required />
            <SubmitButton variant="outline">Reschedule</SubmitButton>
          </form>
          <form action={outcomeAction}>
            <input type="hidden" name="hearingId" value={open.id} />
            <input type="hidden" name="caseId" value={caseId} />
            <input type="hidden" name="status" value="completed" />
            <input type="hidden" name="recovered" value="true" />
            <SubmitButton>Order in favour</SubmitButton>
          </form>
          <form action={outcomeAction}>
            <input type="hidden" name="hearingId" value={open.id} />
            <input type="hidden" name="caseId" value={caseId} />
            <input type="hidden" name="status" value="completed" />
            <input type="hidden" name="recovered" value="false" />
            <SubmitButton variant="outline">Order against</SubmitButton>
          </form>
          <form action={outcomeAction}>
            <input type="hidden" name="hearingId" value={open.id} />
            <input type="hidden" name="caseId" value={caseId} />
            <input type="hidden" name="status" value="cancelled" />
            <input type="hidden" name="recovered" value="false" />
            <SubmitButton variant="outline">Cancel hearing</SubmitButton>
          </form>
        </div>
      ) : (
        <form action={scheduleAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="caseId" value={caseId} />
          <Label htmlFor="hearing-date" className="sr-only">Hearing date</Label>
          <Input id="hearing-date" name="startsAt" type="datetime-local" className="h-8 w-auto" required />
          <SubmitButton>
            <CalendarPlus className="h-3.5 w-3.5" />
            Schedule hearing
          </SubmitButton>
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
