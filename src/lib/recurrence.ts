/*
  WP8 · the recurrence arithmetic — pure, so every next-occurrence date and the
  missed-occurrence rule unit-test without a database or a browser.

  Five patterns and no more (decisions · Recurring tasks): daily, weekdays,
  weekly on chosen days, monthly on a date, every N weeks. Two meanings, both
  typeable: fixed dates (`every`) and N-days-after-you-last-finished (`every!`).
  The two meanings collapse to ONE arithmetic here — `nextOccurrence(spec, anchor)`
  advances from an anchor date, and the caller chooses the anchor:

    - fixed:            anchor = the occurrence's own scheduled date, so the next
                        one lands on the calendar regardless of when you finished.
    - after_completion: anchor = the date you finished, so watering the plants on
                        day 11 makes them next due on day 18, not day 14.

  All calendar maths is done on plain "YYYY-MM-DD" triples (invariant 10 — a date
  is a calendar date with no time and no zone), so nothing drifts across zones.
*/

export type RecurrencePattern =
  | "daily"
  | "weekdays"
  | "weekly"
  | "monthly_date"
  | "every_n_weeks";

export type RecurrenceMode = "fixed" | "after_completion";

/** The rule's shape, matching the recurrence_rule columns the schema stores. */
export interface RecurrenceSpec {
  pattern: RecurrencePattern;
  /** Length 7, index 0 = Sunday. Meaningful only for `weekly`. */
  weekdays: boolean[];
  /** 1–31, for `monthly_date`. Clamped to the month's length when it overshoots. */
  dayOfMonth: number | null;
  /** The N, for `every_n_weeks`. */
  n: number | null;
  mode: RecurrenceMode;
}

// ---------------------------------------------------------------------------
// Date helpers — the same Y-M-D-triple maths the parser uses, kept local so this
// module imports nothing and stays trivially testable.
// ---------------------------------------------------------------------------

function triple(iso: string): [number, number, number] {
  const [y, m, d] = iso.split("-").map(Number);
  return [y, m, d];
}

function ymd(y: number, m0: number, d: number): string {
  const mm = String(m0 + 1).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  return `${y}-${mm}-${dd}`;
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = triple(iso);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return ymd(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate());
}

