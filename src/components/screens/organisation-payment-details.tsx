"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { CircleAlert, CircleCheck } from "lucide-react";
import {
  updateOrganisationPaymentDetailsAction,
  type UpdateOrganisationPaymentDetailsState,
} from "@/app/actions/organisations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const IDLE: UpdateOrganisationPaymentDetailsState = { result: null, error: null };

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button size="sm" type="submit" disabled={pending}>
      {pending ? "Saving…" : "Save payment details"}
    </Button>
  );
}

/**
 * Admin-only editor for a client's UPI ID + payee name (the V2 WhatsApp
 * reminder prints both). Rendered only for admins by the Clients page; the
 * server action independently enforces admin authorization. Leave both
 * fields blank to clear the details -- a client without them cannot be sent
 * a WhatsApp reminder.
 */
export function OrganisationPaymentDetailsForm({
  organisationId,
  upiId,
  upiPayeeName,
}: {
  organisationId: string;
  upiId: string | null;
  upiPayeeName: string | null;
}) {
  const [state, formAction] = useActionState<UpdateOrganisationPaymentDetailsState, FormData>(
    updateOrganisationPaymentDetailsAction,
    IDLE,
  );
  // Controlled (not uncontrolled): React 19 resets uncontrolled form fields
  // after every dispatch, which would wipe the admin's input on a
  // validation error (same lesson as new-client-form.tsx).
  const [id, setId] = React.useState(upiId ?? "");
  const [payee, setPayee] = React.useState(upiPayeeName ?? "");
  const [reason, setReason] = React.useState("");
  const savedRef = React.useRef<UpdateOrganisationPaymentDetailsState | null>(null);

  React.useEffect(() => {
    if (state.result && state !== savedRef.current) {
      savedRef.current = state;
      setReason("");
    }
  }, [state]);

  return (
    <form action={formAction} className="flex flex-col gap-3 pt-2">
      <input type="hidden" name="organisationId" value={organisationId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`upi-id-${organisationId}`}>UPI ID</Label>
          <Input
            id={`upi-id-${organisationId}`}
            name="upiId"
            className="font-mono"
            placeholder="name@bank"
            autoComplete="off"
            value={id}
            onChange={(e) => setId(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`upi-payee-${organisationId}`}>UPI payee name</Label>
          <Input
            id={`upi-payee-${organisationId}`}
            name="upiPayeeName"
            autoComplete="off"
            value={payee}
            onChange={(e) => setPayee(e.target.value)}
          />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`upi-reason-${organisationId}`}>Reason for this change (audited)</Label>
        <Input
          id={`upi-reason-${organisationId}`}
          name="reason"
          placeholder="e.g. Confirmed with the client by phone"
          autoComplete="off"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SaveButton />
        {state.result ? (
          <span className="inline-flex items-center gap-1 text-xs text-success" role="status">
            <CircleCheck className="h-3.5 w-3.5" />
            {state.result.upiId ? "Payment details saved." : "Payment details cleared."}
          </span>
        ) : null}
        {state.error ? (
          <span className="inline-flex items-center gap-1 text-xs text-danger" role="alert">
            <CircleAlert className="h-3.5 w-3.5" /> {state.error}
          </span>
        ) : null}
      </div>
    </form>
  );
}
