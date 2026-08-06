/*
  WP2 — the capture parser.

  One typed line becomes many fields (R16), and every field is echoed back in
  prose that names the field and the value (wireframe 01), so a wrong parse is
  caught while you are still looking at the line. What the parser does not
  understand stays in the title (invariant 13). Kind is inferred and the
  inference is printed with its cause (R17). When a due time falls outside every
  shift on its date, one caption line appears (R15).

  This module is PURE: it imports nothing, touches no database, and runs
  unchanged in the browser (for the live echo) and on the server (for the
  authoritative create). The server passes it the small amount of context it
  needs — today's date, the known names, the shift windows.

  Token map (R16), with the loosened spellings R27 makes mandatory:

    #work #work/payroll     project, sub-project
    @sam @sam:waiting        person + role; bare role word also binds (R27)
    ~45m !35mins ~2h         estimate — '~' or '!', any unit spelling (R27)
    30 mins  1.5h  for 2h    estimate — bare or 'for', no prefix (R27)
    Thursday  3 Sep  today   do date (a bare date is the day you work on it)
    by/before/due/no later   due date + time; the echo names which word (R27)
    9am  at 15:30  8pm today  a bare hour is a due time today (R27)
    +15m +1d +at             a reminder (offset from the due time)
    every 1st  every!7d      recurrence ('every' fixed, 'every!' after finish)
    /split 20m  /nosplit     chunking
    ^1 Oct                   defer until
    *commitment *own *habit  kind override
    // reason...             the reason, everything after the marks

  NOTE on '!': R27 assigns '!' to the estimate; reminders.md assigns it to a
  reminder. Resolutions supersede the decisions family (handoff precedence), so
  here '!' is the estimate and '+' is the reminder. This is deliberate.
*/

export type Role = "asked_by" | "waiting_on" | "delegated_to" | "assignee";
export type Kind = "commitment" | "own" | "habit" | "unassigned";

export interface ShiftWindow {
  name: string;
  startMinutes: number; // minutes past midnight, local
  endMinutes: number;
  weekdays: boolean[]; // length 7, index 0 = Sunday
}

export interface ParseContext {
  /** Today in the user's zone, "YYYY-MM-DD". */
  today: string;
  /** 0 = Sunday .. 6 = Saturday, for today. */
  todayWeekday: number;
  /** Lowercased names that already exist, so the echo can say "(new)". */
  knownProjects?: string[];
  knownPersons?: string[];
  /** R27: the default estimate ships on, so an empty estimate is announced. */
  defaultEstimateEnabled?: boolean;
  /** For the R15 caption. May be empty. */
  shifts?: ShiftWindow[];
}

export interface ParsedPerson {
  name: string;
  role: Role | null; // null when no role was given and none could be inferred
  isNew: boolean;
  roleInferred: boolean; // true when a bare role word supplied it
}

export interface ParsedReminder {
  label: string;
  offsetMinutes?: number; // present for offset reminders (+15m, +at → 0)
  absoluteTime?: string; // "HH:MM" for +9am style
}

export interface ParsedRecurrence {
  mode: "fixed" | "after_completion";
  description: string;
}

export interface EchoLine {
  field: string; // "Due", "Estimate", "Kind" ...
  text: string; // the full prose value
}

export interface ParseResult {
  title: string;
  project: { path: string[]; isNew: boolean } | null;
  people: ParsedPerson[];
  estimateMinutes: number | null;
  estimateGiven: boolean;
  doDate: string | null; // "YYYY-MM-DD"
  doDateIsToday: boolean;
  dueDate: string | null;
  dueTime: string | null; // "HH:MM"
  dueKeyword: string | null; // which preposition made it a deadline
  reminders: ParsedReminder[];
  recurrence: ParsedRecurrence | null;
  chunking: { splittable: boolean; minChunkMinutes: number | null } | null;
  deferUntil: string | null;
  kind: Kind;
  kindExplicit: boolean;
  kindCause: string; // "because Sam asked", "" for unassigned
  reason: string | null;
  echo: EchoLine[];
  caption: string | null; // R15
  warnings: string[]; // e.g. dropped reminder with no due time
}

// ---------------------------------------------------------------------------
// Shared sub-patterns for dates and times.
// ---------------------------------------------------------------------------

