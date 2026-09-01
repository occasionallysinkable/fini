import { prisma } from "./prisma";
import { mutate, type Tx, type UndoOp } from "./mutate";
import { todayInZone } from "./parse";
import {
  nextOccurrence,
  nextOccurrenceOnOrAfter,
  describeRule,
  type RecurrenceSpec,
  type RecurrencePattern,
  type RecurrenceMode,
} from "./recurrence";
import {
  computeFireTime,
  wallToUtc,
} from "./reminders";

/** The user's IANA zone (invariant 12 — read, never hard-coded). Kept local so
 *  this module does not depend on reminder-service, which depends on this one for
 *  the completion spawn — one-way, no import cycle. */
async function getTimeZone(): Promise<string> {
  const user = await prisma.user.findFirst({ select: { timezone: true } });
  return user?.timezone ?? "UTC";
}

/*
  WP8 · the seam between the recurrence arithmetic (recurrence.ts, pure) and the
  database rows. The rule is stored apart from every occurrence (schema ·
  recurrence_rule; decisions · "The rule is stored apart from each occurrence"),
  and each occurrence is an ordinary task pointing back at it with the date it was
  stamped for.

  Three jobs live here:
    1. buildRecurrenceCreate — capture folds a new rule + its first occurrence in.
    2. spawnNextOccurrenceOps — completing a recurring task folds in the next one,
       so the completion and the next occurrence reverse as one ledger line.
    3. rollMissedOccurrences — the tick's sweep: a non-commitment occurrence whose
       date has passed is skipped (not stacked), and the series jumps to its first
       still-future date (decisions · "Missed occurrences do not pile up").

  Every write goes through mutate() (invariant 1). Nothing here imports Prisma
  into app code — this is a lib module, the same tier as reminder-service.
*/

// Local string unions so this module does not force @prisma/client on callers,
// matching the pattern the board actions use.
type TaskKind = "commitment" | "own" | "habit" | "unassigned";
type TaskRole = "asked_by" | "waiting_on" | "delegated_to" | "assignee";
type SetBy = "user" | "app";

// ---------------------------------------------------------------------------
// The template each occurrence inherits (schema · recurrence_rule.template). It
// is the source of truth for what a new occurrence looks like — occurrences do
// not copy each other, so an edit to one live occurrence never leaks into the
// next. The reason is carried here so it is given once and never re-asked
// (decisions · "Reasons are inherited").
// ---------------------------------------------------------------------------

type TemplateReminder =
  | { kind: "offset"; offsetMinutes: number }
  | { kind: "absolute"; time: string };

export interface RecurrenceTemplate {
  title: string;
  projectId: string | null;
  categoryId: string | null;
  kind: TaskKind;
  kindIsExplicit: boolean;
  reason: string | null;
  estimateMinutes: number | null;
  splittable: boolean;
  minChunkMinutes: number | null;
  dueTime: string | null; // "HH:MM"
  /** Whether the occurrence date lands on due_date (a deadline) or do_date (the
   *  day you work on it). Fixed once, at capture, from the captured task. */
  dateKind: "due" | "do";
  people: { personId: string; role: TaskRole }[];
  reminders: TemplateReminder[];
}

