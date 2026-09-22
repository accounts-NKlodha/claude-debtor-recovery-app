/**
 * TanStack Start adapter for
 * src/components/screens/organisation-payment-details.tsx -- identical
 * UX/validation/audit behavior; the React 19 useActionState/<form action>
 * pattern (which relies on Next Server Actions) is replaced with local
 * state calling updateOrganisationPaymentDetailsFn directly, same as
 * sign-in.tsx's SignInForm. Only exists on the TanStack port branch.
 */
"use client";

import * as React from "react";
import { CircleAlert, CircleCheck } from "lucide-react";
import {
  updateOrganisationPaymentDetailsFn,
  type UpdateOrganisationPaymentDetailsState,
} from "@/lib/organisations.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const IDLE: UpdateOrganisationPaymentDetailsState = { result: null, error: null };

/**
 * Admin-only editor for a client's UPI ID + payee name (the V2 WhatsApp
 * reminder prints both). Rendered only for admins by the Clients page; the
 * server function independently enforces admin authorization. Leave both
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
  const [state, setState] = React.useState<UpdateOrganisationPaymentDetailsState>(IDLE);
  const [pending, setPending] = React.useState(false);
  const [id, setId] = React.useState(upiId ?? "");
  const [payee, setPayee] = React.useState(upiPayeeName ?? "");
  const [reason, setReason] = React.useState("");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    try {
      const result = await updateOrganisationPaymentDetailsFn({
        data: { organisationId, upiId: id, upiPayeeName: payee, reason },
      });
      setState(result);
      if (result.result) setReason("");
    } catch {
      setState({ result: null, error: "Failed to save payment details" });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 pt-2">
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
        <Button size="sm" type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save payment details"}
        </Button>
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
