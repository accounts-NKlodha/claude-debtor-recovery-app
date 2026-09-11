"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm, type FieldValues } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CircleCheck, CircleAlert } from "lucide-react";
import { createOrganisationSchema, type CreateOrganisationInput } from "@/contract/schemas";
import { createOrganisationAction } from "@/app/actions/organisations";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

  const err = (k: string) => (errors[k]?.message as string | undefined) ?? undefined;

  const onValid = (data: FieldValues) => {
    setSubmitting(true);
    setError(null);
    setCreated(null);
    createOrganisationAction(data as unknown as CreateOrganisationInput)
      .then((res) => {
        setCreated({ id: res.organisation.id, legalEntityName: res.organisation.legalEntityName });
        reset();
        router.refresh();
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to add the client"))
      .finally(() => setSubmitting(false));
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
        <form onSubmit={handleSubmit(onValid)} className="flex flex-col gap-4">
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
            <Button type="submit" disabled={submitting}>
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
      </CardContent>
    </Card>
  );
}
