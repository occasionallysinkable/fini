/*
  WP9 · the plain "today" — the pure logic behind the one-thing screen (R21).

  Stage 1 only. There is NO ranking and NO reason sentence here: the set is the
  work due or do-dated today, ordered by due date then due time, and the line
  under a task reads the due date flatly (R21). Stage 3 (WP17) swaps the ordering
  for the ranking and turns the flat line into the sentence; nothing about the
  three answers changes then, so none of that is built now.

  Everything here is a pure function of its inputs, so it unit-tests without a
  database or a browser. Dates are carried as "YYYY-MM-DD" strings so the whole
  shape crosses the server → client boundary without a serializer, and every
  calendar calculation is done on the string so there is no timezone drift
  (dates are dates — invariant 10).
*/

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** Weekday index (0 = Sunday) of a "YYYY-MM-DD" date. */
export function weekdayOf(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Add whole days to a "YYYY-MM-DD" date, returning a "YYYY-MM-DD" date. */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${mm}-${dd}`;
}

/** "2026-08-07" → "Thursday 7 August". */
export function humanDate(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${WEEKDAY_NAMES[weekdayOf(iso)]} ${d} ${MONTH_NAMES[m - 1]}`;
}

/** "2026-08-07" → "7 Aug" — the short form the flat due line and the ledger use. */
export function shortDate(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTH_NAMES[m - 1].slice(0, 3)}`;
}

// ---------------------------------------------------------------------------
// The not-today reschedule targets (R3). Two of the five carry a computed
// date; the other three (pick a day, no date, waiting on someone) are handled
// by the screen, not here.
// ---------------------------------------------------------------------------

/** The "tomorrow" target: today + 1. */
export function tomorrow(today: string): string {
  return addDays(today, 1);
}

/**
 * The named-weekday target (R3): "the next occurrence of whichever weekday is
 * furthest from today without wrapping past a week". Today + 7 is the same
 * weekday a week out — that wraps — so the furthest that does not wrap is today
 * + 6, a genuinely different offer from tomorrow. The label is that day's name.
 */
export function furthestWeekday(today: string): { date: string; label: string } {
  const date = addDays(today, 6);
  return { date, label: WEEKDAY_NAMES[weekdayOf(date)] };
}

// ---------------------------------------------------------------------------
// The something-else reasons (R1, decisions line 109). The four canned reasons
// map onto fields the app understands; the fifth takes free text for when none
// of the four is honest. Each names its own side, so the tap says which task it
// is about — which is what `pointsAt` records (fresh information is the only one
// filed against both, because either task could be the thing that changed).
// ---------------------------------------------------------------------------

export type OverrideReasonCode =
  | "matters_more"
  | "estimate_wrong"
  | "wrong_time"
  | "fresh_info"
  | "free_text";

export type OverridePointsAt = "rejected" | "chosen" | "both";

export interface OverrideReasonOption {
  code: OverrideReasonCode;
  /** The short word on the row of five. */
  word: string;
  /** The sentence stored/read against the override. */
  human: string;
  pointsAt: OverridePointsAt;
  /** The fifth choice opens a free-text field rather than committing on the tap. */
  freeText?: boolean;
}

export const OVERRIDE_REASONS: OverrideReasonOption[] = [
  { code: "matters_more", word: "matters more", human: "the one I picked matters more", pointsAt: "chosen" },
  { code: "estimate_wrong", word: "estimate wrong", human: "the offered one's estimate is wrong", pointsAt: "rejected" },
  { code: "wrong_time", word: "wrong time", human: "wrong time of day for the offered one", pointsAt: "rejected" },
  { code: "fresh_info", word: "fresh info", human: "fresh information", pointsAt: "both" },
  { code: "free_text", word: "other…", human: "", pointsAt: "both", freeText: true },
];

export function overrideReason(code: OverrideReasonCode): OverrideReasonOption | undefined {
  return OVERRIDE_REASONS.find((r) => r.code === code);
}

// ---------------------------------------------------------------------------
// The today set, and its order.
// ---------------------------------------------------------------------------

export interface TodayTask {
  id: string;
  title: string;
  projectName: string | null;
  dueDate: string | null; // YYYY-MM-DD
  dueTime: string | null; // HH:MM
  doDate: string | null; // YYYY-MM-DD
  /** An unresolved blocker (waiting / late) makes the task work you are waiting
   *  on, not your own — present but demoted (decisions line 122). */
  blocked: boolean;
  /** The blocker's line for the demoted task, e.g. "waiting on Ravi, expected
   *  4 Aug" (R3). Null when not blocked. */
  blockerLabel: string | null;
}

/** Nulls always sort last, whichever way the rest sorts. */
function cmpNullableStr(a: string | null, b: string | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a.localeCompare(b);
}

/**
 * The today set, ordered (R21). The set is every task due today OR do-dated
 * today. The order is due date, then due time, then title — with one twist from
 * decisions line 122: work you are waiting on (blocked) is demoted below your
 * own, so it can never sit in the frame as the one thing to do. Ordering is by
 * the strings, so it is timezone-safe (dates are dates — invariant 10).
 *
 * The caller passes tasks already filtered to available ones (invariant 4);
 * this only narrows to the day and orders.
 */
export function selectToday<T extends TodayTask>(tasks: T[], today: string): T[] {
  return tasks
    .filter((t) => t.dueDate === today || t.doDate === today)
    .sort((a, b) => {
      // Blocked work sinks below own work, regardless of its dates.
      if (a.blocked !== b.blocked) return a.blocked ? 1 : -1;
      const byDate = cmpNullableStr(a.dueDate, b.dueDate);
      if (byDate !== 0) return byDate;
      const byTime = cmpNullableStr(a.dueTime, b.dueTime);
      if (byTime !== 0) return byTime;
      return a.title.localeCompare(b.title);
    });
}

/**
 * The flat line under a task (R21): it reads the due date, plainly, and nothing
 * cleverer — no ranking, no reason. A blocked task reads its blocker line
 * instead, because "waiting on Ravi, expected 4 Aug" is the honest state of a
 * task you cannot act on. A task with no due date on today's plan says so.
 */
export function dueLine(task: TodayTask, today: string): string {
  if (task.blocked && task.blockerLabel) return task.blockerLabel;
  if (!task.dueDate) return "No due date · on today's plan";

  let when: string;
  if (task.dueDate === today) when = "today";
  else if (task.dueDate === addDays(today, 1)) when = "tomorrow";
  else when = humanDate(task.dueDate);

  return task.dueTime ? `Due ${when} ${task.dueTime}` : `Due ${when}`;
}
