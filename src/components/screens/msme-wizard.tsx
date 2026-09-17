"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Check, Lock, Save, ChevronLeft, ChevronRight, CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  buildMsmePreviewAction,
  captureMsmeAcknowledgementAction,
  saveMsmeStageAction,
  type BuildMsmePreviewState,
  type CaptureMsmeAcknowledgementState,
  type SaveMsmeStageState,
} from "@/app/actions/msme";
import type { MsmeStage } from "@/contract/adapters";

const STAGES = [
  "Claimant",
  "Respondent",
  "Advocate",
  "Statement of Claim",
  "Documents",
  "Checklist",
  "Preview",
] as const;

const STAGE_KEYS: MsmeStage[] = [
  "claimant",
  "respondent",
  "advocate",
  "statement_of_claim",
  "documents",
  "checklist",
  "preview",
];

type Data = Record<string, string>;

export interface MsmeSeed {
  caseId: string;
  claimantName: string;
  claimantUdyam: string;
  respondentName: string;
  respondentGstin: string;
  claimAmount: string;
}

const SAVE_MSME_STAGE_IDLE: SaveMsmeStageState = { result: null, error: null };
const BUILD_MSME_PREVIEW_IDLE: BuildMsmePreviewState = { result: null, error: null };
const CAPTURE_MSME_ACK_IDLE: CaptureMsmeAcknowledgementState = { result: null, error: null };

function SaveResumeButton({ locked }: { locked: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button variant="ghost" type="submit" disabled={locked || pending}>
      <Save className="h-3.5 w-3.5" /> {pending ? "Saving…" : "Save & resume later"}
    </Button>
  );
}

function SubmitFilingButton({ locked }: { locked: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={locked || pending}>
      {locked ? "Submitted" : pending ? "Submitting…" : "Submit filing"}
    </Button>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
  required,
  invalid,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  invalid?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>
        {label}
        {required ? <span className="text-danger"> *</span> : null}
      </Label>
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={invalid} />
      {invalid ? (
        <span className="text-[11px] text-danger" role="alert">
          This field is required.
        </span>
      ) : null}
    </div>
  );
}

