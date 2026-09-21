import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { istBusinessDate, istDaysBetween } from "./scheduling";
import { validatePromiseDate } from "./promise";

describe("istBusinessDate: the IST calendar date of an instant (payment/promise 'today')", () => {
  it.each([
    ["2026-09-20T18:29:59Z", "2026-09-20", "23:59:59 IST"],
    ["2026-09-20T18:30:00Z", "2026-09-21", "00:00:00 IST -- date rolls over at IST midnight, not UTC midnight"],
    ["2026-09-20T20:00:00Z", "2026-09-21", "01:30 IST: the UTC date is still the 20th"],
    ["2026-09-20T23:59:59Z", "2026-09-21", "05:29:59 IST"],
    ["2026-09-21T00:00:00Z", "2026-09-21", "05:30 IST == UTC midnight"],
    ["2026-09-21T03:00:00Z", "2026-09-21", "08:30 IST"],
    ["2026-09-21T18:29:59Z", "2026-09-21", "23:59:59 IST"],
    ["2026-12-31T18:30:00Z", "2027-01-01", "year rollover"],
    ["2028-02-28T18:30:00Z", "2028-02-29", "leap day"],
    ["2026-01-31T19:00:00Z", "2026-02-01", "month rollover"],
  ])("%s -> %s (%s)", (utc, expected) => {
    expect(istBusinessDate(new Date(utc))).toBe(expected);
  });

  it("gives the same date before and after 05:30 IST on one IST day (the original defect)", () => {
    expect(istBusinessDate(new Date("2026-09-20T22:00:00Z"))).toBe(istBusinessDate(new Date("2026-09-21T04:00:00Z")));
  });

  it("istDaysBetween counts whole IST calendar days", () => {
    expect(istDaysBetween("2026-07-15", "2026-09-21")).toBe(68);
    expect(istDaysBetween("2026-09-21", "2026-09-21")).toBe(0);
    expect(istDaysBetween("2026-12-31", "2027-01-01")).toBe(1);
  });

  it("promise-date validation uses the same IST date (01:30 IST on the 21st accepts the 21st, rejects the 20th)", () => {
    const now = new Date("2026-09-20T20:00:00Z");
    expect(validatePromiseDate("2026-09-21", now)).toBeNull();
    expect(validatePromiseDate("2026-09-20", now)).toMatch(/in the past/);
  });
});

describe("database guard: the latest record_payment_row definition never uses the UTC current_date", () => {
  it("the last migration that defines record_payment_row stamps received_on with the IST date", () => {
    const dir = join(process.cwd(), "supabase", "migrations");
    const defs = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => ({ f, sql: readFileSync(join(dir, f), "utf8") }))
      .filter(({ sql }) => /create or replace function record_payment_row\(/i.test(sql));
    const latest = defs[defs.length - 1];
    const body = latest.sql.slice(latest.sql.search(/create or replace function record_payment_row\(/i)).split(/revoke execute/i)[0];
    expect(latest.f).toMatch(/^0024_/);
    expect(body.replace(/--.*$/gm, "")).not.toMatch(/current_date/i);
    expect(body).toMatch(/now\(\) at time zone 'Asia\/Kolkata'\)::date/);
  });
});
