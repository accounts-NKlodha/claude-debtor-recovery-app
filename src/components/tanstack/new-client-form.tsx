/**
 * TanStack Start adapter for src/components/screens/new-client-form.tsx --
 * identical UX/validation/duplicate-name-warning flow; the React 19
 * useActionState/<form action> pattern is replaced with local state calling
 * createOrganisationFn directly (same conversion as
 * organisation-payment-details.tsx), and next/navigation's router.refresh()
 * is replaced with TanStack Router's router.invalidate({ sync: true }).
 * Only exists on the TanStack port branch.
 */
"use client";

import * as React from "react";
import { useRouter } from "@tanstack/react-router";
import { CircleCheck, CircleAlert, TriangleAlert } from "lucide-react";
import { createOrganisationFn, type CreateOrganisationState } from "@/lib/organisations.functions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <span className="text-[11px] text-danger" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

const CREATE_ORGANISATION_IDLE: CreateOrganisationState = { result: null, error: null };

export function NewClientForm() {
  const router = useRouter();
  const [state, setState] = React.useState<CreateOrganisationState>(CREATE_ORGANISATION_IDLE);
  const [pending, setPending] = React.useState(false);
  const lastCreatedIdRef = React.useRef<string | null>(null);

  const rawDuplicateWarning =
    state.result?.status === "duplicate_name_warning" ? state.result.existingOrganisation : null;
  const created = state.result?.status === "created" ? state.result.organisation : null;
  const [overrideReason, setOverrideReason] = React.useState("");
  const [dismissedForId, setDismissedForId] = React.useState<string | null>(null);
  const duplicateWarning =
    rawDuplicateWarning && rawDuplicateWarning.id !== dismissedForId ? rawDuplicateWarning : null;

  const [clientCode, setClientCode] = React.useState("");
  const [legalEntityName, setLegalEntityName] = React.useState("");
  const [creditorGstin, setCreditorGstin] = React.useState("");
  const [udyamNumber, setUdyamNumber] = React.useState("");
  const [jitoMember, setJitoMember] = React.useState(false);

  React.useEffect(() => {
    if (created && created.id !== lastCreatedIdRef.current) {
      lastCreatedIdRef.current = created.id;
      setClientCode("");
      setLegalEntityName("");
      setCreditorGstin("");
      setUdyamNumber("");
      setJitoMember(false);
      setOverrideReason("");
      setDismissedForId(null);
      void router.invalidate({ sync: true });
    }
  }, [created, router]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    try {
      const result = await createOrganisationFn({
        data: {
          clientCode,
          legalEntityName,
          creditorGstin,
          udyamNumber,
          jitoMember,
          confirmDuplicateName: Boolean(duplicateWarning),
          duplicateOverrideReason: overrideReason,
        },
      });
      setState(result);
    } catch {
      setState({ result: null, error: "Failed to add the client" });
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>Client details</CardTitle>
        <CardDescription>
          Creates the client organisation record. A client user still needs a provisioned Supabase
          Auth identity + <span className="font-mono text-xs">app_users</span>/
          <span className="font-mono text-xs">user_organisations</span> rows before they can sign in
          to it (see docs/ADMIN_BOOTSTRAP.md).
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field id="nc-code" label="Client code">
            <Input
              id="nc-code"
              name="clientCode"
              placeholder="NKL-EXAMPLE"
              required
              value={clientCode}
              onChange={(e) => setClientCode(e.target.value)}
            />
          </Field>
          <Field id="nc-name" label="Legal entity name">
            <Input
              id="nc-name"
              name="legalEntityName"
              required
              value={legalEntityName}
              onChange={(e) => setLegalEntityName(e.target.value)}
            />
          </Field>
          <Field id="nc-gstin" label="Creditor GSTIN (optional)">
            <Input
              id="nc-gstin"
              name="creditorGstin"
              className="font-mono"
              value={creditorGstin}
              onChange={(e) => setCreditorGstin(e.target.value)}
            />
          </Field>
          <Field id="nc-udyam" label="Udyam registration number (optional)">
            <Input id="nc-udyam" name="udyamNumber" value={udyamNumber} onChange={(e) => setUdyamNumber(e.target.value)} />
          </Field>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              name="jitoMember"
              className="h-4 w-4"
              checked={jitoMember}
              onChange={(e) => setJitoMember(e.target.checked)}
            />
            Eligible early JITO member (5% success fee instead of 10%)
          </label>

          {duplicateWarning ? (
            <div className="flex flex-col gap-3 rounded-md border border-warning/40 bg-warning-bg p-3">
              <p className="flex items-start gap-1.5 text-xs text-warning">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                A client named &quot;{duplicateWarning.legalEntityName}&quot; already exists (
                {duplicateWarning.clientCode}). If this is genuinely a different legal entity, explain
                why below to add it anyway; otherwise use the existing client record instead.
              </p>
              <Field id="nc-override-reason" label="Reason this is a different entity">
                <Textarea
                  id="nc-override-reason"
                  name="duplicateOverrideReason"
                  rows={2}
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  placeholder="e.g. separate branch/GSTIN of the same trade name"
                />
              </Field>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" type="submit" disabled={!overrideReason.trim() || pending}>
                  Add anyway
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  type="button"
                  onClick={() => setDismissedForId(duplicateWarning.id)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={pending || !!duplicateWarning}>
              {pending ? "Adding…" : "Add client"}
            </Button>
            {created ? (
              <span className="inline-flex items-center gap-1 text-xs text-success">
                <CircleCheck className="h-3.5 w-3.5" /> {created.legalEntityName} added ({created.id})
              </span>
            ) : null}
            {state.error ? (
              <span className="inline-flex items-center gap-1 text-xs text-danger" role="alert">
                <CircleAlert className="h-3.5 w-3.5" /> {state.error}
              </span>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
