/**
 * TanStack Start adapter for src/components/screens/gst-screen.tsx --
 * identical UX/copy/field-limit validation/evidence-gate logic.
 * useActionState/<form action> -> local state calling gst.functions.ts
 * directly; next/navigation's router.refresh() -> TanStack Router's
 * router.invalidate({ sync: true }). The original's "prepare, then
 * auto-submit open-session via a hidden form" chaining (two distinct
 * actions/audit entries, dispatched from one click) is preserved as a
 * direct async sequence -- await prepare, then call open-session only if
 * it succeeded -- same two-call/two-audit-entry behavior without the
 * hidden-form/requestSubmit workaround that pattern needed under
 * useActionState.
 */
"use client";

import * as React from "react";
import { useRouter } from "@tanstack/react-router";
import { ShieldCheck, Lock, Camera, CircleCheck, TriangleAlert, Paperclip, CircleAlert } from "lucide-react";
import { gstComposeSchema } from "@/contract/schemas";
import {
  captureGstFilingFn,
  openGstAssistedSessionFn,
  prepareGstNotificationFn,
  type CaptureGstFilingState,
  type OpenGstAssistedSessionState,
  type PrepareGstNotificationState,
} from "@/lib/gst.functions";
import { formatInr } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

const SUBJECT_MAX = 50;
const REMARKS_MAX = 200;
const ATTACH_MAX = 4;
const RECORDS_MAX = 50;

const PREPARE_GST_IDLE: PrepareGstNotificationState = { result: null, error: null };
const OPEN_SESSION_IDLE: OpenGstAssistedSessionState = { result: null, error: null };
const CAPTURE_GST_IDLE: CaptureGstFilingState = { result: null, error: null };

export interface GstPack {
  caseId: string;
  debtorName: string;
  recipientGstin: string;
  clientName: string;
  principalOutstanding: number;
  invoiceCount: number;
}

function Counter({ n, max }: { n: number; max: number }) {
  return (
    <span className={n > max ? "text-danger" : "text-muted-foreground"}>
      {n}/{max}
    </span>
  );
}

