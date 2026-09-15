"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { CircleAlert, CircleCheck, Mail, Phone, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateDebtorContactAction, type UpdateDebtorContactState } from "@/app/actions/debtor";

const UPDATE_DEBTOR_CONTACT_IDLE: UpdateDebtorContactState = { debtor: null, error: null };

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button size="sm" type="submit" disabled={pending}>
      {pending ? "Saving…" : "Save contact details"}
    </Button>
  );
}

/**
 * Case-detail's debtor contact display + edit action (core-workflow
 * remediation task). Distinguishes the three reminder-eligibility states
 * the task's UX spec requires: email available (Gmail-eligible), email
 * missing but mobile available (explicitly NOT reminder-eligible in
 * production -- WhatsApp is disabled there, mock WhatsApp must never
 * rescue this state), and both missing.
 */
export function DebtorContactPanel({
  debtorId,
  caseId,
  email,
  mobile,
}: {
  debtorId: string;
  caseId: string;
  email: string | null;
  mobile: string | null;
}) {
  const [state, formAction] = useActionState<UpdateDebtorContactState, FormData>(
    updateDebtorContactAction,
    UPDATE_DEBTOR_CONTACT_IDLE,
  );
  // Local UI toggle only -- a successful save does not auto-close this
  // (avoids a setState-in-effect for a purely-internal adjustment, which
  // this project's stricter React Compiler-oriented lint rules flag);
  // instead the form shows a clear "Saved" confirmation and the operator
  // dismisses it themselves via "Done".
  const [editing, setEditing] = React.useState(false);

  const currentEmail = state.debtor ? state.debtor.email : email;
  const currentMobile = state.debtor ? state.debtor.mobile : mobile;

  const eligibility = currentEmail
    ? { tone: "success" as const, message: "Email on file — reminder can be sent through Gmail." }
    : currentMobile
      ? {
          tone: "warning" as const,
          message: "Email required for automated reminder. WhatsApp is not enabled in production.",
        }
      : { tone: "warning" as const, message: "Debtor contact details required before reminder can be sent." };

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-1 text-xs">
          <span className="flex items-center gap-1.5">
            <Mail className="h-3.5 w-3.5 text-muted-foreground" />
            {currentEmail ?? <span className="text-muted-foreground">No email on file</span>}
          </span>
          <span className="flex items-center gap-1.5">
            <Phone className="h-3.5 w-3.5 text-muted-foreground" />
            {currentMobile ?? <span className="text-muted-foreground">No mobile on file</span>}
          </span>
        </div>
        {!editing ? (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            <Pencil className="h-3.5 w-3.5" />
            Edit contact details
          </Button>
        ) : null}
      </div>

      <p
        className={
          eligibility.tone === "success"
            ? "flex items-start gap-1.5 text-xs text-success"
            : "flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning-bg px-2 py-1.5 text-xs text-warning"
        }
      >
        <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {eligibility.message}
      </p>

      {editing ? (
        <form action={formAction} className="flex flex-col gap-2 border-t border-border pt-2">
          <input type="hidden" name="debtorId" value={debtorId} />
          <input type="hidden" name="caseId" value={caseId} />
          <div className="flex flex-col gap-1">
            <Label htmlFor="debtor-email" className="text-xs">
              Email
            </Label>
            <Input id="debtor-email" name="email" type="email" defaultValue={currentEmail ?? ""} placeholder="debtor@example.com" />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="debtor-mobile" className="text-xs">
              Mobile
            </Label>
            <Input id="debtor-mobile" name="mobile" defaultValue={currentMobile ?? ""} placeholder="+91 98765 43210" />
          </div>
          <div className="flex items-center gap-2">
            <SaveButton />
            <Button size="sm" variant="outline" type="button" onClick={() => setEditing(false)}>
              {state.debtor ? "Done" : "Cancel"}
            </Button>
          </div>
          {state.error ? (
            <span className="flex items-center gap-1.5 text-xs text-danger" role="alert">
              <CircleAlert className="h-3.5 w-3.5" /> {state.error}
            </span>
          ) : null}
          {state.debtor ? (
            <span className="flex items-center gap-1.5 text-xs text-success">
              <CircleCheck className="h-3.5 w-3.5" /> Saved.
            </span>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
