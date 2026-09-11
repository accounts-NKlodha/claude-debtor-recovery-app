"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ScanText, CircleAlert } from "lucide-react";
import type { Invoice } from "@/contract/types";
import { moneyToPaise } from "@/contract/schemas";
import { formatInr } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { correctInvoiceOcrAction } from "@/app/actions/ocr";

export function OcrReviewPanel({ caseId, invoice }: { caseId: string; invoice: Invoice }) {
  const router = useRouter();
  const [invoiceNumber, setInvoiceNumber] = React.useState(invoice.invoiceNumber);
  const [taxableValue, setTaxableValue] = React.useState(
    formatInr(invoice.taxableValue, { withSymbol: false }),
  );
  const [taxAmount, setTaxAmount] = React.useState(formatInr(invoice.taxAmount, { withSymbol: false }));
  const [invoiceTotal, setInvoiceTotal] = React.useState(
    formatInr(invoice.invoiceTotal, { withSymbol: false }),
  );
  const [outstandingBalance, setOutstandingBalance] = React.useState(
    formatInr(invoice.outstandingBalance, { withSymbol: false }),
  );
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const confirm = () => {
    const parsedTaxable = moneyToPaise.safeParse(taxableValue);
    const parsedTax = moneyToPaise.safeParse(taxAmount);
    const parsedTotal = moneyToPaise.safeParse(invoiceTotal);
    const parsedOutstanding = moneyToPaise.safeParse(outstandingBalance);
    if (!invoiceNumber.trim() || !parsedTaxable.success || !parsedTax.success || !parsedTotal.success || !parsedOutstanding.success) {
      setError("Check invoice number and amount fields before confirming.");
      return;
    }
    setSubmitting(true);
    setError(null);
    correctInvoiceOcrAction(caseId, invoice.id, {
      invoiceNumber,
      taxableValue: parsedTaxable.data,
      taxAmount: parsedTax.data,
      invoiceTotal: parsedTotal.data,
      outstandingBalance: parsedOutstanding.data,
    })
      .then(() => router.refresh())
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to save the correction"))
      .finally(() => setSubmitting(false));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ScanText className="h-4 w-4" /> OCR review
          <Badge tone="warning">
            {Math.round((invoice.extractionConfidence ?? 0) * 100)}% confidence
          </Badge>
        </CardTitle>
        <CardDescription>
          Extraction confidence is below threshold. Correct the fields below and confirm to satisfy
          staff validation.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="ocr-invnum">Invoice number</Label>
            <Input id="ocr-invnum" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="ocr-taxable">Taxable value (₹)</Label>
            <Input id="ocr-taxable" inputMode="decimal" value={taxableValue} onChange={(e) => setTaxableValue(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="ocr-tax">Tax amount (₹)</Label>
            <Input id="ocr-tax" inputMode="decimal" value={taxAmount} onChange={(e) => setTaxAmount(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="ocr-total">Invoice total (₹)</Label>
            <Input id="ocr-total" inputMode="decimal" value={invoiceTotal} onChange={(e) => setInvoiceTotal(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="ocr-outstanding">Outstanding balance (₹)</Label>
            <Input
              id="ocr-outstanding"
              inputMode="decimal"
              value={outstandingBalance}
              onChange={(e) => setOutstandingBalance(e.target.value)}
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button size="sm" onClick={confirm} disabled={submitting}>
            {submitting ? "Confirming…" : "Confirm corrected fields"}
          </Button>
          {error ? (
            <span className="flex items-center gap-1.5 text-xs text-danger" role="alert">
              <CircleAlert className="h-3.5 w-3.5" /> {error}
            </span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
