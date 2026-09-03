/*
  WP14 · the calendar's pure helpers (R8, and the whole calendar section of
  decisions.md). No React, no Prisma — the day-range maths, the wall-clock ⇄ UTC
  reading a block needs, and the tablet/popup wording all unit-test on their own.

  The block model (invariant 10): a block is a do-date plus wall-clock times. The
  stored columns block_start / block_end are UTC instants built from those wall
  times in the USER's zone (the zone the block was expressed in — the calendar is
  always the user's own working day, so there is no second zone and no block_zone
  column). Rendering reads them back at the same wall hour. block_end − block_start
  is the estimate (invariant 5); the two are one number and never come apart.
*/

import { wallToUtc } from "./reminders";
import { fmtMinutes } from "./task-page";
import type { BlockInterval, BlockChargeResult } from "./shifts";

// ---------------------------------------------------------------------------
// The seven days (or however many), starting today (R8 — not a Mon–Sun week).
// ---------------------------------------------------------------------------

const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export const CALENDAR_VIEWS = [1, 3, 7] as const;
export const MAX_CALENDAR_DAYS = 60; // an "any number" field, kept sane
export const DEFAULT_CALENDAR_DAYS = 7;

/** The weekday index (0 = Sunday) for a "YYYY-MM-DD", read as a plain date. */
export function weekdayIndexOf(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Add whole days to a "YYYY-MM-DD", staying a plain date (no zone maths). */
export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export interface CalendarDay {
  iso: string; // YYYY-MM-DD
  weekdayIndex: number; // 0 = Sunday
  weekdayShort: string; // "Wed"
  weekdayLong: string; // "Wednesday"
  dayOfMonth: number; // 6
  monthShort: string; // "Aug"
  isToday: boolean;
}

/** Clamp a requested day count into [1, MAX]. A blank / bad field falls back to
 *  the default rather than throwing — the view control never errors. */
export function clampDayCount(raw: number | null | undefined): number {
  if (raw == null || !Number.isFinite(raw)) return DEFAULT_CALENDAR_DAYS;
  const n = Math.round(raw);
  if (n < 1) return 1;
  if (n > MAX_CALENDAR_DAYS) return MAX_CALENDAR_DAYS;
  return n;
}

/** The visible days, starting today (R8). */
export function calendarDays(todayIso: string, count: number): CalendarDay[] {
  const n = clampDayCount(count);
  const days: CalendarDay[] = [];
  for (let i = 0; i < n; i++) {
    const iso = addDaysIso(todayIso, i);
    const [, m, d] = iso.split("-").map(Number);
    const wd = weekdayIndexOf(iso);
    days.push({
      iso,
      weekdayIndex: wd,
      weekdayShort: WEEKDAY_SHORT[wd],
      weekdayLong: WEEKDAY_LONG[wd],
      dayOfMonth: d,
      monthShort: MONTH_SHORT[m - 1],
      isToday: i === 0,
    });
  }
  return days;
}

/** The range label a header shows, e.g. "6 – 12 August" or "6 Aug – 3 Sep".
 *  A single month spells out ("August", per the wireframe); a span across months
 *  uses the short month on each end so the label stays compact. */
export function rangeLabel(days: CalendarDay[]): string {
  if (days.length === 0) return "";
  const first = days[0];
  const last = days[days.length - 1];
  const firstMonthLong = MONTH_LONG[Number(first.iso.split("-")[1]) - 1];
  if (first.iso === last.iso) return `${first.dayOfMonth} ${first.monthShort}`;
  if (first.monthShort === last.monthShort) {
    return `${first.dayOfMonth} – ${last.dayOfMonth} ${firstMonthLong}`;
  }
  return `${first.dayOfMonth} ${first.monthShort} – ${last.dayOfMonth} ${last.monthShort}`;
}

// ---------------------------------------------------------------------------
// Wall-clock ⇄ UTC for a block (invariant 10).
// ---------------------------------------------------------------------------

/** Minutes past midnight (00:00) in `zone` for the given hour and minute. */
function hmToMinutes(h: number, m: number): number {
  return h * 60 + m;
}

/** The UTC instant a block starts at: the wall time on the do-date in the user's
 *  zone. Its end is start + length; the two together are the estimate. */
export function blockStartInstant(dayIso: string, startHHMM: string, userZone: string): Date {
  return wallToUtc(dayIso, startHHMM, userZone);
}

/** Read a stored block instant back to minutes-past-midnight in the user's zone,
 *  for placing it on the grid. Uses Intl so the zone (and any DST) is honoured. */
export function instantToWallMinutes(instant: Date, zone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const map: Record<string, string> = {};
  for (const p of parts) if (p.type !== "literal") map[p.type] = p.value;
  const h = Number(map.hour) % 24;
  const m = Number(map.minute);
  return hmToMinutes(h, m);
}

/** "HH:MM" for a minutes-past-midnight value (mod a day), e.g. 570 → "09:30". */
export function minutesToHHMM(minutes: number): string {
  const within = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(within / 60);
  const m = within % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** A block's start/end minutes on its do-date, for the grid (BlockInterval).
 *  End may exceed 1440 when the block runs past midnight — that tail is in no
 *  shift, exactly case four. */
export function blockGridInterval(
  blockStart: Date,
  blockEnd: Date,
  dayZone: string
): BlockInterval {
  const startMinutes = instantToWallMinutes(blockStart, dayZone);
  const lengthMinutes = Math.round((blockEnd.getTime() - blockStart.getTime()) / 60_000);
  return { startMinutes, endMinutes: startMinutes + lengthMinutes };
}

/** A short "09:00–10:30" range label for a block. */
export function blockTimeLabel(interval: BlockInterval): string {
  return `${minutesToHHMM(interval.startMinutes)}–${minutesToHHMM(interval.endMinutes)}`;
}

// ---------------------------------------------------------------------------
// The consequence of a drop (invariant 8 — printed in the same frame, no toast).
// The tablet keeps you aware and asks nothing (the aware cases). Going over a
// shift's capacity is a different thing, so it raises a popup with a queue link
// instead — and, per the one-flow in blocks-across-shifts.md, the over-capacity
// check ends the flow, so a drop that goes over shows the popup and not a tablet.
// ---------------------------------------------------------------------------

export interface ConsequenceInput {
  block: BlockInterval;
  charge: BlockChargeResult;
  taskTitle: string;
  /** The task's category name, for the "does not take X" line (case three). */
  categoryName: string | null;
  /** The day's active shifts (name + window), to tell a lunch gap from the end
   *  of the day and to name the whole-block-in-no-shift case. */
  activeShifts: { id: string; name: string; startMinutes: number; endMinutes: number }[];
  /** "Friday", for the whole-block-not-in-any-shift line. */
  dayLabel: string;
}

export interface OverCapacityPopup {
  shiftId: string;
  shiftName: string;
  line: string;
}

export interface PlacementConsequence {
  /** Tablet lines (bottom of the screen, dismissable, asks nothing). Empty when
   *  the block sits neatly in one shift, or when the popup is showing instead. */
  tabletLines: string[];
  /** Present when a shift went over capacity — the popup, with a queue link. */
  overCapacity: OverCapacityPopup | null;
}

/** The latest minute any active shift covers on the day (for "after your last
 *  shift ends"). Whole-day and wrap shifts reach the end of the day. */
function lastShiftEndMinutes(
  shifts: { startMinutes: number; endMinutes: number }[]
): number | null {
  if (shifts.length === 0) return null;
  let last = 0;
  for (const s of shifts) {
    // start === end (whole day) or start > end (wrap) both reach midnight.
    const end = s.startMinutes >= s.endMinutes ? 1440 : s.endMinutes;
    if (end > last) last = end;
  }
  return last;
}

export function blockConsequence(input: ConsequenceInput): PlacementConsequence {
  const { block, charge, taskTitle, categoryName, activeShifts, dayLabel } = input;

  // Over capacity → the popup, and the flow ends here (blocks-across-shifts.md).
  if (charge.overCapacityShiftIds.length > 0) {
    const shiftId = charge.overCapacityShiftIds[0];
    const ch = charge.charges.find((c) => c.shiftId === shiftId);
    const shiftName = ch?.shiftName ?? "a shift";
    return {
      tabletLines: [],
      overCapacity: {
        shiftId,
        shiftName,
        line: `This block covers ${shiftName}, which is now over capacity. See everything charged to it.`,
      },
    };
  }

  const lines: string[] = [];

  // The whole block is in no shift (nothing charged) — name the block and its time.
  if (charge.charges.length === 0 && charge.uncoveredMinutes > 0) {
    lines.push(`${taskTitle}, ${blockTimeLabel(block)} ${dayLabel}, is not inside any shift.`);
  } else if (charge.uncoveredMinutes > 0) {
    // Part of the block is uncovered: a lunch gap, or past the last shift.
    const lastEnd = lastShiftEndMinutes(activeShifts);
    const pastEnd = lastEnd != null && block.endMinutes > lastEnd && block.startMinutes < lastEnd;
    if (pastEnd) {
      lines.push(`${fmtMinutes(charge.uncoveredMinutes)} of this block is after your last shift ends.`);
    } else {
      lines.push(`${fmtMinutes(charge.uncoveredMinutes)} of this block is not in any shift.`);
    }
  }

  // A shift charged that does not accept the task (case three) — name it and what
  // it takes. Charged anyway; the tablet is what tells you the two disagree.
  for (const c of charge.charges) {
    if (!c.admitsTask) {
      const takes = categoryName ? `does not take ${categoryName}` : "does not take this task";
      lines.push(`This block runs ${fmtMinutes(c.overlapMinutes)} into ${c.shiftName}, which ${takes}.`);
    }
  }

  return { tabletLines: lines, overCapacity: null };
}
