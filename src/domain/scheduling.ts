/**
 * Outbound-message scheduling rules (PRD §5 "Timing", workflow-spec).
 * - Timezone IST (UTC+05:30, no DST). Timestamps stored/returned in UTC.
 * - Scheduled sends fire at 11:00 IST.
 * - No scheduled outbound on Sunday IST; roll to Monday 11:00 IST.
 * - 24h timer starts only after delivery; 7d (GST) timer starts only after a
 *   persisted Send reference. Those callers pass the trigger time in.
 */

const IST_OFFSET_MIN = 5 * 60 + 30;
export const SEND_HOUR_IST = 11;

/** Wall-clock parts of `date` in IST. */
export function istParts(date: Date) {
  const shifted = new Date(date.getTime() + IST_OFFSET_MIN * 60_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    weekday: shifted.getUTCDay(), // 0 = Sunday
  };
}

/**
 * The IST calendar date (YYYY-MM-DD) of an instant -- the application's
 * business date. Payment/promise/"today" dates for this India-based product
 * are always IST dates, never the UTC date (which differs from 00:00 to
 * 05:30 IST every day).
 */
export function istBusinessDate(date: Date): string {
  const p = istParts(date);
  return `${p.year}-${String(p.month + 1).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Whole calendar days from IST date `from` to IST date `to` (both YYYY-MM-DD). */
export function istDaysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** UTC Date for a given IST wall-clock instant. */
export function istWallClockToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0,
): Date {
  return new Date(Date.UTC(year, month, day, hour, minute) - IST_OFFSET_MIN * 60_000);
}

/**
 * Next permitted send instant at/after `from`.
 * If `from` is before 11:00 IST on a non-Sunday, returns today 11:00 IST.
 * Otherwise the next day's 11:00 IST, skipping Sunday.
 */
export function nextSendWindow(from: Date): Date {
  const p = istParts(from);
  let candidate = istWallClockToUtc(p.year, p.month, p.day, SEND_HOUR_IST, 0);

  const beforeTodaysSlot =
    p.hour < SEND_HOUR_IST || (p.hour === SEND_HOUR_IST && p.minute === 0 && from <= candidate);

  if (!beforeTodaysSlot) {
    const next = new Date(candidate);
    next.setUTCDate(next.getUTCDate() + 1);
    candidate = next;
  }

  // Roll Sunday IST -> Monday IST.
  while (istParts(candidate).weekday === 0) {
    const next = new Date(candidate);
    next.setUTCDate(next.getUTCDate() + 1);
    candidate = next;
  }
  return candidate;
}

export function addHours(from: Date, hours: number): Date {
  return new Date(from.getTime() + hours * 3_600_000);
}

export function addCalendarDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 86_400_000);
}

/** 24h reminder timer — starts on delivery. */
export function reminderTimerDeadline(deliveredAt: Date): Date {
  return addHours(deliveredAt, 24);
}

/** GST 7-day timer — starts on persisted Send reference. */
export function gstTimerDeadline(filedAt: Date): Date {
  return addCalendarDays(filedAt, 7);
}

/** Internal task overdue by 24h escalates to Admin (workflow-spec). */
export function isOverdueForAdminEscalation(dueAt: Date, now: Date): boolean {
  return now.getTime() - dueAt.getTime() >= 24 * 3_600_000;
}