// A date column is stored midnight-UTC; these convert both ways (invariant 10).
function isoToDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}
function dateToIso(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
function humanDate(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTH_NAMES[m - 1]}`;
}

// ---------------------------------------------------------------------------
// 1 · Capture. Given the parsed rule and the resolved task fields, produce the
// rule row to create, the first occurrence's date, and where that date lands.
// The capture mutate creates the rule, then the first occurrence task pointing at
// it; the undo deletes both.
// ---------------------------------------------------------------------------

export interface CapturedRecurrenceInput {
  spec: RecurrenceSpec;
  today: string;
  template: RecurrenceTemplate;
}

export interface CapturedRecurrencePlan {
  ruleId: string;
  ruleData: {
    id: string;
    pattern: RecurrencePattern;
    weekdays: boolean[];
    dayOfMonth: number | null;
    n: number | null;
    mode: RecurrenceMode;
    template: RecurrenceTemplate;
  };
  firstDate: string; // ISO
  /** How the first occurrence task's date columns are set. */
  occurrence: {
    occurrenceDate: Date;
    dueDate: Date | null;
    doDate: Date | null;
    doDateSetBy: SetBy | null;
  };
  /** The undo op that removes the rule (the task's own delete is the caller's). */
  ruleUndo: UndoOp;
}

/** Pure plan for a captured recurrence — no database, so capture keeps building
 *  its single undo payload before it writes. `firstOccurrenceOnOrAfter` chose the
 *  first date; here it is only placed onto the right columns. */
export function planCapturedRecurrence(
  input: CapturedRecurrenceInput & { firstDate: string }
): CapturedRecurrencePlan {
  const ruleId = crypto.randomUUID();
  const firstDate = input.firstDate;
  const onDue = input.template.dateKind === "due";
  return {
    ruleId,
    ruleData: {
      id: ruleId,
      pattern: input.spec.pattern,
      weekdays: input.spec.weekdays,
      dayOfMonth: input.spec.dayOfMonth,
      n: input.spec.n,
      mode: input.spec.mode,
      template: input.template,
    },
    firstDate,
    occurrence: {
      occurrenceDate: isoToDate(firstDate),
      dueDate: onDue ? isoToDate(firstDate) : null,
      doDate: onDue ? null : isoToDate(firstDate),
      doDateSetBy: onDue ? null : "app",
    },
    ruleUndo: { action: "deleteRow", model: "recurrenceRule", id: ruleId },
  };
}

// ---------------------------------------------------------------------------
// Building an occurrence task from a template on a given date — shared by the
// completion spawn and the missed-occurrence roll. Returns everything needed to
// create the task, its people and its reminders inside a transaction, plus the
// undo ops that remove them (FK-safe order: reminders, links, task).
// ---------------------------------------------------------------------------

interface OccurrenceBuild {
  taskId: string;
  run: (tx: Tx) => Promise<void>;
  undo: UndoOp[];
  date: string;
}

async function buildOccurrence(
  ruleId: string,
  template: RecurrenceTemplate,
  date: string,
  timeZone: string
): Promise<OccurrenceBuild> {
  const taskId = crypto.randomUUID();
  const onDue = template.dateKind === "due";

  // Position at the end of the project's order (WP3), like any new task.
  const last = await prisma.task.aggregate({
    where: { projectId: template.projectId, deletedAt: null },
    _max: { position: true },
  });
  const position = (last._max.position ?? -1) + 1;

  // Only attach people who still exist — a person deleted since capture is
  // simply dropped rather than dangling a foreign key.
  const wantedIds = template.people.map((p) => p.personId);
  const present = wantedIds.length
    ? await prisma.person.findMany({ where: { id: { in: wantedIds } }, select: { id: true } })
    : [];
  const presentIds = new Set(present.map((p) => p.id));
  const people = template.people.filter((p) => presentIds.has(p.personId));

  // Reminders: offset reminders recompute against the new date's due time;
  // absolute reminders re-anchor their wall-clock time onto the new date.
  const reminders: {
    id: string;
    offsetMinutes: number | null;
    absoluteAt: Date | null;
    nextFireAtUtc: Date | null;
  }[] = [];
  for (const r of template.reminders) {
    if (r.kind === "offset") {
      const nextFireAtUtc = computeFireTime({
        dueDate: onDue ? date : null,
        dueTime: template.dueTime,
        timeZone,
        offsetMinutes: r.offsetMinutes,
      });
      if (nextFireAtUtc) {
        reminders.push({ id: crypto.randomUUID(), offsetMinutes: r.offsetMinutes, absoluteAt: null, nextFireAtUtc });
      }
    } else {
      const absoluteAt = wallToUtc(date, r.time, timeZone);
      reminders.push({ id: crypto.randomUUID(), offsetMinutes: null, absoluteAt, nextFireAtUtc: absoluteAt });
    }
  }

  const undo: UndoOp[] = [
    ...reminders.map((r) => ({ action: "deleteRow" as const, model: "reminder" as const, id: r.id })),
    { action: "deleteWhere", model: "taskPerson", where: { taskId } },
    { action: "deleteRow", model: "task", id: taskId },
  ];

  const run = async (tx: Tx) => {
    await tx.task.create({
      data: {
        id: taskId,
        title: template.title,
        position,
        projectId: template.projectId,
        categoryId: template.categoryId,
        kind: template.kind,
        kindIsExplicit: template.kindIsExplicit,
        reason: template.reason,
        source: "typed",
        recurrenceRuleId: ruleId,
        occurrenceDate: isoToDate(date),
        dueDate: onDue ? isoToDate(date) : null,
        dueTime: template.dueTime,
        doDate: onDue ? null : isoToDate(date),
        doDateSetBy: onDue ? null : "app",
        estimateMinutes: template.estimateMinutes,
        splittable: template.splittable,
        minChunkMinutes: template.minChunkMinutes,
      },
    });
    for (const p of people) {
      await tx.taskPerson.create({ data: { taskId, personId: p.personId, role: p.role } });
    }
    for (const r of reminders) {
      await tx.reminder.create({ data: { id: r.id, taskId, offsetMinutes: r.offsetMinutes, absoluteAt: r.absoluteAt, nextFireAtUtc: r.nextFireAtUtc } });
    }
  };

  return { taskId, run, undo, date };
}

// ---------------------------------------------------------------------------
// 2 · Completion spawns the next occurrence. Returned as ops so the caller folds
// them into the SAME mutate that marks the task done — the completion and the
// next occurrence then reverse together from one ledger line.
// ---------------------------------------------------------------------------

export interface SpawnOps {
  run: (tx: Tx) => Promise<void>;
  undo: UndoOp[];
  summary: string;
  nextDate: string;
}

/**
 * The next occurrence for a task that is being completed, or null when the task
 * is not on a recurrence rule. Fixed series count from the occurrence's own
 * scheduled date (and never spawn into the past — `nextOccurrenceOnOrAfter`
 * guards a late completion); after-completion series count from the completion
 * date, so finishing late genuinely pushes the next date out.
 */
export async function spawnNextOccurrenceOps(
  taskId: string,
  now: Date = new Date()
): Promise<SpawnOps | null> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, occurrenceDate: true, recurrenceRule: true },
  });
  if (!task?.recurrenceRule || !task.occurrenceDate) return null;

  const rule = task.recurrenceRule;
  const spec: RecurrenceSpec = {
    pattern: rule.pattern,
    weekdays: rule.weekdays,
    dayOfMonth: rule.dayOfMonth,
    n: rule.n,
    mode: rule.mode,
  };
  const template = rule.template as unknown as RecurrenceTemplate;
  const timeZone = await getTimeZone();
  // The completion date is today in the user's zone (invariant 10).
  const today = todayInZone(timeZone, now);
  const scheduledIso = dateToIso(task.occurrenceDate)!;

  const nextDate =
    rule.mode === "fixed"
      ? nextOccurrenceOnOrAfter(spec, scheduledIso, today)
      : nextOccurrence(spec, today);

  const occ = await buildOccurrence(rule.id, template, nextDate, timeZone);
  return {
    run: occ.run,
    undo: occ.undo,
    summary: `Next “${template.title}” scheduled for ${humanDate(nextDate)}`,
    nextDate,
  };
}

// ---------------------------------------------------------------------------
// 3 · The missed-occurrence sweep (the tick calls this every minute). A
// non-commitment occurrence whose date has passed is skipped — its row is
// cancelled (a missed habit is gone) and the series is advanced to its first
// still-future date, so misses collapse to one instead of stacking. Commitments
// are deliberately left alone: a missed promise is a real problem the app must
// not silently erase (decisions · "no missed commitments is the day-sixty test").
// ---------------------------------------------------------------------------

export interface RollResult {
  skipped: number;
}

export async function rollMissedOccurrences(now: Date = new Date()): Promise<RollResult> {
  const timeZone = await getTimeZone();
  const today = todayInZone(timeZone, now);
  const todayDate = isoToDate(today);

  const stale = await prisma.task.findMany({
    where: {
      status: "active",
      deletedAt: null,
      recurrenceRuleId: { not: null },
      occurrenceDate: { lt: todayDate },
      kind: { not: "commitment" },
      recurrenceRule: { is: { mode: "fixed" } },
    },
    select: { id: true, title: true, status: true, occurrenceDate: true, recurrenceRule: true },
  });

  let skipped = 0;
  for (const t of stale) {
    if (!t.recurrenceRule || !t.occurrenceDate) continue;
    const rule = t.recurrenceRule;
    const spec: RecurrenceSpec = {
      pattern: rule.pattern,
      weekdays: rule.weekdays,
      dayOfMonth: rule.dayOfMonth,
      n: rule.n,
      mode: rule.mode,
    };
    const template = rule.template as unknown as RecurrenceTemplate;
    const scheduledIso = dateToIso(t.occurrenceDate)!;
    const nextDate = nextOccurrenceOnOrAfter(spec, scheduledIso, today);

    const occ = await buildOccurrence(rule.id, template, nextDate, timeZone);
    const priorStatus = t.status;

    await mutate({
      actor: { kind: "app" },
      verb: "recurrence.skip",
      taskId: t.id,
      summary: `Skipped “${t.title}” for ${humanDate(scheduledIso)} — ${describeRule(spec)}; next is ${humanDate(nextDate)}`,
      undo: {
        ops: [
          // Reverse the spawn first (delete the new occurrence), then restore the
          // skipped occurrence to active.
          ...occ.undo,
          { action: "update", model: "task", id: t.id, data: { status: priorStatus } },
        ],
      },
      apply: async (tx) => {
        await tx.task.update({ where: { id: t.id }, data: { status: "cancelled" } });
        await occ.run(tx);
      },
    });
    skipped += 1;
  }

  return { skipped };
}

// ---------------------------------------------------------------------------
// Habit completion history (R18): "done N times · last on <date>", counted from
// the done occurrences of the same rule. No pace, no target, no streak — a habit
// nobody is waiting on shows history and nothing else.
// ---------------------------------------------------------------------------

export interface HabitHistory {
  doneCount: number;
  lastDoneIso: string | null;
}

export async function getHabitHistory(ruleId: string): Promise<HabitHistory> {
  const [doneCount, latest] = await Promise.all([
    prisma.task.count({ where: { recurrenceRuleId: ruleId, status: "done" } }),
    prisma.task.findFirst({
      where: { recurrenceRuleId: ruleId, status: "done" },
      orderBy: { completedAt: "desc" },
      select: { completedAt: true, occurrenceDate: true },
    }),
  ]);
  const last = latest?.completedAt ?? latest?.occurrenceDate ?? null;
  return { doneCount, lastDoneIso: last ? last.toISOString().slice(0, 10) : null };
}
