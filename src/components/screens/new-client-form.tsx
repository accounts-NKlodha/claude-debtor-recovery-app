"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm, type FieldValues } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CircleCheck, CircleAlert, TriangleAlert } from "lucide-react";
import { createOrganisationSchema, type CreateOrganisationInput } from "@/contract/schemas";
import { createOrganisationAction } from "@/app/actions/organisations";
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

interface DuplicateWarning {
  clientCode: string;
  legalEntityName: string;
}

export function NewClientForm() {
  const router = useRouter();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FieldValues>({ resolver: zodResolver(createOrganisationSchema) as never });
  const [submitting, setSubmitting] = React.useState(false);
  const [created, setCreated] = React.useState<{ id: string; legalEntityName: string } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // A name collision doesn't fail the form -- it pauses it for staff review.
  // `pendingValues` holds the submission so it can be resubmitted with
  // confirmDuplicateName + a reason once staff explicitly override it.
  const [duplicateWarning, setDuplicateWarning] = React.useState<DuplicateWarning | null>(null);
  const [pendingValues, setPendingValues] = React.useState<FieldValues | null>(null);
  const [overrideReason, setOverrideReason] = React.useState("");

  const err = (k: string) => (errors[k]?.message as string | undefined) ?? undefined;

  const submit = (data: FieldValues) => {
    setSubmitting(true);
    setError(null);
    setCreated(null);
    createOrganisationAction(data as unknown as CreateOrganisationInput)
      .then((res) => {
        if (res.status === "duplicate_name_warning") {
          setDuplicateWarning({
            clientCode: res.existingOrganisation.clientCode,
            legalEntityName: res.existingOrganisation.legalEntityName,
          });
          setPendingValues(data);
          return;
        }
        setCreated({ id: res.organisation.id, legalEntityName: res.organisation.legalEntityName });
        setDuplicateWarning(null);
        setPendingValues(null);
        setOverrideReason("");
        reset();
        router.refresh();
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to add the client"))
      .finally(() => setSubmitting(false));
  };

  const confirmDuplicate = () => {
    if (!pendingValues || !overrideReason.trim()) return;
    submit({ ...pendingValues, confirmDuplicateName: true, duplicateOverrideReason: overrideReason });
  };

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>Client details</CardTitle>
        <CardDescription>
          Creates the client organisation record. Staff Google sign-in / client OTP still need to be
          wired before a client user can sign in to it (see the Audit page for open items).
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <form onSubmit={handleSubmit(submit)} className="flex flex-col gap-4">
          <Field id="nc-code" label="Client code" error={err("clientCode")}>
            <Input id="nc-code" placeholder="NKL-EXAMPLE" {...register("clientCode")} />
          </Field>
          <Field id="nc-name" label="Legal entity name" error={err("legalEntityName")}>
            <Input id="nc-name" {...register("legalEntityName")} />
          </Field>
          <Field id="nc-gstin" label="Creditor GSTIN (optional)" error={err("creditorGstin")}>
            <Input id="nc-gstin" className="font-mono" {...register("creditorGstin")} />
          </Field>
          <Field id="nc-udyam" label="Udyam registration number (optional)" error={err("udyamNumber")}>
            <Input id="nc-udyam" {...register("udyamNumber")} />
          </Field>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" className="h-4 w-4" {...register("jitoMember")} />
            Eligible early JITO member (5% success fee instead of 10%)
          </label>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={submitting || !!duplicateWarning}>
              {submitting ? "Adding…" : "Add client"}
            </Button>
            {created ? (
              <span className="inline-flex items-center gap-1 text-xs text-success">
                <CircleCheck className="h-3.5 w-3.5" /> {created.legalEntityName} added ({created.id})
              </span>
            ) : null}
            {error ? (
              <span className="inline-flex items-center gap-1 text-xs text-danger" role="alert">
                <CircleAlert className="h-3.5 w-3.5" /> {error}
              </span>
            ) : null}
          </div>
        </form>

        {duplicateWarning ? (
          <div className="mt-4 flex flex-col gap-3 rounded-md border border-warning/40 bg-warning-bg p-3">
            <p className="flex items-start gap-1.5 text-xs text-warning">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              A client named &quot;{duplicateWarning.legalEntityName}&quot; already exists (
              {duplicateWarning.clientCode}). If this is genuinely a different legal entity, explain
              why below to add it anyway; otherwise use the existing client record instead.
            </p>
            <Field id="nc-override-reason" label="Reason this is a different entity">
              <Textarea
                id="nc-override-reason"
                rows={2}
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder="e.g. separate branch/GSTIN of the same trade name"
              />
            </Field>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={submitting || !overrideReason.trim()}
                onClick={confirmDuplicate}
              >
                {submitting ? "Adding…" : "Add anyway"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setDuplicateWarning(null);
                  setPendingValues(null);
                  setOverrideReason("");
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
