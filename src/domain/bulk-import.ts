/**
 * Bulk Excel/CSV import (PRD §7, data-model spec, acceptance scenario 2).
 * - Validate headers, dates and money.
 * - Row-level errors; duplicates identified, not silently dropped.
 * - Never partially activate: returns a preview + errors; the caller commits.
 */

import { BULK_IMPORT_COLUMNS, optionalEmailSchema, optionalMobileSchema } from "@/contract/schemas";
import type { ImportResult, ImportRowError } from "@/contract/types";

const REQUIRED = new Set([
  "client_code",
  "legal_entity_name",
  "debtor_name",
  "invoice_number",
  "invoice_date",
  "taxable_value",
  "tax_rate",
  "tax_amount",
  "invoice_total",
  "total_due",
]);

/** Minimal RFC-4180-ish CSV parser (handles quoted fields + embedded commas). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  const src = text.replace(/^﻿/, "");

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      field = "";
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

export function parseMoney(raw: string): number | null {
  const cleaned = raw.replace(/[₹,\s]/g, "");
  if (cleaned === "" || !/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(parseFloat(cleaned) * 100);
}

export function parseDate(raw: string): string | null {
  const s = raw.trim();
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) return s;
  if ((m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/))) {
    const dd = +m[1];
    const mm = +m[2];
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
    return `${m[3]}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  }
  return null;
}

export interface ImportOptions {
  /** existing (debtor_gstin|debtor_name)+invoice_number keys already in the system. */
  knownInvoiceKeys?: Set<string>;
}

export function validateImport(csvText: string, opts: ImportOptions = {}): ImportResult {
  const known = opts.knownInvoiceKeys ?? new Set<string>();
  const grid = parseCsv(csvText);
  const errors: ImportRowError[] = [];

  if (grid.length === 0) {
    return {
      totalRows: 0,
      validRows: 0,
      duplicateRows: 0,
      errorRows: 0,
      errors: [{ rowNumber: 0, column: null, code: "empty_file", message: "No rows found" }],
      preview: [],
    };
  }

  const header = grid[0].map((h) => h.trim().toLowerCase());
  const missingCols = BULK_IMPORT_COLUMNS.filter((c) => !header.includes(c));
  if (missingCols.length > 0) {
    return {
      totalRows: grid.length - 1,
      validRows: 0,
      duplicateRows: 0,
      errorRows: grid.length - 1,
      errors: [
        {
          rowNumber: 1,
          column: missingCols.join(","),
          code: "missing_columns",
          message: `Missing required columns: ${missingCols.join(", ")}`,
        },
      ],
      preview: [],
    };
  }

  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const seenInBatch = new Set<string>();
  const preview: ImportResult["preview"] = [];
  let validRows = 0;
  let duplicateRows = 0;
  const errorRowNumbers = new Set<number>();

  for (let r = 1; r < grid.length; r++) {
    const rowNumber = r + 1; // 1-based, header is row 1
    const cell = (col: string) => (grid[r][idx[col]] ?? "").trim();
    const rowErr = (column: string | null, code: string, message: string) => {
      errors.push({ rowNumber, column, code, message });
      errorRowNumbers.add(rowNumber);
    };

    for (const col of REQUIRED) if (cell(col) === "") rowErr(col, "required", `${col} is required`);

    const invoiceDate = cell("invoice_date") ? parseDate(cell("invoice_date")) : null;
    if (cell("invoice_date") && invoiceDate === null)
      rowErr("invoice_date", "bad_date", `Unparseable date "${cell("invoice_date")}"`);
    if (cell("due_date") && parseDate(cell("due_date")) === null)
      rowErr("due_date", "bad_date", `Unparseable date "${cell("due_date")}"`);

    const totalDue = parseMoney(cell("total_due"));
    for (const col of ["taxable_value", "tax_amount", "invoice_total", "total_due"]) {
      if (cell(col) && parseMoney(cell(col)) === null)
        rowErr(col, "bad_money", `Unparseable amount "${cell(col)}"`);
    }
    const taxRate = cell("tax_rate");
    if (taxRate && !/^\d+(\.\d+)?$/.test(taxRate))
      rowErr("tax_rate", "bad_number", `Unparseable tax rate "${taxRate}"`);

    // Both optional -- a blank cell is fine (core-workflow remediation
    // task), but a *supplied* value must be well-formed; never fabricated
    // or silently dropped if malformed.
    if (cell("debtor_email") && !optionalEmailSchema.safeParse(cell("debtor_email")).success)
      rowErr("debtor_email", "bad_email", `Invalid email "${cell("debtor_email")}"`);
    if (cell("debtor_mobile") && !optionalMobileSchema.safeParse(cell("debtor_mobile")).success)
      rowErr("debtor_mobile", "bad_mobile", `Invalid Indian mobile number "${cell("debtor_mobile")}"`);

    const dupKey = `${(cell("debtor_gstin") || cell("debtor_name")).toLowerCase()}::${cell(
      "invoice_number",
    ).toLowerCase()}`;
    const isDuplicate = known.has(dupKey) || seenInBatch.has(dupKey);
    seenInBatch.add(dupKey);

    if (errorRowNumbers.has(rowNumber)) continue;

    if (isDuplicate) {
      duplicateRows++;
      errors.push({
        rowNumber,
        column: "invoice_number",
        code: "duplicate",
        message: `Duplicate invoice ${cell("invoice_number")} for ${cell("debtor_name")}`,
      });
      continue;
    }

    validRows++;
    preview.push({
      rowNumber,
      debtorName: cell("debtor_name"),
      invoiceNumber: cell("invoice_number"),
      totalDue: totalDue ?? 0,
    });
  }

  return {
    totalRows: grid.length - 1,
    validRows,
    duplicateRows,
    errorRows: errorRowNumbers.size,
    errors,
    preview,
  };
}
