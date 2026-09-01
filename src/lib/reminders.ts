/*
  WP7 · reminder arithmetic (PURE).

  Everything here is arithmetic on times, and a silent bug in it costs a
  deadline — so it imports nothing, touches no database, and is unit-tested on
  its own (handoff: "Vitest on the arithmetic"). The server modules that write
  Reminder rows (capture, the task page, the tick endpoint, the notification
  action route) all call into this for the one thing that matters: the exact UTC
  instant a reminder should fire.

  What lives here:
    - wallToUtc      a wall-clock date+time in an IANA zone → the UTC instant.
    - computeFireTime the fire instant for one reminder, from the task's due
                      date/time and the reminder's offset or absolute time.
    - snooze mechanics the reason list, the interval choices for the second
                      snooze, and which of the two a given snooze count shows.
    - tags           the per-reminder notification tag, and the set of tags to
                      withdraw when a task is completed (multi-device withdrawal).

  Timezone note (invariant 10 / 11): dates are calendar dates with no zone, and
  a reminder "at 5pm" means 5pm where the user is. "Reminders you set" are the
  user's own, so they resolve in the user's zone; the other-person zone belongs
  to the start reminder, which is WP13, not here.
*/

// ---------------------------------------------------------------------------
// Zone conversion. No library: Intl gives us the zone's offset at any instant,
// and we invert it. One refinement pass handles the DST-transition hour.
// ---------------------------------------------------------------------------

/**
 * The offset of `timeZone` from UTC at the given instant, in milliseconds and
 * positive east of UTC (Asia/Karachi is +5h → +18000000). Works by formatting
 * the instant as wall-clock in the zone and differencing against the same
 * wall-clock read as if it were UTC.
 */
export function tzOffsetMs(timeZone: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(at);
  const map: Record<string, number> = {};
  for (const p of parts) if (p.type !== "literal") map[p.type] = Number(p.value);
  // h23 renders midnight as 24; normalise so Date.UTC does not roll the day.
  const hour = map.hour === 24 ? 0 : map.hour;
  const asUtc = Date.UTC(map.year, map.month - 1, map.day, hour, map.minute, map.second);
  return asUtc - at.getTime();
}

/**
 * The UTC instant whose wall-clock in `timeZone` is the given date and time.
 * `dateIso` is "YYYY-MM-DD", `hhmm` is "HH:MM" (24h).
 *
 * A single offset guess is wrong only inside a DST transition (the offset used
 * to place the instant differs from the offset at the placed instant); one
 * refinement pass corrects that, which is enough for every real reminder.
 */
export function wallToUtc(dateIso: string, hhmm: string, timeZone: string): Date {
  const [y, mo, d] = dateIso.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  const naive = Date.UTC(y, mo - 1, d, h, mi, 0);
  const firstGuess = new Date(naive - tzOffsetMs(timeZone, new Date(naive)));
  // Re-read the offset AT the guessed instant; if it differs (a DST edge), the
  // guess used the wrong offset, so redo the placement with the correct one.
  const refinedOffset = tzOffsetMs(timeZone, firstGuess);
  const refined = new Date(naive - refinedOffset);
  return refined;
}

// ---------------------------------------------------------------------------
// The fire instant of one reminder.
// ---------------------------------------------------------------------------

export interface FireTimeInput {
  /** The task's due date, "YYYY-MM-DD", or null. */
  dueDate: string | null;
  /** The task's due time, "HH:MM", or null. */
  dueTime: string | null;
  /** The user's IANA zone (own tasks use the user's clock). */
  timeZone: string;
  /** An offset reminder: minutes before the due time. 0 means "at the due time". */
  offsetMinutes?: number | null;
  /** An absolute reminder: a stored UTC instant that stays where it was put. */
  absoluteAt?: Date | null;
}

/**
 * When a reminder should fire, as a UTC instant, or null when it cannot be
 * placed (an offset reminder on a task with no due date at all).
 *
 * Rules (R25, reminders.md):
 *   - absolute  → its own instant, untouched by the due time.
 *   - offset with a due time → due instant minus the offset.
 *   - offset with a due DATE but no time → 00:00 on that date, in the user's
 *     zone. There is nothing to be N minutes before, so the offset is ignored
 *     and the reminder falls back to midnight (the same rule the default toggle
 *     uses for an untimed task).
 *   - offset with neither → null.
 */
export function computeFireTime(input: FireTimeInput): Date | null {
  if (input.absoluteAt) return input.absoluteAt;
  if (!input.dueDate) return null;

  if (input.dueTime) {
    const dueInstant = wallToUtc(input.dueDate, input.dueTime, input.timeZone);
    const offset = input.offsetMinutes ?? 0;
    return new Date(dueInstant.getTime() - offset * 60_000);
  }
  // A due date and no time: fall back to midnight on the date (R25).
  return wallToUtc(input.dueDate, "00:00", input.timeZone);
}

// ---------------------------------------------------------------------------
// The reminder presets offered on the task page (reminders.md · "Tapped").
// Offsets from the due time, so moving the deadline moves them.
// ---------------------------------------------------------------------------

export interface Preset {
  id: string;
  label: string;
  offsetMinutes: number;
}