const MONTHS =
  "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|" +
  "aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const WEEKDAYS =
  "mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|" +
  "sat(?:urday)?|sun(?:day)?";
const DAYNUM = "\\d{1,2}(?:st|nd|rd|th)?";
const DATE_EXPR =
  `(?:tomorrow|today|(?:${WEEKDAYS})|` +
  `(?:${DAYNUM}\\s+(?:of\\s+)?(?:${MONTHS}))|` +
  `(?:(?:${MONTHS})\\s+${DAYNUM}))`;
const TIME_EXPR = "(?:\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)|\\d{1,2}:\\d{2})";

const MONTH_INDEX: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};
const WEEKDAY_INDEX: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAY_NAMES = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

// ---------------------------------------------------------------------------
// Date / time helpers. All calendar maths is done on plain Y-M-D triples so
// there is no timezone drift (dates are dates — invariant 10).
// ---------------------------------------------------------------------------

function ymd(y: number, m: number, d: number): string {
  const mm = String(m + 1).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  return `${y}-${mm}-${dd}`;
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return ymd(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate());
}

export function weekdayOf(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * "YYYY-MM-DD" for `now` in the given IANA zone. Invariant 10: a date is a
 * calendar date with no zone, and "today" must resolve in the user's zone —
 * never by reading the machine's UTC date, which is a day off whenever the
 * local date and the UTC date differ. Intl does the zone maths; en-CA formats
 * as ISO. This is the ONLY place "today" is turned into a date.
 */
export function todayInZone(timezone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Parse a bare date expression against `today`. Returns "YYYY-MM-DD" or null. */
function parseDate(expr: string, ctx: ParseContext): string | null {
  const s = expr.trim().toLowerCase();

  if (s === "today") return ctx.today;
  if (s === "tomorrow") return addDays(ctx.today, 1);

  // A weekday name → its next occurrence. R27: a weekday that names today
  // means today, not the same day next week.
  const wd = s.slice(0, 3);
  if (wd in WEEKDAY_INDEX && s.replace(/[a-z]/g, "").length === 0) {
    const target = WEEKDAY_INDEX[wd];
    const diff = (target - ctx.todayWeekday + 7) % 7; // 0 → today
    return addDays(ctx.today, diff);
  }

  // <daynum> (of) <month>  or  <month> <daynum>
  const dayFirst = s.match(
    new RegExp(`^(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTHS})$`)
  );
  const monthFirst = s.match(
    new RegExp(`^(${MONTHS})\\s+(\\d{1,2})(?:st|nd|rd|th)?$`)
  );
  let day: number | null = null;
  let monthKey: string | null = null;
  if (dayFirst) {
    day = Number(dayFirst[1]);
    monthKey = dayFirst[2].slice(0, 3);
  } else if (monthFirst) {
    monthKey = monthFirst[1].slice(0, 3);
    day = Number(monthFirst[2]);
  }
  if (day != null && monthKey != null && monthKey in MONTH_INDEX) {
    const month = MONTH_INDEX[monthKey];
    const [ty] = ctx.today.split("-").map(Number);
    // Choose the nearest year that is not in the past.
    let candidate = ymd(ty, month, day);
    if (candidate < ctx.today) candidate = ymd(ty + 1, month, day);
    return candidate;
  }

  return null;
}

/** Normalise a time expression to "HH:MM" (24h), or null. */
function parseTime(expr: string): string | null {
  const s = expr.trim().toLowerCase().replace(/\s+/g, "");
  const ampm = s.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)$/);
  if (ampm) {
    let h = Number(ampm[1]);
    const min = ampm[2] ? Number(ampm[2]) : 0;
    if (h === 12) h = 0;
    if (ampm[3] === "pm") h += 12;
    return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  }
  const hm = s.match(/^(\d{1,2}):(\d{2})$/);
  if (hm) {
    const h = Number(hm[1]);
    const min = Number(hm[2]);
    if (h > 23 || min > 59) return null;
    return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  }
  return null;
}

