/*
  WP11 · shifts, capacity and the scheduled total — the arithmetic layer.

  Everything here is pure so it can be unit-tested without a database, because
  this is exactly where a silent bug costs a deadline: a capacity mis-computed
  from a window, a task routed to the wrong shift, a remaining figure that hides
  an overload. The DB seam is in @/lib/queries (reads) and the Settings actions
  (writes); this file only does sums.

  Three invariants bind this file:
    - Invariant 3: the scheduled total is NEVER stored. It is computed here from
      the tasks and the blocks, every time. No column caches it.
    - Invariant 5: an estimate is one integer of minutes, or null. A null
      estimate is counted, never guessed — it lands in the unestimated count.
    - Invariant 12: nothing about one person's life is hard-coded. A shift with
      no admitted categories takes every category; that empty-means-all rule is
      the only "default", and it comes from the data, not a literal.
*/

import { fmtMinutes } from "./task-page";

export const WHOLE_DAY_MINUTES = 24 * 60; // 1440

/** Minutes past midnight for "HH:MM" (00:00–24:00), or null if malformed. */
export function hhmmToMinutes(hhmm: string | null | undefined): number | null {
  if (!hhmm) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 24 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/**
 * The length of a shift window, in minutes. Three cases, matching the R15
 * caption's own `withinWindow` reading so the two never disagree:
 *   - start === end is the whole day (00:00–00:00, the R29 default), 1440.
 *   - start < end is the ordinary window, end − start.
 *   - start > end crosses midnight (11:00–03:00 is legitimate, R29), and wraps.
 * A malformed time yields 0 — a window we cannot read holds no minutes.
 */
export function windowMinutes(startHHMM: string, endHHMM: string): number {
  const s = hhmmToMinutes(startHHMM);
  const e = hhmmToMinutes(endHHMM);
  if (s == null || e == null) return 0;
  if (s === e) return WHOLE_DAY_MINUTES;
  if (s < e) return e - s;
  return WHOLE_DAY_MINUTES - s + e;
}

/**
 * Capacity pre-filled from the window (R13: "Capacity is pre-filled from the
 * window and says so"). It is exactly the window length; the "says so" is the
 * caption below, rendered beside the field, and the `capacity_from_window` flag
 * on the row records that the number was not overridden.
 */
export const capacityFromWindowMinutes = windowMinutes;

/** The "and says so" sentence for the add-a-shift form (R13). */
export function capacityNote(startHHMM: string, endHHMM: string): string {
  const mins = windowMinutes(startHHMM, endHHMM);
  return `Pre-filled from the window (${fmtMinutes(mins)}). Edit to override.`;
}

/**
 * Does a shift admit a task's category? An empty admit-list means the shift
 * takes every category (invariant 12 — shift_category empty admits everything).
 * A shift that DOES list categories takes only those; an uncategorised task is
 * not one of them, so a restricted shift does not sweep it up.
 */
export function shiftAdmitsCategory(
  admittedCategoryIds: string[],
  taskCategoryId: string | null
): boolean {
  if (admittedCategoryIds.length === 0) return true;
  if (taskCategoryId == null) return false;
  return admittedCategoryIds.includes(taskCategoryId);
}

export interface RoutableShift {
  id: string;
  startMinutes: number;
  endMinutes: number;
  weekdays: boolean[]; // length 7, index 0 = Sunday (matches parse.ts + schema)
  admittedCategoryIds: string[];
}

export interface RoutableTask {
  id: string;
  categoryId: string | null;
  estimateMinutes: number | null;
}

export interface RoutingResult {
  /** shiftId → the untimed tasks that landed on it that day. */
  byShift: Map<string, RoutableTask[]>;
  /** Tasks no active, admitting shift took (e.g. a restricted-category task on a
   *  day whose only shift excludes its category). They are honestly nobody's. */
  unrouted: RoutableTask[];
}

/**
 * Route each untimed task to at most one shift active on `weekday` that admits
 * its category. A task counts once, never in two shifts at the same time — the
 * scheduled total is minutes of work, and the same forty minutes cannot be owed
 * to two shifts. Ties break by earliest window start, then the shift's position
 * in the passed order (so the caller controls the tiebreak by ordering shifts).
 *
 * Blocks (timed tasks) are charged by window overlap and arrive in WP14 with
 * their own arithmetic; this routes only the untimed tasks, which is the whole
 * of the scheduled total in stage 1.
 */
export function routeTasks(
  shifts: RoutableShift[],
  tasks: RoutableTask[],
  weekday: number
): RoutingResult {
  const active = shifts
    .filter((sh) => sh.weekdays[weekday])
    .slice()
    .sort((a, b) => a.startMinutes - b.startMinutes);

  const byShift = new Map<string, RoutableTask[]>();
  for (const sh of shifts) byShift.set(sh.id, []);
  const unrouted: RoutableTask[] = [];

  for (const t of tasks) {
    const home = active.find((sh) => shiftAdmitsCategory(sh.admittedCategoryIds, t.categoryId));
    if (home) byShift.get(home.id)!.push(t);
    else unrouted.push(t);
  }
  return { byShift, unrouted };
}

export interface ShiftLoad {
  /** Minutes of estimated work routed to the shift (invariant 3 — computed). */
  scheduledMinutes: number;
  /** Routed tasks carrying no estimate. Shown beside remaining, always (the
   *  Computed table: a clean number that hides half the queue is worse than none). */
  unestimatedCount: number;
  capacityMinutes: number | null;
  /** capacity − scheduled. Null only when the shift has no capacity set. May be
   *  negative, and a negative value is surfaced as "over by", never hidden. */
  remainingMinutes: number | null;
}

/** The load a routed set of tasks puts on a shift with a given capacity. */
export function shiftLoad(
  routedTasks: RoutableTask[],
  capacityMinutes: number | null
): ShiftLoad {
  let scheduledMinutes = 0;
  let unestimatedCount = 0;
  for (const t of routedTasks) {
    if (t.estimateMinutes == null) unestimatedCount += 1;
    else scheduledMinutes += t.estimateMinutes;
  }
  return {
    scheduledMinutes,
    unestimatedCount,
    capacityMinutes,
    remainingMinutes: capacityMinutes == null ? null : capacityMinutes - scheduledMinutes,
  };
}

/** The day total (the Computed table): the sum of the day's shifts' scheduled
 *  minutes. Displayed, and never used to refuse anything. */
export function dayTotalMinutes(loads: ShiftLoad[]): number {
  return loads.reduce((sum, l) => sum + l.scheduledMinutes, 0);
}

/**
 * The remaining figure in words (invariant 7 — state is words). Positive is
 * "left", zero is "full", negative is "over by" — the overload is named, not
 * dropped. Null capacity has nothing to say.
 */
export function remainingLabel(remainingMinutes: number | null): string {
  if (remainingMinutes == null) return "no capacity set";
  if (remainingMinutes > 0) return `${fmtMinutes(remainingMinutes)} left`;
  if (remainingMinutes === 0) return "full";
  return `over by ${fmtMinutes(-remainingMinutes)}`;
}

/** The unestimated figure in words, or null when the shift is fully estimated
 *  (nothing to caveat). */
export function unestimatedLabel(count: number): string | null {
  if (count <= 0) return null;
  return `${count} unestimated`;
}

// ---------------------------------------------------------------------------
// Onboarding (R13). Sign-up asks one question — how many hours of real work
// does your day hold — and the answer becomes the Day shift's capacity. One
// screen, then the app is usable, and the app never asks again (R14).
// ---------------------------------------------------------------------------

export const MIN_ONBOARD_HOURS = 0.5;
export const MAX_ONBOARD_HOURS = 24;

/** The onboarding answer (hours of real work) as capacity minutes, or null when
 *  it is out of range or unreadable. Half-hour granularity is enough. */
export function onboardHoursToMinutes(hours: number): number | null {
  if (!Number.isFinite(hours)) return null;
  if (hours < MIN_ONBOARD_HOURS || hours > MAX_ONBOARD_HOURS) return null;
  return Math.round(hours * 60);
}

/**
 * Has the user been through onboarding? Two ways to be past it: a shift already
 * exists (the ordinary case — onboarding created the Day shift), or the settings
 * flag records the answer even if every shift was later removed. Either means
 * the app never asks again (R14).
 */
export function isOnboarded(settings: unknown, shiftCount: number): boolean {
  if (shiftCount > 0) return true;
  const s = (settings ?? {}) as { onboardedAt?: unknown };
  return typeof s.onboardedAt === "string" && s.onboardedAt.length > 0;
}

// ---------------------------------------------------------------------------
// Waking hours (R29). One editable setting, default 00:00–00:00 (the whole
// day), and it may cross midnight. Until real shifts narrow the day, the Day
// shift's window is the waking window, which keeps the R15 caption silent while
// the window is the full day. Read from the user row, never hard-coded (12).
// ---------------------------------------------------------------------------

export const DEFAULT_WAKING_START = "00:00";
export const DEFAULT_WAKING_END = "00:00";

/** A "HH:MM" is a valid wall-clock time this app will store. */
export function isValidHhmm(hhmm: string): boolean {
  return hhmmToMinutes(hhmm) != null;
}

export interface WakingHours {
  start: string;
  end: string;
}

/** The user's waking window, defaulting to the whole day (R29). */
export function readWakingHours(user: {
  wakingStart: string | null;
  wakingEnd: string | null;
}): WakingHours {
  return {
    start: user.wakingStart ?? DEFAULT_WAKING_START,
    end: user.wakingEnd ?? DEFAULT_WAKING_END,
  };
}

/** The seven weekday flags for a shift that runs every day (onboarding's Day). */
export function everyWeekday(): boolean[] {
  return [true, true, true, true, true, true, true];
}

/** Short weekday labels for the shift table, e.g. "Mon–Fri" collapsed sensibly,
 *  or "every day", or "Sun, Wed". Index 0 = Sunday. */
const DAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function weekdaysLabel(weekdays: boolean[]): string {
  const on = weekdays.map((b, i) => (b ? i : -1)).filter((i) => i >= 0);
  if (on.length === 7) return "every day";
  if (on.length === 0) return "no days";
  // Weekdays Mon–Fri exactly.
  if (on.length === 5 && on.every((i) => i >= 1 && i <= 5)) return "Mon–Fri";
  return on.map((i) => DAY_ABBR[i]).join(", ");
}
