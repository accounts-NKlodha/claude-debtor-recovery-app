/**
 * TanStack Start adapter for
 * src/components/screens/debtor-contact-panel.tsx -- identical UX/copy/
 * eligibility logic; the React 19 useActionState/<form action> pattern is
 * replaced with local state calling updateDebtorContactFn directly, same
 * conversion as every other Batch 2 form adapter.
 */
"use client";

import * as React from "react";
import { CircleAlert, CircleCheck, Mail, Phone, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateDebtorContactFn, type UpdateDebtorContactState } from "@/lib/debtor.functions";

const UPDATE_DEBTOR_CONTACT_IDLE: UpdateDebtorContactState = { debtor: null, error: null };

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
  const [state, setState] = React.useState<UpdateDebtorContactState>(UPDATE_DEBTOR_CONTACT_IDLE);
  const [pending, setPending] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [emailInput, setEmailInput] = React.useState(email ?? "");
  const [mobileInput, setMobileInput] = React.useState(mobile ?? "");

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

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    try {
      const result = await updateDebtorContactFn({
        data: { debtorId, caseId, email: emailInput, mobile: mobileInput },
      });
      setState(result);
    } catch {
      setState({ debtor: null, error: "Failed to update contact details" });
    } finally {
      setPending(false);
    }
  }

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
        <form onSubmit={handleSubmit} className="flex flex-col gap-2 border-t border-border pt-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="debtor-email" className="text-xs">
              Email
            </Label>
            <Input
              id="debtor-email"
              name="email"
              type="email"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              placeholder="debtor@example.com"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="debtor-mobile" className="text-xs">
              Mobile
            </Label>
            <Input
              id="debtor-mobile"
              name="mobile"
              value={mobileInput}
              onChange={(e) => setMobileInput(e.target.value)}
              placeholder="+91 98765 43210"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save contact details"}
            </Button>
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