/** From a datetime span like "3 Sep 17:00" or "8pm today", pull date and time. */
function parseDateTime(
  span: string,
  ctx: ParseContext
): { date: string | null; time: string | null } {
  let date: string | null = null;
  let time: string | null = null;

  const timeMatch = span.match(new RegExp(TIME_EXPR, "i"));
  if (timeMatch) time = parseTime(timeMatch[0]);

  // Strip the time out before looking for a date, so "8pm" is not read as a day.
  const withoutTime = timeMatch
    ? span.replace(timeMatch[0], " ").trim()
    : span.trim();
  const dateMatch = withoutTime.match(new RegExp(DATE_EXPR, "i"));
  if (dateMatch) date = parseDate(dateMatch[0], ctx);

  return { date, time };
}

function durationToMinutes(numStr: string, unit: string): number {
  const n = Number(numStr);
  const u = unit.toLowerCase();
  if (u.startsWith("h")) return Math.round(n * 60);
  if (u.startsWith("d")) return Math.round(n * 60 * 24);
  return Math.round(n); // minutes
}

function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function humanMinutes(min: number): string {
  if (min % 60 === 0) return `${min / 60}h`;
  if (min < 60) return `${min}m`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

/** Estimate prose, in words to match the rest of the echo: "1 hour 30 minutes". */
function humanEstimate(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h} hour${h === 1 ? "" : "s"}`);
  if (m) parts.push(`${m} minute${m === 1 ? "" : "s"}`);
  return parts.length ? parts.join(" ") : "0 minutes";
}

/** "2026-08-07" → "Thursday 7 August". */
function humanDate(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${WEEKDAY_NAMES[weekdayOf(iso)]} ${d} ${MONTH_NAMES[m - 1]}`;
}

// ---------------------------------------------------------------------------
// Kind inference (R17). Exported so the capture UI can recompute it live when
// the user answers the inline role question.
// ---------------------------------------------------------------------------

export function inferKind(
  people: { role: Role | null }[],
  hasRecurrence: boolean,
  explicit: Kind | null
): { kind: Kind; explicit: boolean; cause: string } {
  if (explicit) {
    return { kind: explicit, explicit: true, cause: "you set it" };
  }
  const owed = people.find(
    (p) => p.role === "asked_by" || p.role === "delegated_to"
  );
  if (owed) {
    const verb = owed.role === "asked_by" ? "asked" : "was delegated to";
    return { kind: "commitment", explicit: false, cause: `someone ${verb} it` };
  }
  if (hasRecurrence && people.length === 0) {
    return {
      kind: "habit",
      explicit: false,
      cause: "it repeats and nobody is attached",
    };
  }
  return { kind: "unassigned", explicit: false, cause: "" };
}

/**
 * The full kind line — "commitment — because shannon asked" — from a set of
 * people. One function so the parser's echo and the live capture box print the
 * exact same words (there is exactly one kind line, R17).
 */
export function describeKind(
  people: { name?: string; role: Role | null }[],
  hasRecurrence: boolean,
  explicitKind: Kind | null
): string {
  const info = inferKind(people, hasRecurrence, explicitKind);
  const cause = info.explicit
    ? "you set it"
    : kindCauseWithNames(people, info.cause);
  return `${info.kind}${cause ? ` — ${cause}` : " — nobody attached"}`;
}

// A richer cause that names the person, when we have one.
function kindCauseWithNames(
  people: { name?: string; role: Role | null }[],
  base: string
): string {
  const owed = people.find(
    (p) => p.role === "asked_by" || p.role === "delegated_to"
  );
  if (owed) {
    const who = owed.name ?? "someone";
    return owed.role === "asked_by"
      ? `because ${who} asked`
      : `because it was delegated to ${who}`;
  }
  return base;
}

// ---------------------------------------------------------------------------
// The parser.
// ---------------------------------------------------------------------------

const ROLE_MAP: Record<string, Role> = {
  asked: "asked_by",
  waiting: "waiting_on",
  deleg: "delegated_to",
  delegated: "delegated_to",
  assign: "assignee",
  assignee: "assignee",
  assigned: "assignee",
};

const EST_UNIT = "m|min|mins|minute|minutes|h|hr|hrs|hour|hours";

