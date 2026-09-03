import { prisma } from "./prisma";
import { mutate, type UndoOp, type Tx } from "./mutate";
import {
  computeTaskDueInstant,
  startReminderFireAt,
  type CommitmentPerson,
} from "./clock";
import { getUserZone } from "./clock-service";

/*
  WP13 · the start reminder (R22). This is the seam WP12 flagged: the start
  reminder's fire instant is the SAFE START, and the safe start is derived from
  due_at_utc — which already carries the governing person's zone (invariant 11) —
  and NOT from reminders.ts computeFireTime, which reads the user's zone. So the
  start reminder does not travel the ordinary reschedule path; it lives here.

  The whole guarantee (reminders.md): "no missed commitments is the day-sixty
  test, and a guarantee you can forget to switch on is not a guarantee." So every
  commitment with a due date is armed with one, on unless you remove it.

  Three facts decide the row:
    - it is armed only on a COMMITMENT (R24: kind decides whether one is armed)
      that HAS a due date;
    - its fire instant is startReminderFireAt(due_at_utc, estimate) — recomputed
      whenever the estimate, the due time or the governing person's zone changes,
      because every one of those moves the safe start;
    - it is "on unless you remove it": a removed start reminder is a DISABLED
      isStartReminder row, and that disabled row is a tombstone every arming and
      recompute pass must respect, so a later edit never silently re-arms one the
      user deliberately took off.

  Idempotence falls out of "one start reminder row per task": there is at most one
  isStartReminder row on a task, so a create only happens when none exists, and
  every later pass updates or leaves that single row. Two start reminders on one
  task is therefore impossible.
*/

// ---------------------------------------------------------------------------
// The row as the planner sees it (only the fields it reads / restores).
// ---------------------------------------------------------------------------

export interface ExistingStartReminder {
  id: string;
  enabled: boolean;
  offsetMinutes: number | null;
  nextFireAtUtc: Date | null;
}

export interface StartReminderCreate {
  id: string;
  taskId: string;
  offsetMinutes: number | null;
  nextFireAtUtc: Date | null;
}

export interface StartReminderPlan {
  /** update ops on the existing row (fold into the caller's mutate apply). */
  apply: UndoOp[];
  /** the reverse of `apply` / `create` (fold into the caller's undo payload). */
  undo: UndoOp[];
  /** a fresh start-reminder row to create, or null. */
  create: StartReminderCreate | null;
}

const EMPTY: StartReminderPlan = { apply: [], undo: [], create: null };

function sameInstant(a: Date | null, b: Date | null): boolean {
  return (a?.getTime() ?? null) === (b?.getTime() ?? null);
}

// ---------------------------------------------------------------------------
// The pure planner. No database — this is the arithmetic a silent bug lives in
// (no estimate, no due time, a deliberately-removed start reminder that must not
// re-arm, an estimate edit that moves the instant), so it is unit-tested alone.
// ---------------------------------------------------------------------------

/**
 * The reversible ops to bring a task's single start-reminder row in line with the
 * facts. `existing` is the isStartReminder row on the task (enabled OR disabled),
 * or null when there is none.
 *
 *   - no row, and the task should have one (a commitment with a due date) → create.
 *   - no row, and it should not               → nothing.
 *   - a DISABLED row (the user removed it)     → nothing. The tombstone stands, so
 *                                                no edit ever re-arms it.
 *   - an ENABLED row                           → recompute its fire instant. If the
 *                                                task no longer warrants one (its
 *                                                due date was cleared) the instant
 *                                                becomes null so it cannot fire,
 *                                                but the row stays enabled so
 *                                                re-adding a due date re-arms it —
 *                                                only the user disabling it is a
 *                                                tombstone.
 */
