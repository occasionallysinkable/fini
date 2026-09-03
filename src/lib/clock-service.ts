import { prisma } from "./prisma";
import { mutate, type UndoOp } from "./mutate";
import {
  computeTaskDueInstant,
  type CommitmentPerson,
  type DueInstant,
} from "./clock";

/*
  WP12 · the seam between the pure invariant-11 clock (clock.ts) and the Prisma
  rows. The clock decides the instant; this module reads the people and the
  user's zone it needs, and produces the reversible ops the write paths fold into
  their own mutate() so a due-date move (or a person's zone change) and the
  recomputed due_at_utc reverse together (invariants 1 and 2).

  due_at_utc is a stored cache of a pure computation (like reminder.next_fire_at
  and, downstream, the safe start). It is (re)computed here at exactly three
  moments, and nowhere does a screen convert a time itself (invariant 11):
    - capture (actions.ts) — folded into the task create.
    - a due-date / due-time edit (task/actions.ts) — folded into the edit.
    - a governing person's zone change, or that person being attached to a task
      (task/actions.ts) — folded into that write.

  An estimate change is deliberately NOT here: the safe start is due_at_utc −
  estimate and is computed at read time (never stored), so changing the estimate
  needs no recompute write — the chain reads the new number on its next render.
*/

// ---------------------------------------------------------------------------
// The small reads the clock needs.
// ---------------------------------------------------------------------------

/** The user's own IANA zone — the fallback clock for own tasks (invariant 11).
 *  One user row (invariant 12's single life). */
export async function getUserZone(): Promise<string> {
  const user = await prisma.user.findFirst({ select: { timezone: true } });
  return user?.timezone ?? "UTC";
}

/** The commitment-relevant people on a task: their role and their zone, which is
 *  all the clock reads. */
export async function getCommitmentPeople(taskId: string): Promise<CommitmentPerson[]> {
  const rows = await prisma.taskPerson.findMany({
    where: { taskId },
    include: { person: { select: { timezone: true } } },
  });
  return rows.map((r) => ({ role: r.role, timezone: r.person.timezone }));
}

// ---------------------------------------------------------------------------
// The reversible ops for one task's due instant.
// ---------------------------------------------------------------------------

/**
 * Compute a task's new due instant from its effective due date/time and its
 * people, and return the ops that write it plus the ops that restore the prior
 * value. When nothing changes (same instant, same zone) the arrays are empty, so
 * a no-op edit adds no work and no spurious undo step.
 *
 * `people` may be passed in (the caller already has them — capture, or an
 * add-person write that changes the set), otherwise they are read from the task.
 */
export async function dueInstantUpdateOps(opts: {
  taskId: string;
  dueDate: string | null; // effective, post-edit
  dueTime: string | null; // effective, post-edit
  priorDueAtUtc: Date | null;
  priorDueZone: string | null;
  people?: CommitmentPerson[];
  userZone?: string;
}): Promise<{ apply: UndoOp[]; undo: UndoOp[]; instant: DueInstant }> {
  const [people, userZone] = await Promise.all([
    opts.people ?? getCommitmentPeople(opts.taskId),
    opts.userZone ? Promise.resolve(opts.userZone) : getUserZone(),
  ]);

  const instant = computeTaskDueInstant({
    dueDate: opts.dueDate,
    dueTime: opts.dueTime,
    people,
    userZone,
  });

  const changed =
    (instant.dueAtUtc?.getTime() ?? null) !== (opts.priorDueAtUtc?.getTime() ?? null) ||
    instant.dueZone !== opts.priorDueZone;

  if (!changed) return { apply: [], undo: [], instant };

  return {
    apply: [
      {
        action: "update",
        model: "task",
        id: opts.taskId,
        data: { dueAtUtc: instant.dueAtUtc, dueZone: instant.dueZone },
      },
    ],
    undo: [
      {
        action: "update",
        model: "task",
        id: opts.taskId,
        data: { dueAtUtc: opts.priorDueAtUtc, dueZone: opts.priorDueZone },
      },
    ],
    instant,
  };
}

// ---------------------------------------------------------------------------
// A governing person's zone change → recompute every active commitment of theirs.
// ---------------------------------------------------------------------------

/**
 * The reversible ops to recompute due_at_utc for every ACTIVE dated task a person
 * is attached to, after their zone (or working hours) changed. Only active tasks
 * move: a done or cancelled commitment keeps the instant it was promised at — its
 * frozen due_zone snapshot is the history the invariant preserves, so correcting
 * a person's zone today never rewrites what a past deadline meant.
 *
 * Each task is re-resolved through the full governing-zone rule, so a task where
 * this person is only, say, delegated-to but an asked-by person with a zone also
 * exists correctly does NOT move. Returns the ops (folded into the person-edit
 * mutate) and the count actually moved, for the summary line.
 */
