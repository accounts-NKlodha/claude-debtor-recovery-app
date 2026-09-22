/**
 * TanStack Start adapter for src/components/screens/ocr-review-panel.tsx --
 * identical UX/copy; useActionState/<form action> -> local state +
 * correctInvoiceOcrFn, next/navigation's router.refresh() -> TanStack
 * Router's router.invalidate({ sync: true }).
 */
"use client";

import * as React from "react";
import { useRouter } from "@tanstack/react-router";
import { ScanText, CircleAlert } from "lucide-react";
import type { Invoice } from "@/contract/types";
import { formatInr } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { correctInvoiceOcrFn, type CorrectInvoiceOcrState } from "@/lib/ocr.functions";

const CORRECT_OCR_IDLE: CorrectInvoiceOcrState = { result: null, error: null };

export function OcrReviewPanel({ caseId, invoice }: { caseId: string; invoice: Invoice }) {
  const router = useRouter();
  const [state, setState] = React.useState<CorrectInvoiceOcrState>(CORRECT_OCR_IDLE);
  const [pending, setPending] = React.useState(false);
  const [invoiceNumber, setInvoiceNumber] = React.useState(invoice.invoiceNumber);
  const [taxableValue, setTaxableValue] = React.useState(formatInr(invoice.taxableValue, { withSymbol: false }));
  const [taxAmount, setTaxAmount] = React.useState(formatInr(invoice.taxAmount, { withSymbol: false }));
  const [invoiceTotal, setInvoiceTotal] = React.useState(formatInr(invoice.invoiceTotal, { withSymbol: false }));
  const [outstandingBalance, setOutstandingBalance] = React.useState(
    formatInr(invoice.outstandingBalance, { withSymbol: false }),
  );

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    try {
      const result = await correctInvoiceOcrFn({
        data: { caseId, invoiceId: invoice.id, invoiceNumber, taxableValue, taxAmount, invoiceTotal, outstandingBalance },
      });
      setState(result);
      if (result.result) await router.invalidate({ sync: true });
    } catch {
      setState({ result: null, error: "Failed to save the correction" });
    } finally {
      setPending(false);
    }
  }

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
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="ocr-invnum">Invoice number</Label>
              <Input id="ocr-invnum" name="invoiceNumber" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="ocr-taxable">Taxable value (₹)</Label>
              <Input id="ocr-taxable" name="taxableValue" inputMode="decimal" value={taxableValue} onChange={(e) => setTaxableValue(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="ocr-tax">Tax amount (₹)</Label>
              <Input id="ocr-tax" name="taxAmount" inputMode="decimal" value={taxAmount} onChange={(e) => setTaxAmount(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="ocr-total">Invoice total (₹)</Label>
              <Input id="ocr-total" name="invoiceTotal" inputMode="decimal" value={invoiceTotal} onChange={(e) => setInvoiceTotal(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="ocr-outstanding">Outstanding balance (₹)</Label>
              <Input
                id="ocr-outstanding"
                name="outstandingBalance"
                inputMode="decimal"
                value={outstandingBalance}
                onChange={(e) => setOutstandingBalance(e.target.value)}
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button size="sm" type="submit" disabled={pending}>
              {pending ? "Confirming…" : "Confirm corrected fields"}
            </Button>
            {state.error ? (
              <span className="flex items-center gap-1.5 text-xs text-danger" role="alert">
                <CircleAlert className="h-3.5 w-3.5" /> {state.error}
              </span>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
