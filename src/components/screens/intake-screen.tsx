"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Upload, FileSpreadsheet, CircleCheck, CircleAlert } from "lucide-react";
import { reminderComposeSchema } from "@/contract/schemas";
import type { ImportResult, Organisation } from "@/contract/types";
import { commitBulkImportAction, validateBulkImportAction } from "@/app/actions/bulk-import";
import { createCaseFromManualInvoiceAction, type CreateManualInvoiceState } from "@/app/actions/manual-invoice";
import { formatInr } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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

/* ------------------------------------------------- reminder composer ---- */

function ReminderComposer() {
  const [channels, setChannels] = React.useState<string[]>(["whatsapp"]);
  const [body, setBody] = React.useState(
    "Namaste, this is N K Lodha & Co regarding invoice {{invoice_number}} for {{amount}}, overdue since {{due_date}}. Kindly arrange payment or reply here.",
  );
  const [result, setResult] = React.useState<string | null>(null);

  const toggle = (c: string) =>
    setChannels((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = reminderComposeSchema.safeParse({
      caseId: "00000000-0000-0000-0000-000000000000",
      channels,
      templateKey: "reminder_initial_v3",
      body,
    });
    setResult(
      parsed.success
        ? "Queued for the next permitted 11:00 AM IST window (not Sunday)."
        : parsed.error.issues[0]?.message ?? "Invalid",
    );
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Label>Channels</Label>
        <div className="flex gap-2">
          {["whatsapp", "email", "postal"].map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => toggle(c)}
              aria-pressed={channels.includes(c)}
              className={
                "rounded-md border px-3 py-1.5 text-xs font-medium capitalize " +
                (channels.includes(c)
                  ? "border-transparent bg-accent text-accent-foreground"
                  : "border-border text-muted-foreground")
              }
            >
              {c}
            </button>
          ))}
        </div>
      </div>
      <Field id="reminder-body" label="Message body">
        <Textarea
          id="reminder-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={5}
        />
      </Field>
      <div className="flex items-center gap-3">
        <Button type="submit">Schedule reminder</Button>
        {result ? (
          <span className="text-xs text-muted-foreground">{result}</span>
        ) : null}
      </div>
    </form>
  );
}

/* --------------------------------------------------- manual invoice ---- */

const CREATE_MANUAL_INVOICE_IDLE: CreateManualInvoiceState = { result: null, error: null };

function CreateInvoiceButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Creating…" : "Add invoice to draft case"}
    </Button>
  );
}