export async function recomputeCommitmentsForPersonOps(
  personId: string,
  opts: { newZone?: string | null } = {}
): Promise<{ apply: UndoOp[]; undo: UndoOp[]; count: number }> {
  const userZone = await getUserZone();
  const links = await prisma.taskPerson.findMany({
    where: { personId, task: { deletedAt: null, status: "active", dueDate: { not: null } } },
    select: { taskId: true },
    distinct: ["taskId"],
  });
  const taskIds = links.map((l) => l.taskId);
  if (taskIds.length === 0) return { apply: [], undo: [], count: 0 };

  const tasks = await prisma.task.findMany({
    where: { id: { in: taskIds } },
    include: { taskPeople: { include: { person: { select: { id: true, timezone: true } } } } },
  });

  const apply: UndoOp[] = [];
  const undo: UndoOp[] = [];
  for (const t of tasks) {
    // Substitute this person's NEW zone: the DB still holds the old value while
    // the undo payload is being built (the person update is in the same mutate),
    // so we compute the new instant as if the edit had already landed.
    const people: CommitmentPerson[] = t.taskPeople.map((tp) => ({
      role: tp.role,
      timezone:
        tp.person.id === personId && opts.newZone !== undefined
          ? opts.newZone
          : tp.person.timezone,
    }));
    const instant = computeTaskDueInstant({
      dueDate: isoOf(t.dueDate),
      dueTime: t.dueTime,
      people,
      userZone,
    });
    const changed =
      (instant.dueAtUtc?.getTime() ?? null) !== (t.dueAtUtc?.getTime() ?? null) ||
      instant.dueZone !== t.dueZone;
    if (!changed) continue;
    apply.push({
      action: "update",
      model: "task",
      id: t.id,
      data: { dueAtUtc: instant.dueAtUtc, dueZone: instant.dueZone },
    });
    undo.push({
      action: "update",
      model: "task",
      id: t.id,
      data: { dueAtUtc: t.dueAtUtc, dueZone: t.dueZone },
    });
  }
  return { apply, undo, count: apply.length };
}

// ---------------------------------------------------------------------------
// One-pass backfill (idempotent).
// ---------------------------------------------------------------------------

/**
 * Fill due_at_utc / due_zone on every active dated task that has none yet — the
 * commitments captured before WP12, whose columns were left null. Idempotent: it
 * only touches rows where due_at_utc IS NULL but a due date exists, so it
 * converges in one pass and does nothing on later runs. Runs from /api/tick, so
 * existing rows fill on prod through the deployed cron without a manual migration
 * (and it is safe to run in dev by hand). One activity row for the whole pass;
 * this is a derived cache, not a user action, so there is nothing to undo.
 */
export async function backfillDueInstants(): Promise<{ filled: number }> {
  const userZone = await getUserZone();
  const tasks = await prisma.task.findMany({
    where: { deletedAt: null, status: "active", dueDate: { not: null }, dueAtUtc: null },
    include: { taskPeople: { include: { person: { select: { timezone: true } } } } },
  });
  if (tasks.length === 0) return { filled: 0 };

  const updates = tasks
    .map((t) => {
      const people: CommitmentPerson[] = t.taskPeople.map((tp) => ({
        role: tp.role,
        timezone: tp.person.timezone,
      }));
      const instant = computeTaskDueInstant({
        dueDate: isoOf(t.dueDate),
        dueTime: t.dueTime,
        people,
        userZone,
      });
      return { id: t.id, dueAtUtc: instant.dueAtUtc, dueZone: instant.dueZone };
    })
    .filter((u) => u.dueAtUtc != null);

  if (updates.length === 0) return { filled: 0 };

  await mutate({
    actor: { kind: "app" },
    verb: "task.dueInstant.backfill",
    summary: `Computed the deadline instant for ${updates.length} existing commitment${
      updates.length === 1 ? "" : "s"
    }`,
    // A derived cache filled once — nothing to reverse. undoTtlMs 0 means the
    // activity page never offers an "undo" that would do nothing.
    undo: { ops: [] },
    undoTtlMs: 0,
    apply: async (tx) => {
      for (const u of updates) {
        await tx.task.update({
          where: { id: u.id },
          data: { dueAtUtc: u.dueAtUtc, dueZone: u.dueZone },
        });
      }
    },
  });

  return { filled: updates.length };
}

/** A @db.Date column (stored at midnight UTC) back to "YYYY-MM-DD". */
function isoOf(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}