export function planStartReminder(opts: {
  taskId: string;
  kind: string;
  dueAtUtc: Date | null;
  estimateMinutes: number | null;
  existing: ExistingStartReminder | null;
  newId: string;
}): StartReminderPlan {
  const wants = opts.kind === "commitment" && opts.dueAtUtc != null;
  const fireAt = startReminderFireAt(opts.dueAtUtc, opts.estimateMinutes);
  // The estimate is stored as the offset for the record (its offset IS the
  // estimate — reminders.md), even though the fire instant is computed directly.
  const offset = opts.estimateMinutes;

  if (!opts.existing) {
    if (!wants) return EMPTY;
    return {
      apply: [],
      create: { id: opts.newId, taskId: opts.taskId, offsetMinutes: offset, nextFireAtUtc: fireAt },
      undo: [{ action: "deleteRow", model: "reminder", id: opts.newId }],
    };
  }

  // "On unless you remove it": a disabled start reminder is the user's tombstone.
  if (!opts.existing.enabled) return EMPTY;

  const nextFire = wants ? fireAt : null;
  if (sameInstant(nextFire, opts.existing.nextFireAtUtc) && offset === opts.existing.offsetMinutes) {
    return EMPTY; // nothing moved — no spurious write, no spurious undo step
  }
  return {
    apply: [
      {
        action: "update",
        model: "reminder",
        id: opts.existing.id,
        data: { offsetMinutes: offset, nextFireAtUtc: nextFire },
      },
    ],
    undo: [
      {
        action: "update",
        model: "reminder",
        id: opts.existing.id,
        data: { offsetMinutes: opts.existing.offsetMinutes, nextFireAtUtc: opts.existing.nextFireAtUtc },
      },
    ],
    create: null,
  };
}

// ---------------------------------------------------------------------------
// The database seam: read the row, produce a plan, apply a plan.
// ---------------------------------------------------------------------------

/** The one start-reminder row on a task, enabled or not (the tombstone counts).
 *  There is at most one; the arming logic keeps it that way. */
export async function getStartReminderRow(taskId: string): Promise<ExistingStartReminder | null> {
  const r = await prisma.reminder.findFirst({
    where: { taskId, isStartReminder: true },
    select: { id: true, enabled: true, offsetMinutes: true, nextFireAtUtc: true },
    orderBy: { createdAt: "asc" },
  });
  return r;
}

/**
 * Build the plan for one task from the facts, reading its existing start-reminder
 * row. Used by every single-task path (capture passes existing=null itself; the
 * edits read the row here).
 */
export async function startReminderSyncOps(opts: {
  taskId: string;
  kind: string;
  dueAtUtc: Date | null;
  estimateMinutes: number | null;
}): Promise<StartReminderPlan> {
  const existing = await getStartReminderRow(opts.taskId);
  return planStartReminder({ ...opts, existing, newId: crypto.randomUUID() });
}

/** Apply a plan inside a mutate's transaction: create the row and/or update it.
 *  The undo ops live on the mutate's undo payload, not here. */
export async function applyStartReminderPlan(tx: Tx, plan: StartReminderPlan): Promise<void> {
  if (plan.create) {
    await tx.reminder.create({
      data: {
        id: plan.create.id,
        taskId: plan.create.taskId,
        offsetMinutes: plan.create.offsetMinutes,
        absoluteAt: null,
        isStartReminder: true,
        enabled: true,
        nextFireAtUtc: plan.create.nextFireAtUtc,
      },
    });
  }
  for (const op of plan.apply) {
    if (op.action === "update") {
      await tx.reminder.update({ where: { id: op.id }, data: op.data });
    }
  }
}

// ---------------------------------------------------------------------------
// A governing person's zone change → recompute (or arm) the start reminder of
// every active dated commitment of theirs, mirroring clock-service's
// recomputeCommitmentsForPersonOps so the two fold into the SAME mutate and
// reverse together.
// ---------------------------------------------------------------------------

/**
 * The reversible ops for the start reminders of every ACTIVE dated task a person
 * is attached to, after their zone changed. Each task's new due instant is
 * recomputed with the person's NEW zone (the DB still holds the old value in the
 * same mutate), then its start reminder is re-planned against that instant. A
 * commitment that has no start reminder yet is armed; a disabled one is left; an
 * enabled one is moved. Returns everything folded so the person edit and every
 * moved start reminder reverse from one ledger line.
 */