function ManualInvoiceForm({ organisationId }: { organisationId: string }) {
  const [state, formAction] = useActionState<CreateManualInvoiceState, FormData>(
    createCaseFromManualInvoiceAction,
    CREATE_MANUAL_INVOICE_IDLE,
  );
  const formRef = React.useRef<HTMLFormElement>(null);
  const lastResultRef = React.useRef<CreateManualInvoiceState["result"]>(null);
  React.useEffect(() => {
    if (state.result && state.result !== lastResultRef.current) {
      lastResultRef.current = state.result;
      formRef.current?.reset();
    }
  }, [state.result]);

  return (
    <form ref={formRef} action={formAction} className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="organisationId" value={organisationId} />
      <Field id="mi-invoiceNumber" label="Invoice number">
        <Input id="mi-invoiceNumber" name="invoiceNumber" required />
      </Field>
      <Field id="mi-debtorName" label="Debtor name">
        <Input id="mi-debtorName" name="debtorName" required />
      </Field>
      <Field id="mi-debtorEmail" label="Debtor email (optional)">
        <Input id="mi-debtorEmail" name="debtorEmail" type="email" placeholder="debtor@example.com" />
      </Field>
      <Field id="mi-debtorMobile" label="Debtor mobile (optional)">
        <Input id="mi-debtorMobile" name="debtorMobile" placeholder="+91 98765 43210" />
      </Field>
      <p className="col-span-full -mt-2 text-xs text-muted-foreground">
        Email is required for an automated reminder (Gmail is the only production delivery channel;
        WhatsApp is not enabled). A case can still be created without either -- contact details can be
        added later from the case page.
      </p>
      <Field id="mi-invoiceDate" label="Invoice date (DD/MM/YYYY)">
        <Input id="mi-invoiceDate" name="invoiceDate" placeholder="14/06/2026" required />
      </Field>
      <Field id="mi-dueDate" label="Due date (optional)">
        <Input id="mi-dueDate" name="dueDate" placeholder="14/07/2026" />
      </Field>
      <Field id="mi-taxableValue" label="Taxable value (₹)">
        <Input id="mi-taxableValue" name="taxableValue" inputMode="decimal" required />
      </Field>
      <Field id="mi-taxRate" label="Tax rate (%)">
        <Input id="mi-taxRate" name="taxRate" inputMode="decimal" defaultValue="18" required />
      </Field>
      <Field id="mi-taxAmount" label="Tax amount (₹)">
        <Input id="mi-taxAmount" name="taxAmount" inputMode="decimal" required />
      </Field>
      <Field id="mi-invoiceTotal" label="Invoice total (₹)">
        <Input id="mi-invoiceTotal" name="invoiceTotal" inputMode="decimal" required />
      </Field>
      <Field id="mi-outstandingBalance" label="Outstanding balance (₹)">
        <Input id="mi-outstandingBalance" name="outstandingBalance" inputMode="decimal" required />
      </Field>
      <Field id="mi-debtorGstin" label="Debtor GSTIN (optional)">
        <Input id="mi-debtorGstin" name="debtorGstin" className="font-mono" />
      </Field>
      <div className="col-span-full flex flex-wrap items-center gap-3">
        <CreateInvoiceButton />
        {state.result ? (
          <span className="inline-flex items-center gap-1 text-xs text-success">
            <CircleCheck className="h-3.5 w-3.5" /> Draft case {state.result.caseId} created — status &quot;
            {state.result.status}&quot;, not yet activated
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

/* ------------------------------------------------------ bulk import ---- */

function BulkImport({ organisationId }: { organisationId: string }) {
  const [result, setResult] = React.useState<ImportResult | null>(null);
  const [csvText, setCsvText] = React.useState<string | null>(null);
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [dragOver, setDragOver] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const [pending, setPending] = React.useState(false);
  const [committing, setCommitting] = React.useState(false);
  const [committed, setCommitted] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    setCommitted(null);
    setError(null);
    setPending(true);
    file
      .text()
      .then((text) => {
        setCsvText(text);
        return validateBulkImportAction(text);
      })
      .then(setResult)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to validate the file"))
      .finally(() => setPending(false));
  };

  const commit = () => {
    if (!csvText) return;
    setCommitting(true);
    setError(null);
    commitBulkImportAction(organisationId, csvText)
      .then((res) => setCommitted(res.casesCreated))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to commit the import"))
      .finally(() => setCommitting(false));
  };

  return (
    <div className="flex flex-col gap-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFile(e.dataTransfer.files[0]);
        }}
        className={
          "flex flex-col items-center gap-2 rounded-lg border-2 border-dashed p-8 text-center " +
          (dragOver ? "border-primary bg-accent" : "border-border")
        }
      >
        <Upload className="h-6 w-6 text-muted-foreground" />
        <p className="text-sm font-medium">Drop the recovery import CSV here</p>
        <p className="text-xs text-muted-foreground">
          20-column template. Rows are validated; nothing activates until you commit the valid set.
        </p>
        <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
          Choose file
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
        {fileName ? (
          <p className="text-xs text-muted-foreground">
            {pending ? `Validating ${fileName}…` : `Loaded: ${fileName}`}
          </p>
        ) : null}
        {error ? (
          <p className="flex items-center gap-1.5 text-xs text-danger" role="alert">
            <CircleAlert className="h-3.5 w-3.5" /> {error}
          </p>
        ) : null}
      </div>

      {result ? (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Total rows", value: result.totalRows, tone: "neutral" as const },
              { label: "Valid", value: result.validRows, tone: "success" as const },
              { label: "Duplicates", value: result.duplicateRows, tone: "warning" as const },
              { label: "Errors", value: result.errorRows, tone: "danger" as const },
            ].map((s) => (
              <Card key={s.label}>
                <CardContent className="p-3">
                  <p className="text-[11px] text-muted-foreground">{s.label}</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums">{s.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {result.errors.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CircleAlert className="h-4 w-4 text-danger" /> Row-level errors
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Row</TableHead>
                      <TableHead>Column</TableHead>
                      <TableHead>Code</TableHead>
                      <TableHead>Message</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.errors.map((e, i) => (
                      <TableRow key={i}>
                        <TableCell className="tabular-nums">{e.rowNumber}</TableCell>
                        <TableCell className="font-mono text-xs">{e.column ?? "—"}</TableCell>
                        <TableCell>
                          <Badge tone="danger">{e.code}</Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{e.message}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Preview — valid rows to commit</CardTitle>
              <CardDescription>
                Never partially activated. Committing creates draft cases pending certification and
                staff validation.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Row</TableHead>
                    <TableHead>Debtor</TableHead>
                    <TableHead>Invoice</TableHead>
                    <TableHead>Total due</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.preview.map((p) => (
                    <TableRow key={p.rowNumber}>
                      <TableCell className="tabular-nums">{p.rowNumber}</TableCell>
                      <TableCell>{p.debtorName}</TableCell>
                      <TableCell className="font-mono text-xs">{p.invoiceNumber}</TableCell>
                      <TableCell className="tabular-nums">{formatInr(p.totalDue)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="mt-3 flex items-center gap-3">
                <Button
                  onClick={commit}
                  disabled={result.validRows === 0 || committing || committed !== null}
                >
                  {committing
                    ? "Committing…"
                    : committed !== null
                      ? "Committed"
                      : `Commit ${result.validRows} valid rows`}
                </Button>
                {committed !== null ? (
                  <span className="inline-flex items-center gap-1 text-xs text-success">
                    <CircleCheck className="h-3.5 w-3.5" /> {committed} draft case
                    {committed === 1 ? "" : "s"} created — see Cases
                  </span>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------ screen ---- */

export function IntakeScreen({ organisations }: { organisations: Organisation[] }) {
  const [organisationId, setOrganisationId] = React.useState(organisations[0]?.id ?? "");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Label htmlFor="intake-org" className="text-xs text-muted-foreground">
          Client
        </Label>
        <select
          id="intake-org"
          value={organisationId}
          onChange={(e) => setOrganisationId(e.target.value)}
          className="h-8 rounded-md border border-input bg-card px-2 text-sm"
        >
          {organisations.map((o) => (
            <option key={o.id} value={o.id}>
              {o.legalEntityName}
            </option>
          ))}
        </select>
      </div>

      <Tabs defaultValue="reminder">
        <TabsList>
          <TabsTrigger value="reminder">Reminder composer</TabsTrigger>
          <TabsTrigger value="manual">Manual invoice</TabsTrigger>
          <TabsTrigger value="bulk">
            <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5" /> Bulk CSV
          </TabsTrigger>
        </TabsList>
        <TabsContent value="reminder">
          <Card>
            <CardHeader>
              <CardTitle>Compose a reminder</CardTitle>
              <CardDescription>
                Scheduled outbound only at 11:00 AM IST, never on Sunday.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <ReminderComposer />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="manual">
          <Card>
            <CardHeader>
              <CardTitle>Manual invoice entry</CardTitle>
              <CardDescription>Validated with the shared manualInvoiceSchema.</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <ManualInvoiceForm organisationId={organisationId} />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="bulk">
          <BulkImport organisationId={organisationId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