export function MsmeWizard({ seed }: { seed: MsmeSeed }) {
  const router = useRouter();
  const [step, setStep] = React.useState(0);
  const [showErrors, setShowErrors] = React.useState(false);
  const [data, setData] = React.useState<Data>({
    claimantName: seed.claimantName,
    claimantUdyam: seed.claimantUdyam,
    claimantAddress: "",
    respondentName: seed.respondentName,
    respondentGstin: seed.respondentGstin,
    respondentAddress: "",
    advocateName: "",
    advocateBar: "",
    claimAmount: seed.claimAmount,
    claimNarrative: "",
    documentsList: "Invoices, ledger statement, delivery proof, reminder correspondence",
  });
  const set = (k: string) => (v: string) => setData((d) => ({ ...d, [k]: v }));

  const [saveState, saveAction] = useActionState<SaveMsmeStageState, FormData>(
    saveMsmeStageAction,
    SAVE_MSME_STAGE_IDLE,
  );
  const [previewState, previewAction] = useActionState<BuildMsmePreviewState, FormData>(
    buildMsmePreviewAction,
    BUILD_MSME_PREVIEW_IDLE,
  );
  const [ackState, ackAction] = useActionState<CaptureMsmeAcknowledgementState, FormData>(
    captureMsmeAcknowledgementAction,
    CAPTURE_MSME_ACK_IDLE,
  );

  const previewFormRef = React.useRef<HTMLFormElement>(null);
  const lastAckResultRef = React.useRef<CaptureMsmeAcknowledgementState["result"]>(null);

  // Derived, not state-in-effect: `saved`/`locked` follow directly from the
  // action states useActionState already tracks, so there's nothing to
  // synchronize by hand (and no setState-in-effect for this project's
  // stricter React Compiler-oriented lint rules to flag). The one genuine
  // side effect -- refreshing the router once a filing is truly
  // acknowledged -- stays in its own effect below.
  const saved = saveState.result !== null;
  const locked = !!ackState.result?.diaryNumber;

  React.useEffect(() => {
    if (ackState.result && ackState.result !== lastAckResultRef.current) {
      lastAckResultRef.current = ackState.result;
      if (ackState.result.diaryNumber) {
        router.refresh();
      }
    }
  }, [ackState.result, router]);

  const preview = previewState.result;
  const acknowledgement =
    ackState.result?.diaryNumber
      ? { diaryNumber: ackState.result.diaryNumber, petitionPdfKey: ackState.result.petitionPdfKey }
      : null;
  // Distinguishes a genuine thrown/authorization failure (state.error) from
  // the legitimate "submitted, but the portal didn't return a diary number"
  // business outcome (result present with a null diaryNumber) -- neither is
  // a crash, but they're different situations for the operator.
  const ackBusinessFailure = ackState.result && !ackState.result.diaryNumber;
  const error =
    saveState.error ??
    previewState.error ??
    ackState.error ??
    (ackBusinessFailure
      ? "Submission did not return a diary number -- check Audit / Security for the failure reason."
      : null);

  const requiredByStep: Record<number, string[]> = {
    0: ["claimantName", "claimantUdyam", "claimantAddress"],
    1: ["respondentName", "respondentAddress"],
    2: [],
    3: ["claimAmount", "claimNarrative"],
    4: ["documentsList"],
    5: [],
    6: [],
  };
  const missing = (requiredByStep[step] ?? []).filter((k) => !data[k]?.trim());
  const canAdvance = missing.length === 0;

  const next = () => {
    if (!canAdvance) {
      setShowErrors(true);
      return;
    }
    setShowErrors(false);
    const nextStep = Math.min(step + 1, STAGES.length - 1);
    setStep(nextStep);
    if (STAGE_KEYS[nextStep] === "preview") {
      previewFormRef.current?.requestSubmit();
    }
  };
  const prev = () => {
    setShowErrors(false);
    setStep((s) => Math.max(s - 1, 0));
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Hidden, auto-submitted when the wizard advances into the Preview
       * stage -- there is no discrete user click for this one, but it must
       * still go through the same useActionState/<form action> dispatch as
       * every other action in this app rather than a direct .then/.catch
       * call, which is what crashes the client on a thrown server error in
       * production. */}
      <form ref={previewFormRef} action={previewAction} className="hidden" aria-hidden="true">
        <input type="hidden" name="caseId" value={seed.caseId} />
      </form>

      {/* Evidence gate */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Stages complete", value: `${Math.min(step, STAGES.length - 1)}/${STAGES.length - 1}` },
          { label: "Preview snapshot", value: preview ? "Generated" : "Pending" },
          { label: "Acknowledgement", value: acknowledgement ? "Diary ID captured" : "Pending" },
          { label: "Filing state", value: locked ? "Submitted (locked)" : "Draft" },
        ].map((tile) => (
          <div key={tile.label} className="rounded-lg border border-border bg-card p-3">
            <p className="text-sm font-semibold">{tile.value}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{tile.label}</p>
          </div>
        ))}
      </div>

      {/* Stepper */}
      <ol className="flex flex-wrap gap-2" aria-label="MSME ODR stages">
        {STAGES.map((s, i) => {
          const state = i < step ? "done" : i === step ? "current" : "todo";
          return (
            <li key={s} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => !locked && i <= step && setStep(i)}
                aria-current={state === "current" ? "step" : undefined}
                className={cn(
                  "flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium",
                  state === "current" && "border-primary bg-accent text-accent-foreground",
                  state === "done" && "border-transparent bg-success-bg text-success",
                  state === "todo" && "border-border text-muted-foreground",
                )}
              >
                <span className="tabular-nums">
                  {state === "done" ? <Check className="h-3 w-3" /> : i + 1}
                </span>
                {s}
              </button>
              {i < STAGES.length - 1 ? (
                <ChevronRight className="h-3 w-3 text-muted-foreground" />
              ) : null}
            </li>
          );
        })}
      </ol>

      <Card>
        <CardHeader>
          <CardTitle>{STAGES[step]}</CardTitle>
          <CardDescription>
            {locked
              ? "This filing is submitted. The preview snapshot below is immutable."
              : "Each stage supports save and resume. Nothing is filed until you submit at Preview."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 pt-0">
          {step === 0 && (
            <>
              <TextField id="cl-name" label="Claimant / seller legal name" value={data.claimantName} onChange={set("claimantName")} required invalid={showErrors && !data.claimantName} />
              <TextField id="cl-udyam" label="Udyam registration number" value={data.claimantUdyam} onChange={set("claimantUdyam")} required invalid={showErrors && !data.claimantUdyam} />
              <TextField id="cl-addr" label="Registered address" value={data.claimantAddress} onChange={set("claimantAddress")} required invalid={showErrors && !data.claimantAddress} />
            </>
          )}
          {step === 1 && (
            <>
              <TextField id="rs-name" label="Respondent / buyer legal name" value={data.respondentName} onChange={set("respondentName")} required invalid={showErrors && !data.respondentName} />
              <TextField id="rs-gstin" label="Respondent GSTIN" value={data.respondentGstin} onChange={set("respondentGstin")} />
              <TextField id="rs-addr" label="Respondent address" value={data.respondentAddress} onChange={set("respondentAddress")} required invalid={showErrors && !data.respondentAddress} />
            </>
          )}
          {step === 2 && (
            <>
              <p className="text-xs text-muted-foreground">Advocate details are optional.</p>
              <TextField id="ad-name" label="Advocate name" value={data.advocateName} onChange={set("advocateName")} />
              <TextField id="ad-bar" label="Bar council enrolment no." value={data.advocateBar} onChange={set("advocateBar")} />
            </>
          )}
          {step === 3 && (
            <>
              <TextField id="sc-amt" label="Claim amount (₹)" value={data.claimAmount} onChange={set("claimAmount")} required invalid={showErrors && !data.claimAmount} />
              <div className="flex flex-col gap-1">
                <Label htmlFor="sc-narr">
                  Statement of claim <span className="text-danger">*</span>
                </Label>
                <Textarea
                  id="sc-narr"
                  rows={6}
                  value={data.claimNarrative}
                  onChange={(e) => set("claimNarrative")(e.target.value)}
                  aria-invalid={showErrors && !data.claimNarrative}
                />
                {showErrors && !data.claimNarrative ? (
                  <span className="text-[11px] text-danger" role="alert">
                    A statement of claim is required.
                  </span>
                ) : null}
              </div>
            </>
          )}
          {step === 4 && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="doc-list">
                Documents to attach <span className="text-danger">*</span>
              </Label>
              <Textarea
                id="doc-list"
                rows={4}
                value={data.documentsList}
                onChange={(e) => set("documentsList")(e.target.value)}
                aria-invalid={showErrors && !data.documentsList}
              />
            </div>
          )}
          {step === 5 && (
            <ul className="flex flex-col gap-2 text-sm">
              {[
                ["Claimant Udyam on file", !!data.claimantUdyam],
                ["Respondent address captured", !!data.respondentAddress],
                ["Claim amount entered", !!data.claimAmount],
                ["Statement of claim written", !!data.claimNarrative],
                ["Document list prepared", !!data.documentsList],
              ].map(([label, ok]) => (
                <li key={label as string} className="flex items-center gap-2">
                  <Badge tone={ok ? "success" : "danger"} icon={ok ? <Check /> : undefined}>
                    {ok ? "Ready" : "Missing"}
                  </Badge>
                  {label}
                </li>
              ))}
            </ul>
          )}
          {step === 6 && (
            <div
              className={cn(
                "flex flex-col gap-2 rounded-md border p-4 text-sm",
                locked ? "border-success/40 bg-success-bg/40" : "border-border",
              )}
            >
              <div className="mb-1 flex items-center gap-2">
                <Lock className="h-4 w-4" />
                <span className="font-medium">
                  {locked ? "Immutable preview snapshot" : "Preview before submit"}
                </span>
              </div>
              {Object.entries(data).map(([k, v]) => (
                <div key={k} className="grid grid-cols-[160px_1fr] gap-2">
                  <span className="text-xs text-muted-foreground">{k}</span>
                  <span className="text-xs">{v || "—"}</span>
                </div>
              ))}
              {preview ? (
                <div className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">
                  Preview snapshot: <span className="font-mono">{preview.previewPdfKey}</span>
                  <br />
                  Hash: <span className="font-mono">{preview.previewHash}</span>
                </div>
              ) : null}
              {acknowledgement ? (
                <div className="mt-2 border-t border-success/40 pt-2 text-xs">
                  <p className="font-medium text-success">Submitted and acknowledged</p>
                  <p>
                    Diary number: <span className="font-mono">{acknowledgement.diaryNumber}</span>
                  </p>
                  <p>
                    Petition PDF: <span className="font-mono">{acknowledgement.petitionPdfKey}</span>
                  </p>
                </div>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={prev} disabled={step === 0 || locked}>
          <ChevronLeft className="h-3.5 w-3.5" /> Back
        </Button>
        {step < STAGES.length - 1 ? (
          <Button onClick={next} disabled={locked}>
            Next <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        ) : (
          <form action={ackAction}>
            <input type="hidden" name="caseId" value={seed.caseId} />
            <SubmitFilingButton locked={locked} />
          </form>
        )}
        <form action={saveAction}>
          <input type="hidden" name="caseId" value={seed.caseId} />
          <input type="hidden" name="stage" value={STAGE_KEYS[step]} />
          <input type="hidden" name="payload" value={JSON.stringify(data)} />
          <SaveResumeButton locked={locked} />
        </form>
        {saved ? <span className="text-xs text-muted-foreground">Draft saved.</span> : null}
        {locked ? <Badge tone="success">Filing locked</Badge> : null}
        {error ? (
          <span className="flex items-center gap-1.5 text-xs text-danger" role="alert">
            <CircleAlert className="h-3.5 w-3.5" /> {error}
          </span>
        ) : null}
      </div>
    </div>
  );
}
