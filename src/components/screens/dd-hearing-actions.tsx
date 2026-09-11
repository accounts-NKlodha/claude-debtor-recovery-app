"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FileClock, CalendarPlus, CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { prepareDdTaskAction, scheduleHearingAction } from "@/app/actions/hearing";
import type { CaseStatus } from "@/contract/enums";

export function DdHearingActions({ caseId, status }: { caseId: string; status: CaseStatus }) {
  const router = useRouter();
  const [pending, setPending] = React.useState<"dd" | "hearing" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [hearingDate, setHearingDate] = React.useState("");

  if (status !== "msme_odr_filed" && status !== "msefc_dd") return null;

  const prepareDd = () => {
    setPending("dd");
    setError(null);
    prepareDdTaskAction(caseId)
      .then(() => router.refresh())
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to prepare DD task"))
      .finally(() => setPending(null));
  };

  const scheduleHearing = () => {
    if (!hearingDate) return;
    setPending("hearing");
    setError(null);
    scheduleHearingAction(caseId, new Date(hearingDate).toISOString())
      .then(() => router.refresh())
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to schedule hearing"))
      .finally(() => setPending(null));
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {status === "msme_odr_filed" ? (
          <Button size="sm" variant="outline" onClick={prepareDd} disabled={pending !== null}>
            <FileClock className="h-3.5 w-3.5" />
            {pending === "dd" ? "Preparing…" : "Prepare DD task"}
          </Button>
        ) : null}
        <Label htmlFor="hearing-date" className="sr-only">
          Hearing date
        </Label>
        <Input
          id="hearing-date"
          type="datetime-local"
          className="h-8 w-auto"
          value={hearingDate}
          onChange={(e) => setHearingDate(e.target.value)}
        />
        <Button
          size="sm"
          onClick={scheduleHearing}
          disabled={!hearingDate || pending !== null}
        >
          <CalendarPlus className="h-3.5 w-3.5" />
          {pending === "hearing" ? "Scheduling…" : "Schedule hearing"}
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