export function GstScreen({ pack }: { pack: GstPack }) {
  const router = useRouter();
  const [subject, setSubject] = React.useState(
    `Payment not received - ${pack.debtorName}`.slice(0, SUBJECT_MAX),
  );
  const [remarks, setRemarks] = React.useState(
    "Outstanding invoices remain unpaid beyond agreed credit terms despite reminders. Requesting the taxpayer to clear dues.",
  );
  const [attachments, setAttachments] = React.useState<string[]>([
    "ledger-statement.pdf",
    "invoice-bundle.pdf",
  ]);
  const [records, setRecords] = React.useState(Math.min(pack.invoiceCount, RECORDS_MAX));
  // Purely a local UI signal -- the operator confirming "I completed CAPTCHA
  // & Send" on the real GST portal has no server correlate at all (no real
  // portal automation exists), same as before this conversion.
  const [captchaConfirmed, setCaptchaConfirmed] = React.useState(false);
  const [ref, setRef] = React.useState("");

  const [prepareState, setPrepareState] = React.useState<PrepareGstNotificationState>(PREPARE_GST_IDLE);
  const [openSessionState, setOpenSessionState] = React.useState<OpenGstAssistedSessionState>(OPEN_SESSION_IDLE);
  const [captureState, setCaptureState] = React.useState<CaptureGstFilingState>(CAPTURE_GST_IDLE);
  const [preparePending, setPreparePending] = React.useState(false);
  const [openSessionPending, setOpenSessionPending] = React.useState(false);
  const [capturePending, setCapturePending] = React.useState(false);

  const parsed = gstComposeSchema.safeParse({
    recipientGstin: pack.recipientGstin,
    subject,
    action: "payment_not_received",
    remarks,
    invoiceRecordCount: records,
    attachmentStorageKeys: attachments,
  });
  const valid = parsed.success;

  async function handleOpenSession(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPreparePending(true);
    let prepareResult: PrepareGstNotificationState;
    try {
      prepareResult = await prepareGstNotificationFn({
        data: {
          caseId: pack.caseId,
          recipientGstin: pack.recipientGstin,
          subject,
          action: "payment_not_received",
          remarks,
          invoiceRecordCount: records,
          attachmentStorageKeys: attachments,
        },
      });
    } catch {
      prepareResult = { result: null, error: "Failed to prepare the GST pack" };
    }
    setPrepareState(prepareResult);
    setPreparePending(false);
    if (!prepareResult.result) return;

    // Preparing the pack and opening the assisted session are two distinct
    // actions (distinct audit trail, distinct revalidation) -- chained here
    // directly: opening only runs once preparation actually succeeded.
    setOpenSessionPending(true);
    try {
      const openResult = await openGstAssistedSessionFn({ data: { caseId: pack.caseId } });
      setOpenSessionState(openResult);
    } catch {
      setOpenSessionState({ result: null, error: "Failed to open the assisted session" });
    } finally {
      setOpenSessionPending(false);
    }
  }

  async function handleCapture(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCapturePending(true);
    try {
      const result = await captureGstFilingFn({ data: { caseId: pack.caseId, staffReference: ref } });
      setCaptureState(result);
      if (result.result?.referenceNumber) {
        await router.invalidate({ sync: true });
      }
    } catch {
      setCaptureState({ result: null, error: "Failed to capture the filing" });
    } finally {
      setCapturePending(false);
    }
  }

  const sessionUrl = openSessionState.result?.sessionUrl ?? null;
  const filingSucceeded = !!captureState.result?.referenceNumber;
  // Distinguishes a genuine thrown/authorization failure (state.error) from
  // the legitimate "submitted, but the portal didn't return a reference"
  // business outcome (result present with a null referenceNumber).
  const captureBusinessFailure = captureState.result && !captureState.result.referenceNumber;
  const error =
    prepareState.error ??
    openSessionState.error ??
    captureState.error ??
    (captureBusinessFailure
      ? "Filing capture did not return a reference -- check Audit / Security for the failure reason."
      : null);

  const session: "idle" | "opening" | "open" | "sent" | "filing" = capturePending
    ? "filing"
    : captchaConfirmed && !captureBusinessFailure
      ? "sent"
      : sessionUrl
        ? "open"
        : preparePending || openSessionPending
          ? "opening"
          : "idle";

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Communication draft</CardTitle>
            <CardDescription>
              GST portal field limits are enforced here before the assisted session opens.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 pt-0">
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <Label htmlFor="gst-subject">Subject</Label>
                <Counter n={subject.length} max={SUBJECT_MAX} />
              </div>
              <Input
                id="gst-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                aria-invalid={subject.length > SUBJECT_MAX}
              />
            </div>

            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <Label htmlFor="gst-remarks">Remarks</Label>
                <Counter n={remarks.length} max={REMARKS_MAX} />
              </div>
              <Textarea
                id="gst-remarks"
                rows={4}
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                aria-invalid={remarks.length > REMARKS_MAX}
              />
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label>Attachments</Label>
                <Counter n={attachments.length} max={ATTACH_MAX} />
              </div>
              <ul className="flex flex-col gap-1">
                {attachments.map((a) => (
                  <li
                    key={a}
                    className="flex items-center justify-between rounded-md border border-border px-2.5 py-1.5 text-xs"
                  >
                    <span className="flex items-center gap-1.5">
                      <Paperclip className="h-3.5 w-3.5" />
                      {a}
                    </span>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-danger"
                      onClick={() => setAttachments((p) => p.filter((x) => x !== a))}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
              <Button
                variant="outline"
                size="sm"
                disabled={attachments.length >= ATTACH_MAX}
                onClick={() => setAttachments((p) => [...p, `document-${p.length + 1}.pdf`])}
              >
                Add attachment
              </Button>
            </div>

            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <Label htmlFor="gst-records">Invoice records</Label>
                <Counter n={records} max={RECORDS_MAX} />
              </div>
              <Input
                id="gst-records"
                type="number"
                min={1}
                max={RECORDS_MAX}
                value={records}
                onChange={(e) => setRecords(Number(e.target.value))}
              />
            </div>

            {!valid ? (
              <p className="flex items-center gap-1.5 text-xs text-danger" role="alert">
                <TriangleAlert className="h-3.5 w-3.5" />
                {parsed.error.issues[0]?.message ?? "Fix field limits before continuing"}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="h-4 w-4" /> Assisted portal session
            </CardTitle>
            <CardDescription>
              A vault credential may open the session. OTP and CAPTCHA are never stored or bypassed —
              a person completes the CAPTCHA and presses Send on the GST portal.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 pt-0">
            <form onSubmit={handleOpenSession} className="flex flex-wrap items-center gap-2">
              <Button type="submit" disabled={!valid || session !== "idle"}>
                {session === "opening" ? "Preparing…" : "Open assisted portal session"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={session !== "open"}
                onClick={() => setCaptchaConfirmed(true)}
              >
                I have completed CAPTCHA &amp; Send
              </Button>
              <Badge
                tone={
                  session === "sent" || session === "filing"
                    ? "success"
                    : session === "open" || session === "opening"
                      ? "warning"
                      : "neutral"
                }
                icon={session === "sent" || session === "filing" ? <CircleCheck /> : undefined}
              >
                {session === "idle"
                  ? "Not started"
                  : session === "opening"
                    ? "Preparing pack…"
                    : session === "open"
                      ? "Session open — human action required"
                      : "Submitted by staff"}
              </Badge>
            </form>

            {sessionUrl ? (
              <p className="text-xs text-muted-foreground">
                Session: <span className="font-mono">{sessionUrl}</span>
              </p>
            ) : null}

            {error ? (
              <p className="flex items-center gap-1.5 text-xs text-danger" role="alert">
                <CircleAlert className="h-3.5 w-3.5" /> {error}
              </p>
            ) : null}

            {session === "sent" || session === "filing" ? (
              <form onSubmit={handleCapture} className="flex flex-col gap-2">
                <Label htmlFor="gst-ref">Portal reference number</Label>
                <Input
                  id="gst-ref"
                  name="staffReference"
                  placeholder="e.g. AD0809260001234"
                  value={ref}
                  onChange={(e) => setRef(e.target.value)}
                  disabled={session === "filing"}
                />
                <div className="flex items-center gap-2 rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
                  <Camera className="h-4 w-4" />
                  Confirmation screenshot captured from the session and registered as evidence.
                </div>
                <Button type="submit" disabled={!ref || session === "filing" || filingSucceeded}>
                  {session === "filing" ? "Recording…" : "Record filing & start 7-day timer"}
                </Button>
              </form>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <aside className="flex flex-col gap-4 lg:sticky lg:top-20 lg:self-start">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" /> Evidence gate
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 pt-0 text-sm">
            {[
              { label: "Manifest", value: valid ? "Locked" : "Pending field fixes" },
              {
                label: "Attachments",
                value: `${attachments.length} verified`,
              },
              {
                label: "Assisted session",
                value: session === "idle" ? "Not opened" : session === "opening" ? "Preparing…" : "Opened",
              },
              {
                label: "Reference / screenshot",
                value: session === "sent" || session === "filing" ? (ref || "Awaiting entry") : "Pending",
              },
              { label: "7-day timer", value: session === "filing" ? "Starting…" : "Not started" },
            ].map((row) => (
              <div key={row.label} className="flex items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">{row.label}</span>
                <span className="text-xs font-semibold">{row.value}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" /> Pack summary
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 pt-0 text-sm">
            <div>
              <p className="text-[11px] uppercase text-muted-foreground">Client</p>
              <p>{pack.clientName}</p>
            </div>
            <Separator />
            <div>
              <p className="text-[11px] uppercase text-muted-foreground">Debtor</p>
              <p>{pack.debtorName}</p>
              <p className="font-mono text-xs text-muted-foreground">{pack.recipientGstin}</p>
            </div>
            <Separator />
            <div>
              <p className="text-[11px] uppercase text-muted-foreground">Principal outstanding</p>
              <p className="tabular-nums font-semibold">{formatInr(pack.principalOutstanding)}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase text-muted-foreground">Invoice records</p>
              <p className="tabular-nums">{pack.invoiceCount}</p>
            </div>
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}
