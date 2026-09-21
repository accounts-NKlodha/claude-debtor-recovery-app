"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { ShieldCheck, CircleCheck, CircleDashed } from "lucide-react";
import type { ActivationGates } from "@/domain/activation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { recordActivationGateAction, type RecordActivationGateState } from "@/app/actions/activation";

const IDLE: RecordActivationGateState = { result: null, error: null };

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button size="sm" type="submit" disabled={pending}>
      {pending ? "Recording…" : "Record"}
    </Button>
  );
}

function GateForm({ caseId, gate, label }: { caseId: string; gate: "client_certification" | "staff_validation"; label: string }) {
  const router = useRouter();
  const [state, action] = useActionState<RecordActivationGateState, FormData>(recordActivationGateAction, IDLE);
  const seen = React.useRef<RecordActivationGateState["result"]>(null);
  React.useEffect(() => {
    if (state.result && state.result !== seen.current) {
      seen.current = state.result;
      router.refresh();
    }
  }, [state.result, router]);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="caseId" value={caseId} />
      <input type="hidden" name="gate" value={gate} />
      <Label htmlFor={`${gate}-reason`}>{label}</Label>
      <Input id={`${gate}-reason`} name="reason" required placeholder="Who confirmed, and how (written to the audit log)" />
      <div className="flex items-center gap-3">
        <Submit />
        {state.error ? (
          <span role="alert" className="text-xs text-danger">
            {state.error}
          </span>
        ) : null}
      </div>
    </form>
  );
}

/** Activation gates of a case that has not been activated yet. */
export function ActivationGatesPanel({ caseId, status, gates }: { caseId: string; status: string; gates: ActivationGates }) {
  const rows: { key: string; label: string; ok: boolean; detail: string }[] = [
    { key: "cert", label: "Client certification", ok: gates.clientCertified, detail: gates.clientCertified ? "Recorded" : "Not yet recorded" },
    {
      key: "staff",
      label: "Staff validation",
      ok: gates.staffValidated,
      detail: gates.staffValidated ? "Recorded" : status === "correction_required" ? "Confirm the corrected invoice fields below" : "Not yet recorded",
    },
    { key: "age", label: "60-day age gate", ok: gates.ageGatePassed, detail: gates.ageDetail },
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" /> Activation gates
        </CardTitle>
        <CardDescription>A case is activated only when client certification, staff validation and the 60-day age gate all hold.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-0">
        <ul className="flex flex-col gap-1.5 text-sm">
          {rows.map((r) => (
            <li key={r.key} className="flex items-start gap-2">
              {r.ok ? (
                <CircleCheck className="mt-0.5 h-4 w-4 text-success" aria-label="satisfied" />
              ) : (
                <CircleDashed className="mt-0.5 h-4 w-4 text-muted-foreground" aria-label="open" />
              )}
              <span>
                <span className="font-medium">{r.label}</span> — <span className="text-muted-foreground">{r.detail}</span>
              </span>
            </li>
          ))}
        </ul>
        {!gates.clientCertified ? <GateForm caseId={caseId} gate="client_certification" label="Record client certification" /> : null}
        {status === "under_validation" && !gates.staffValidated ? (
          <GateForm caseId={caseId} gate="staff_validation" label="Record staff validation" />
        ) : null}
      </CardContent>
    </Card>
  );
}