/** 0 = Sunday .. 6 = Saturday. */
export function weekdayOf(iso: string): number {
  const [y, m, d] = triple(iso);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function daysInMonth(y: number, m0: number): number {
  return new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
}

/** The Nth day of a month, clamped to the month's real length (so a rule on the
 *  31st lands on the 30th, 29th or 28th where the month is shorter). */
function clampedDay(y: number, m0: number, day: number): string {
  return ymd(y, m0, Math.min(day, daysInMonth(y, m0)));
}

function isWeekdayDay(iso: string): boolean {
  const wd = weekdayOf(iso);
  return wd >= 1 && wd <= 5; // Mon..Fri
}

function anyWeekdaySet(weekdays: boolean[]): boolean {
  return weekdays.some(Boolean);
}

// ---------------------------------------------------------------------------
// The one advance function. Given an anchor date, return the next occurrence
// strictly after it. Used for BOTH modes — fixed passes the scheduled date,
// after-completion passes the completion date.
// ---------------------------------------------------------------------------

export function nextOccurrence(spec: RecurrenceSpec, anchorIso: string): string {
  switch (spec.pattern) {
    case "daily":
      return addDays(anchorIso, 1);

    case "weekdays": {
      // The next Monday–Friday strictly after the anchor.
      let d = addDays(anchorIso, 1);
      while (!isWeekdayDay(d)) d = addDays(d, 1);
      return d;
    }

    case "weekly": {
      // The next chosen weekday strictly after the anchor. With no weekday chosen
      // (`every week`), it is simply seven days on — the same weekday each time.
      if (!anyWeekdaySet(spec.weekdays)) return addDays(anchorIso, 7);
      let d = addDays(anchorIso, 1);
      for (let i = 0; i < 7; i++) {
        if (spec.weekdays[weekdayOf(d)]) return d;
        d = addDays(d, 1);
      }
      return addDays(anchorIso, 7); // unreachable — a set weekday is hit within 7
    }

    case "monthly_date": {
      const day = spec.dayOfMonth ?? 1;
      const [y, m] = triple(anchorIso);
      // Walk forward a month at a time until the clamped day lands after the
      // anchor. Starting from the anchor's own month covers the case where the
      // anchor is earlier in the month than the target day.
      let year = y;
      let month0 = m - 1;
      for (let i = 0; i < 24; i++) {
        const cand = clampedDay(year, month0, day);
        if (cand > anchorIso) return cand;
        month0 += 1;
        if (month0 > 11) {
          month0 = 0;
          year += 1;
        }
      }
      return clampedDay(year, month0, day);
    }

    case "every_n_weeks": {
      const n = spec.n && spec.n > 0 ? spec.n : 1;
      return addDays(anchorIso, 7 * n);
    }
  }
}

/** Does `iso` itself satisfy the pattern — used to decide whether the very first
 *  occurrence can be today rather than a step forward. */
function matchesToday(spec: RecurrenceSpec, iso: string): boolean {
  switch (spec.pattern) {
    case "daily":
      return true;
    case "weekdays":
      return isWeekdayDay(iso);
    case "weekly":
      return anyWeekdaySet(spec.weekdays) ? spec.weekdays[weekdayOf(iso)] : true;
    case "monthly_date": {
      const [y, m] = triple(iso);
      return clampedDay(y, m - 1, spec.dayOfMonth ?? 1) === iso;
    }
    case "every_n_weeks":
      return true; // an interval series starts the day it is created
  }
}

/**
 * The first occurrence of a brand-new series: today when today already satisfies
 * the pattern, otherwise the next date that does. This is the date the first
 * captured occurrence is stamped with.
 */
export function firstOccurrenceOnOrAfter(spec: RecurrenceSpec, todayIso: string): string {
  return matchesToday(spec, todayIso) ? todayIso : nextOccurrence(spec, todayIso);
}

/**
 * The next occurrence strictly after `fromIso` that is also on or after `todayIso`.
 * This is how missed fixed occurrences collapse instead of piling up: whatever was
 * missed, the series jumps straight to its first still-future date, so there is
 * never a stack of overdue copies (decisions · "Missed occurrences do not pile up").
 */
export function nextOccurrenceOnOrAfter(
  spec: RecurrenceSpec,
  fromIso: string,
  todayIso: string
): string {
  let d = nextOccurrence(spec, fromIso);
  // Bounded walk — even a daily series clears a year of misses in 366 steps.
  for (let i = 0; i < 800 && d < todayIso; i++) {
    d = nextOccurrence(spec, d);
  }
  return d;
}

// ---------------------------------------------------------------------------
// A compact description of a rule, for the summary sentences the app writes when
// it spawns or skips an occurrence (the parser has its own live-echo prose).
// ---------------------------------------------------------------------------

const WEEKDAY_NAMES = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

export function describeRule(spec: RecurrenceSpec): string {
  let base: string;
  switch (spec.pattern) {
    case "daily":
      base = "every day";
      break;
    case "weekdays":
      base = "every weekday";
      break;
    case "weekly": {
      const days = spec.weekdays
        .map((on, i) => (on ? WEEKDAY_NAMES[i] : null))
        .filter(Boolean);
      base = days.length ? `every ${days.join(", ")}` : "every week";
      break;
    }
    case "monthly_date":
      base = `on the ${ordinal(spec.dayOfMonth ?? 1)} of each month`;
      break;
    case "every_n_weeks": {
      const n = spec.n && spec.n > 0 ? spec.n : 1;
      base = n === 1 ? "every week" : `every ${n} weeks`;
      break;
    }
  }
  return spec.mode === "after_completion" ? `${base}, from completion` : base;
}