export const PRESETS: Preset[] = [
  { id: "1d", label: "1 day before", offsetMinutes: 24 * 60 },
  { id: "30m", label: "30 min before", offsetMinutes: 30 },
  { id: "15m", label: "15 min before", offsetMinutes: 15 },
  { id: "at", label: "at the due time", offsetMinutes: 0 },
];

/** The human label a reminder lists itself under (task page, activity). */
export function reminderLabel(r: {
  isStartReminder?: boolean;
  offsetMinutes: number | null;
  absoluteAt: Date | null;
}): string {
  if (r.isStartReminder) return "Start reminder";
  if (r.absoluteAt) return "At a set time";
  const off = r.offsetMinutes ?? 0;
  if (off === 0) return "At the due time";
  if (off % (24 * 60) === 0) {
    const d = off / (24 * 60);
    return `${d} day${d === 1 ? "" : "s"} before`;
  }
  if (off % 60 === 0) return `${off / 60}h before`;
  return `${off}m before`;
}

// ---------------------------------------------------------------------------
// Snooze mechanics (reminders.md · "Why Later asks why").
// ---------------------------------------------------------------------------

export const DEFAULT_SNOOZE_MINUTES = 15;

/** The three reasons Later expands into. Each one IS the snooze; they differ
 *  only in the reason recorded. Order matches the notification's presentation. */
export const SNOOZE_REASONS: { id: SnoozeReasonId; label: string }[] = [
  { id: "middle_of_something", label: "In the middle of something" },
  { id: "wrong_time_of_day", label: "Wrong time of day" },
  { id: "waiting_on_someone", label: "Waiting on someone" },
];

export type SnoozeReasonId =
  | "middle_of_something"
  | "wrong_time_of_day"
  | "waiting_on_someone";

/**
 * Which face the Later expansion shows. The first two snoozes ask the reason;
 * from the third press on (snoozeCount >= 2), two snoozes are already evidence
 * the fixed interval is wrong for this reminder, so the reasons are swapped for
 * a row of longer intervals and the reason is not asked again.
 */
export function snoozeMode(snoozeCount: number): "reasons" | "intervals" {
  return snoozeCount >= 2 ? "intervals" : "reasons";
}

export interface IntervalChoice {
  id: string;
  label: string;
  /** The exact UTC instant this choice reschedules the reminder to. */
  at: Date;
}

const EVENING_HOUR = 18;
const MORNING_HOUR = 9;

/** "YYYY-MM-DD" for an instant in a zone (used to build the evening/morning
 *  targets on the right calendar day). */
function dateIsoInZone(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/**
 * The longer-interval choices offered on the second snooze (reminders.md):
 * thirty minutes, an hour, this evening, tomorrow morning. Every target is
 * strictly in the future — "this evening" rolls to tomorrow once 18:00 has
 * passed, so a late snooze never offers an instant already gone.
 */
export function intervalChoices(now: Date, timeZone: string): IntervalChoice[] {
  const todayIso = dateIsoInZone(now, timeZone);
  let evening = wallToUtc(todayIso, `${String(EVENING_HOUR).padStart(2, "0")}:00`, timeZone);
  if (evening.getTime() <= now.getTime()) {
    evening = wallToUtc(addDaysIso(todayIso, 1), `${String(EVENING_HOUR).padStart(2, "0")}:00`, timeZone);
  }
  let morning = wallToUtc(addDaysIso(todayIso, 1), `${String(MORNING_HOUR).padStart(2, "0")}:00`, timeZone);
  if (morning.getTime() <= now.getTime()) {
    morning = wallToUtc(addDaysIso(todayIso, 2), `${String(MORNING_HOUR).padStart(2, "0")}:00`, timeZone);
  }
  return [
    { id: "30m", label: "30 minutes", at: new Date(now.getTime() + 30 * 60_000) },
    { id: "1h", label: "1 hour", at: new Date(now.getTime() + 60 * 60_000) },
    { id: "evening", label: "this evening", at: evening },
    { id: "morning", label: "tomorrow morning", at: morning },
  ];
}

/** The instant a reason-snooze reschedules to: now plus the settings interval. */
export function snoozeByMinutes(now: Date, minutes: number): Date {
  return new Date(now.getTime() + minutes * 60_000);
}

// ---------------------------------------------------------------------------
// Notification tags — the handle for multi-device withdrawal.
// ---------------------------------------------------------------------------

/** The tag a reminder's notification carries. Same tag collapses repeats on one
 *  device and lets a "close" push withdraw exactly this notification on the
 *  others. */
export function reminderTag(reminderId: string): string {
  return `rem-${reminderId}`;
}

/**
 * The tags to withdraw across every device when a task is completed or a
 * reminder is snoozed elsewhere. Completing withdraws every reminder on the
 * task (a stale reminder teaches you to ignore reminders); a snooze withdraws
 * just the one that was snoozed. Pure so the withdrawal set is unit-tested.
 */
export function closeTagsForReminders(reminderIds: string[]): string[] {
  return reminderIds.map(reminderTag);
}

// ---------------------------------------------------------------------------
// Display — one place both the task page and the activity page format a fire
// instant, so they read identically.
// ---------------------------------------------------------------------------

/** A fire instant as "Thu 4 Sep, 16:40" in the user's zone, or a plain reason
 *  when it cannot fire yet. */
export function formatFireTime(at: Date | null, timeZone: string): string {
  if (!at) return "needs a due date";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(at);
}