export async function recomputeStartRemindersForPersonOps(
  personId: string,
  opts: { newZone?: string | null } = {}
): Promise<{ apply: UndoOp[]; undo: UndoOp[]; creates: StartReminderCreate[] }> {
  const userZone = await getUserZone();
  const links = await prisma.taskPerson.findMany({
    where: { personId, task: { deletedAt: null, status: "active", dueDate: { not: null } } },
    select: { taskId: true },
    distinct: ["taskId"],
  });
  const taskIds = links.map((l) => l.taskId);
  if (taskIds.length === 0) return { apply: [], undo: [], creates: [] };

  const [tasks, startRows] = await Promise.all([
    prisma.task.findMany({
      where: { id: { in: taskIds } },
      include: { taskPeople: { include: { person: { select: { id: true, timezone: true } } } } },
    }),
    prisma.reminder.findMany({
      where: { taskId: { in: taskIds }, isStartReminder: true },
      select: { id: true, taskId: true, enabled: true, offsetMinutes: true, nextFireAtUtc: true },
    }),
  ]);
  const startByTask = new Map(startRows.map((r) => [r.taskId, r]));

  const apply: UndoOp[] = [];
  const undo: UndoOp[] = [];
  const creates: StartReminderCreate[] = [];
  for (const t of tasks) {
    const people: CommitmentPerson[] = t.taskPeople.map((tp) => ({
      role: tp.role,
      timezone:
        tp.person.id === personId && opts.newZone !== undefined ? opts.newZone : tp.person.timezone,
    }));
    const instant = computeTaskDueInstant({
      dueDate: isoOf(t.dueDate),
      dueTime: t.dueTime,
      people,
      userZone,
    });
    const existing = startByTask.get(t.id);
    const plan = planStartReminder({
      taskId: t.id,
      kind: t.kind,
      dueAtUtc: instant.dueAtUtc,
      estimateMinutes: t.estimateMinutes,
      existing: existing
        ? {
            id: existing.id,
            enabled: existing.enabled,
            offsetMinutes: existing.offsetMinutes,
            nextFireAtUtc: existing.nextFireAtUtc,
          }
        : null,
      newId: crypto.randomUUID(),
    });
    apply.push(...plan.apply);
    undo.push(...plan.undo);
    if (plan.create) creates.push(plan.create);
  }
  return { apply, undo, creates };
}

// ---------------------------------------------------------------------------
// The one pass over existing commitments (R22: "Existing commitments armed in one
// pass"). Modelled on clock-service's backfillDueInstants — run from /api/tick,
// idempotent, one activity row, nothing to undo.
// ---------------------------------------------------------------------------

/**
 * Arm a start reminder on every active commitment with a due date that has no
 * start-reminder row yet. Idempotent: a task that already has one (enabled OR the
 * removed-tombstone) is skipped, so the pass converges once and does nothing on
 * later runs, and it never re-arms one the user removed. Runs after
 * backfillDueInstants in the tick so due_at_utc is already filled when the safe
 * start is read.
 */
export async function armExistingStartReminders(): Promise<{ armed: number }> {
  const commitments = await prisma.task.findMany({
    where: {
      deletedAt: null,
      status: "active",
      kind: "commitment",
      dueDate: { not: null },
      // No start-reminder row at all — enabled or tombstoned — means never armed.
      reminders: { none: { isStartReminder: true } },
    },
    select: { id: true, dueAtUtc: true, estimateMinutes: true },
  });
  if (commitments.length === 0) return { armed: 0 };

  const creates: StartReminderCreate[] = commitments.map((t) => ({
    id: crypto.randomUUID(),
    taskId: t.id,
    offsetMinutes: t.estimateMinutes,
    nextFireAtUtc: startReminderFireAt(t.dueAtUtc, t.estimateMinutes),
  }));

  await mutate({
    actor: { kind: "app" },
    verb: "reminder.startReminder.arm",
    filterKind: "reminders",
    summary: `Armed a start reminder on ${creates.length} existing commitment${
      creates.length === 1 ? "" : "s"
    }`,
    // A guarantee turned on for existing work — not a single reversible user edit.
    undo: { ops: [] },
    undoTtlMs: 0,
    apply: async (tx) => {
      for (const c of creates) {
        await tx.reminder.create({
          data: {
            id: c.id,
            taskId: c.taskId,
            offsetMinutes: c.offsetMinutes,
            absoluteAt: null,
            isStartReminder: true,
            enabled: true,
            nextFireAtUtc: c.nextFireAtUtc,
          },
        });
      }
    },
  });

  return { armed: creates.length };
}

/** A @db.Date column (midnight UTC) back to "YYYY-MM-DD". */
function isoOf(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}
