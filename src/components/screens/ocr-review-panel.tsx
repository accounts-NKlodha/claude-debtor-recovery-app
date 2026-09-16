"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { ScanText, CircleAlert } from "lucide-react";
import type { Invoice } from "@/contract/types";
import { formatInr } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { correctInvoiceOcrAction, type CorrectInvoiceOcrState } from "@/app/actions/ocr";

const CORRECT_OCR_IDLE: CorrectInvoiceOcrState = { result: null, error: null };

function ConfirmButton() {
  const { pending } = useFormStatus();
  return (
    <Button size="sm" type="submit" disabled={pending}>
      {pending ? "Confirming…" : "Confirm corrected fields"}
    </Button>
  );
}

export function OcrReviewPanel({ caseId, invoice }: { caseId: string; invoice: Invoice }) {
  const router = useRouter();
  const [state, formAction] = useActionState<CorrectInvoiceOcrState, FormData>(
    correctInvoiceOcrAction,
    CORRECT_OCR_IDLE,
  );
  const lastResultRef = React.useRef<CorrectInvoiceOcrState["result"]>(null);

  React.useEffect(() => {
    if (state.result && state.result !== lastResultRef.current) {
      lastResultRef.current = state.result;
      router.refresh();
    }
  }, [state.result, router]);

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
        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="caseId" value={caseId} />
          <input type="hidden" name="invoiceId" value={invoice.id} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="ocr-invnum">Invoice number</Label>
              <Input id="ocr-invnum" name="invoiceNumber" defaultValue={invoice.invoiceNumber} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="ocr-taxable">Taxable value (₹)</Label>
              <Input
                id="ocr-taxable"
                name="taxableValue"
                inputMode="decimal"
                defaultValue={formatInr(invoice.taxableValue, { withSymbol: false })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="ocr-tax">Tax amount (₹)</Label>
              <Input
                id="ocr-tax"
                name="taxAmount"
                inputMode="decimal"
                defaultValue={formatInr(invoice.taxAmount, { withSymbol: false })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="ocr-total">Invoice total (₹)</Label>
              <Input
                id="ocr-total"
                name="invoiceTotal"
                inputMode="decimal"
                defaultValue={formatInr(invoice.invoiceTotal, { withSymbol: false })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="ocr-outstanding">Outstanding balance (₹)</Label>
              <Input
                id="ocr-outstanding"
                name="outstandingBalance"
                inputMode="decimal"
                defaultValue={formatInr(invoice.outstandingBalance, { withSymbol: false })}
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <ConfirmButton />
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