export function parse(raw: string, ctx: ParseContext): ParseResult {
  const known = {
    projects: new Set((ctx.knownProjects ?? []).map((p) => p.toLowerCase())),
    persons: new Set((ctx.knownPersons ?? []).map((p) => p.toLowerCase())),
  };

  let s = ` ${raw} `; // pad so \b and space anchors behave at the ends
  const warnings: string[] = [];

  const remove = (match: string, at: number) => {
    s = s.slice(0, at) + " " + s.slice(at + match.length);
  };

  // 1. Reason — everything after '//'. Taken first so nothing else eats it.
  let reason: string | null = null;
  const reasonMatch = s.match(/\/\/\s*(.*)$/);
  if (reasonMatch) {
    reason = reasonMatch[1].trim() || null;
    s = s.slice(0, reasonMatch.index) + " ";
  }

  // 2. Chunking — before recurrence's '/'-free tokens and before '//' is gone.
  let chunking: ParseResult["chunking"] = null;
  const splitWith = s.match(
    new RegExp(`\\/split\\s+(\\d+(?:\\.\\d+)?)\\s*(${EST_UNIT})\\b`, "i")
  );
  if (splitWith) {
    chunking = {
      splittable: true,
      minChunkMinutes: durationToMinutes(splitWith[1], splitWith[2]),
    };
    remove(splitWith[0], splitWith.index!);
  } else if (/\/split\b/i.test(s)) {
    const m = s.match(/\/split\b/i)!;
    chunking = { splittable: true, minChunkMinutes: null };
    remove(m[0], m.index!);
  }
  const nosplit = s.match(/\/nosplit\b/i);
  if (nosplit) {
    chunking = { splittable: false, minChunkMinutes: null };
    remove(nosplit[0], nosplit.index!);
  }

  // 3. Recurrence — 'every' / 'every!' before dates, so "every 1st" is not a date.
  let recurrence: ParsedRecurrence | null = null;
  const recurrence_specs: {
    re: RegExp;
    build: (m: RegExpMatchArray) => string;
  }[] = [
    {
      re: new RegExp(`\\bevery(!?)\\s+(\\d{1,2})(?:st|nd|rd|th)\\b`, "i"),
      build: (m) => `on the ${m[2]}${ordinal(Number(m[2]))} of each month`,
    },
    {
      re: new RegExp(`\\bevery(!?)\\s*(\\d+)\\s*d(?:ays?)?\\b`, "i"),
      build: (m) => `every ${m[2]} days`,
    },
    {
      re: new RegExp(`\\bevery(!?)\\s+(\\d+)\\s+weeks?\\b`, "i"),
      build: (m) => `every ${m[2]} weeks`,
    },
    {
      re: new RegExp(`\\bevery(!?)\\s+(${WEEKDAYS})\\b`, "i"),
      build: (m) => `every ${cap(fullWeekday(m[2]))}`,
    },
    {
      re: new RegExp(`\\bevery(!?)\\s+(weekdays?|day|week)\\b`, "i"),
      build: (m) => `every ${m[2].toLowerCase()}`,
    },
  ];
  for (const spec of recurrence_specs) {
    const m = s.match(spec.re);
    if (m) {
      const mode = m[1] === "!" ? "after_completion" : "fixed";
      const suffix = mode === "after_completion" ? " from completion" : "";
      recurrence = { mode, description: spec.build(m) + suffix };
      remove(m[0], m.index!);
      break;
    }
  }

  // 4. Defer until — '^' then a date.
  let deferUntil: string | null = null;
  const deferMatch = s.match(new RegExp(`\\^\\s*(${DATE_EXPR})`, "i"));
  if (deferMatch) {
    deferUntil = parseDate(deferMatch[1], ctx);
    if (deferUntil) remove(deferMatch[0], deferMatch.index!);
  }

  // 5. Kind override — '*commitment' etc.
  let explicitKind: Kind | null = null;
  const kindMatch = s.match(/\*(commitment|own|habit|unassigned)\b/i);
  if (kindMatch) {
    explicitKind = kindMatch[1].toLowerCase() as Kind;
    remove(kindMatch[0], kindMatch.index!);
  }

  // 6. Reminders — '+15m', '+1d', '+at', '+9am'. Any number of them.
  const reminders: ParsedReminder[] = [];
  const reminderRe = new RegExp(
    `\\+(?:at\\b|(${TIME_EXPR})|(\\d+(?:\\.\\d+)?)\\s*(m|min|mins|h|hr|hrs|hours?|d|days?)\\b)`,
    "i"
  );
  let rm: RegExpMatchArray | null;
  while ((rm = s.match(reminderRe))) {
    if (rm[1]) {
      const t = parseTime(rm[1]);
      reminders.push({ label: `at ${t}`, absoluteTime: t ?? undefined });
    } else if (rm[2]) {
      const mins = durationToMinutes(rm[2], rm[3]);
      reminders.push({ label: `${humanMinutes(mins)} before`, offsetMinutes: mins });
    } else {
      reminders.push({ label: "at the due time", offsetMinutes: 0 });
    }
    remove(rm[0], rm.index!);
  }

  // 7. Project — '#work' or '#work/payroll'.
  let project: ParseResult["project"] = null;
  const projMatch = s.match(/#([a-z0-9_-]+)(?:\/([a-z0-9_-]+))?/i);
  if (projMatch) {
    const path = [projMatch[1]];
    if (projMatch[2]) path.push(projMatch[2]);
    const leaf = path[path.length - 1].toLowerCase();
    project = { path, isNew: !known.projects.has(leaf) };
    remove(projMatch[0], projMatch.index!);
  }

  // 8. People — '@sam' with optional ':role'.
  const people: ParsedPerson[] = [];
  const personRe = /@([a-z0-9_.-]+)(?::(asked|waiting|deleg|assign))?/i;
  let pm: RegExpMatchArray | null;
  while ((pm = s.match(personRe))) {
    const name = pm[1];
    const role = pm[2] ? ROLE_MAP[pm[2].toLowerCase()] : null;
    people.push({
      name,
      role: role ?? null,
      isNew: !known.persons.has(name.toLowerCase()),
      roleInferred: false,
    });
    remove(pm[0], pm.index!);
  }

  // 9. Estimate — '~'/'!' prefix, 'for <n> <unit>', or bare '<n> <unit>'.
  let estimateMinutes: number | null = null;
  let estimateGiven = false;
  const estPrefix = s.match(
    new RegExp(`([~!])\\s*(\\d+(?:\\.\\d+)?)\\s*(${EST_UNIT})\\b`, "i")
  );
  const estFor = s.match(
    new RegExp(`\\bfor\\s+(\\d+(?:\\.\\d+)?)\\s*(${EST_UNIT})\\b`, "i")
  );
  const estBare = s.match(
    new RegExp(`\\b(\\d+(?:\\.\\d+)?)\\s*(${EST_UNIT})\\b`, "i")
  );
  if (estPrefix) {
    estimateMinutes = durationToMinutes(estPrefix[2], estPrefix[3]);
    estimateGiven = true;
    remove(estPrefix[0], estPrefix.index!);
  } else if (estFor) {
    estimateMinutes = durationToMinutes(estFor[1], estFor[2]);
    estimateGiven = true;
    remove(estFor[0], estFor.index!);
  } else if (estBare) {
    estimateMinutes = durationToMinutes(estBare[1], estBare[2]);
    estimateGiven = true;
    remove(estBare[0], estBare.index!);
  }

  // 10. Due date + time carried by a preposition (R27: four of them).
  let dueDate: string | null = null;
  let dueTime: string | null = null;
  let dueKeyword: string | null = null;
  const DATETIME =
    `(?:(?:${DATE_EXPR})(?:\\s+(?:${TIME_EXPR}))?|(?:${TIME_EXPR})(?:\\s+(?:${DATE_EXPR}))?)`;
  const dueMatch = s.match(
    new RegExp(`\\b(by|before|due|no later than)\\s+(${DATETIME})`, "i")
  );
  if (dueMatch) {
    dueKeyword = dueMatch[1].toLowerCase();
    const { date, time } = parseDateTime(dueMatch[2], ctx);
    dueDate = date;
    dueTime = time;
    // A due time with no date means today (R27: an hour is a deadline).
    if (dueTime && !dueDate) dueDate = ctx.today;
    remove(dueMatch[0], dueMatch.index!);
  }

  // 11. A bare hour is a due time today (R27). 'at 15:30' or '9am' or '8pm today'.
  if (!dueTime) {
    const atTime = s.match(new RegExp(`\\bat\\s+(${TIME_EXPR})\\b`, "i"));
    const bareTime = s.match(
      new RegExp(`\\b(${TIME_EXPR})(?:\\s+today)?\\b`, "i")
    );
    const chosen = atTime ?? bareTime;
    if (chosen) {
      dueTime = parseTime(chosen[1]);
      if (dueTime) {
        if (!dueDate) dueDate = ctx.today;
        remove(chosen[0], chosen.index!);
      }
    }
  }

  // 12. A bare date is a do date (R16). Whatever is left that reads as a date.
  let doDate: string | null = null;
  let doDateIsToday = false;
  const doMatch = s.match(new RegExp(`\\b(${DATE_EXPR})\\b`, "i"));
  if (doMatch) {
    const parsed = parseDate(doMatch[1], ctx);
    if (parsed) {
      doDate = parsed;
      doDateIsToday = parsed === ctx.today;
      remove(doMatch[0], doMatch.index!);
    }
  }

  // 13. Bare role words bind to a person that has no role yet (R27). Only
  // consumed when a person is actually waiting for one — otherwise an ordinary
  // "waiting" in a title would be stripped, which invariant 13 forbids.
  const roleWordRe = /\b(asked|delegated|waiting|assignee|assigned)\b/i;
  const needRole = people.filter((p) => p.role === null);
  let assigned = 0;
  while (assigned < needRole.length) {
    const rw = s.match(roleWordRe);
    if (!rw) break;
    needRole[assigned].role = ROLE_MAP[rw[1].toLowerCase()];
    needRole[assigned].roleInferred = true;
    remove(rw[0], rw.index!);
    assigned++;
  }

  // 14. Whatever survives is the title (invariant 13).
  const title = s.replace(/\s+/g, " ").trim();

  // Reminders need a time to be an offset from. Drop and warn otherwise (R25:
  // reminders fall back to 00:00 on the date, so a due DATE is enough).
  const keptReminders: ParsedReminder[] = [];
  for (const r of reminders) {
    if (r.offsetMinutes != null && r.offsetMinutes !== 0 && !dueDate && !dueTime) {
      warnings.push(`${r.label}: needs a due date — reminder dropped`);
    } else {
      keptReminders.push(r);
    }
  }

  // Kind (R17).
  const inferred = inferKind(people, recurrence != null, explicitKind);
  const kindCause = inferred.explicit
    ? "you set it"
    : kindCauseWithNames(people, inferred.cause);

  // R15 caption: a due time outside every shift on its date.
  const caption = computeCaption(dueDate, dueTime, ctx);

  // Build the echo (prose, in reading order).
  const echo = buildEcho({
    project,
    people,
    estimateMinutes,
    estimateGiven,
    defaultEstimateEnabled: ctx.defaultEstimateEnabled ?? false,
    doDate,
    doDateIsToday,
    dueDate,
    dueTime,
    dueKeyword,
    reminders: keptReminders,
    recurrence,
    chunking,
    deferUntil,
    kind: inferred.kind,
    kindExplicit: inferred.explicit,
    kindCause,
    reason,
  });

  return {
    title,
    project,
    people,
    estimateMinutes,
    estimateGiven,
    doDate,
    doDateIsToday,
    dueDate,
    dueTime,
    dueKeyword,
    reminders: keptReminders,
    recurrence,
    chunking,
    deferUntil,
    kind: inferred.kind,
    kindExplicit: inferred.explicit,
    kindCause,
    reason,
    echo,
    caption,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// R15 — one caption when a due time falls outside every shift on its date.
// ---------------------------------------------------------------------------

/**
 * Is a minute-of-day inside a window? Handles the two R29 cases:
 *  - start === end is the whole day (waking hours default to 00:00–00:00), so
 *    everything is inside and R15 never speaks.
 *  - a window may cross midnight (11:00–03:00), so "inside" wraps.
 */
function withinWindow(mins: number, start: number, end: number): boolean {
  if (start === end) return true; // full day
  if (start < end) return mins >= start && mins < end;
  return mins >= start || mins < end; // crosses midnight
}

export function computeCaption(
  dueDate: string | null,
  dueTime: string | null,
  ctx: ParseContext
): string | null {
  if (!dueTime) return null; // no hour, nothing to be outside of
  const shifts = ctx.shifts ?? [];
  if (shifts.length === 0) return null; // nothing to check against
  const dateIso = dueDate ?? ctx.today;
  const wd = weekdayOf(dateIso);
  const mins = timeToMinutes(dueTime);
  const onThatDay = shifts.filter((sh) => sh.weekdays[wd]);
  if (onThatDay.length === 0) return null;
  const inside = onThatDay.some((sh) =>
    withinWindow(mins, sh.startMinutes, sh.endMinutes)
  );
  if (inside) return null;
  return `${dueTime} is outside your shifts on ${WEEKDAY_NAMES[wd]}`;
}

// ---------------------------------------------------------------------------
// Echo building.
// ---------------------------------------------------------------------------

function roleLabel(role: Role | null): string {
  switch (role) {
    case "asked_by": return "Asked by";
    case "waiting_on": return "Waiting on";
    case "delegated_to": return "Delegated to";
    case "assignee": return "Assignee";
    default: return "Person";
  }
}

interface EchoInput {
  project: ParseResult["project"];
  people: ParsedPerson[];
  estimateMinutes: number | null;
  estimateGiven: boolean;
  defaultEstimateEnabled: boolean;
  doDate: string | null;
  doDateIsToday: boolean;
  dueDate: string | null;
  dueTime: string | null;
  dueKeyword: string | null;
  reminders: ParsedReminder[];
  recurrence: ParsedRecurrence | null;
  chunking: ParseResult["chunking"];
  deferUntil: string | null;
  kind: Kind;
  kindExplicit: boolean;
  kindCause: string;
  reason: string | null;
}

function buildEcho(i: EchoInput): EchoLine[] {
  const lines: EchoLine[] = [];

  if (i.project) {
    const label = i.project.path.length > 1 ? "Sub-project" : "Project";
    const text =
      i.project.path.join(" / ") + (i.project.isNew ? " (new)" : "");
    lines.push({ field: label, text });
  }

  for (const p of i.people) {
    if (p.role === null) {
      lines.push({ field: "Person", text: `${p.name} — pick a role` });
    } else {
      const suffix = p.isNew ? " (new)" : "";
      lines.push({ field: roleLabel(p.role), text: `${p.name}${suffix}` });
    }
  }

  if (i.doDate) {
    const text = humanDate(i.doDate) + (i.doDateIsToday ? " (today)" : "");
    lines.push({ field: "Do date", text: `${text} — the day you work on it` });
  }

  if (i.dueDate || i.dueTime) {
    let text = "";
    if (i.dueDate) text += humanDate(i.dueDate);
    if (i.dueTime) text += `${i.dueDate ? " at " : ""}${i.dueTime}`;
    if (i.dueKeyword) text += ` — “${i.dueKeyword}” makes it a deadline`;
    lines.push({ field: "Due", text });
  }

  if (i.estimateGiven && i.estimateMinutes != null) {
    lines.push({ field: "Estimate", text: humanEstimate(i.estimateMinutes) });
  } else if (i.defaultEstimateEnabled) {
    // R27: announce the empty estimate in the same list as everything else.
    lines.push({
      field: "Estimate",
      text:
        "none given — the default for this category will be used, and you can correct it",
    });
  }

  for (const r of i.reminders) {
    lines.push({ field: "Reminder", text: r.label });
  }

  if (i.recurrence) {
    const kind = i.recurrence.mode === "fixed" ? "fixed dates" : "after completion";
    lines.push({ field: "Repeats", text: `${i.recurrence.description} (${kind})` });
  }

  if (i.chunking) {
    if (!i.chunking.splittable) {
      lines.push({ field: "Shape", text: "one run — won’t split" });
    } else if (i.chunking.minChunkMinutes != null) {
      lines.push({
        field: "Shape",
        text: `splittable — smallest piece ${humanMinutes(i.chunking.minChunkMinutes)}`,
      });
    } else {
      lines.push({ field: "Shape", text: "splittable" });
    }
  }

  if (i.deferUntil) {
    lines.push({
      field: "Hidden until",
      text: `${humanDate(i.deferUntil)} — absent until then`,
    });
  }

  // Kind is always printed (R17: the inference is never silent).
  const causeText = i.kindCause ? ` — ${i.kindCause}` : " — nobody attached";
  lines.push({ field: "Kind", text: `${i.kind}${causeText}` });

  if (i.reason) {
    lines.push({ field: "Reason", text: i.reason });
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Small string helpers.
// ---------------------------------------------------------------------------

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] ?? s[v] ?? s[0];
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function fullWeekday(abbrev: string): string {
  const idx = WEEKDAY_INDEX[abbrev.slice(0, 3).toLowerCase()];
  return idx != null ? WEEKDAY_NAMES[idx] : abbrev;
}
