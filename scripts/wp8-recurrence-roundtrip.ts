import { PrismaClient } from "@prisma/client";
import { mutate, undo, type UndoOp } from "../src/lib/mutate";
import { spawnNextOccurrenceOps, rollMissedOccurrences, getHabitHistory } from "../src/lib/recurrence-service";

/*
  WP8 · end-to-end proof, against a real database, of the three things the
  recurrence engine must get right beyond the pure arithmetic (which is unit
  tested in recurrence.test.ts):

    1. completing a recurring occurrence spawns the next one, in the same write,
       so undo reverses both (fixed counts from the scheduled date; after-
       completion counts from the completion date);
    2. a missed fixed non-commitment occurrence is skipped, not stacked — the
       series jumps to its first still-future date and records the skip;
    3. a habit's completion history counts the done occurrences of its rule.

  It builds its own rule + occurrence, exercises each path, asserts, and deletes
  everything it made. Run: `npm run db:wp8-recurrence-roundtrip`. DEV DB only.
*/

const p = new PrismaClient();
const iso = (d: string) => new Date(`${d}T00:00:00.000Z`);
const day = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL · ${msg}`);
  console.log(`  ok · ${msg}`);
}

async function makeSeries(opts: {
  title: string;
  pattern: "daily" | "weekdays" | "weekly" | "monthly_date" | "every_n_weeks";
  mode: "fixed" | "after_completion";
  n?: number | null;
  dayOfMonth?: number | null;
  occ: string;
  kind?: "habit" | "commitment";
}): Promise<{ ruleId: string; taskId: string; cleanup: () => Promise<void> }> {
  const ruleId = crypto.randomUUID();
  const taskId = crypto.randomUUID();
  const kind = opts.kind ?? "habit";
  await mutate({
    actor: { kind: "app" },
    verb: "test.recurrence.seed",
    taskId,
    summary: `seed ${opts.title}`,
    undo: { ops: [] },
    apply: async (tx) => {
      await tx.recurrenceRule.create({
        data: {
          id: ruleId,
          pattern: opts.pattern,
          weekdays: [false, false, false, false, false, false, false],
          dayOfMonth: opts.dayOfMonth ?? null,
          n: opts.n ?? null,
          mode: opts.mode,
          template: {
            title: opts.title,
            projectId: null,
            categoryId: null,
            kind,
            kindIsExplicit: false,
            reason: null,
            estimateMinutes: null,
            splittable: false,
            minChunkMinutes: null,
            dueTime: null,
            dateKind: "do",
            people: [],
            reminders: [],
          },
        },
      });
      await tx.task.create({
        data: {
          id: taskId,
          title: opts.title,
          kind,
          recurrenceRuleId: ruleId,
          occurrenceDate: iso(opts.occ),
          doDate: iso(opts.occ),
          doDateSetBy: "app",
        },
      });
    },
  });

  const cleanup = async () => {
    await p.reminder.deleteMany({ where: { task: { recurrenceRuleId: ruleId } } });
    await p.taskPerson.deleteMany({ where: { task: { recurrenceRuleId: ruleId } } });
    await p.activity.deleteMany({ where: { task: { recurrenceRuleId: ruleId } } });
    await p.task.deleteMany({ where: { recurrenceRuleId: ruleId } });
    await p.recurrenceRule.delete({ where: { id: ruleId } });
  };

  return { ruleId, taskId, cleanup };
}

async function completeWithSpawn(taskId: string, title: string): Promise<string> {
  const spawn = await spawnNextOccurrenceOps(taskId);
  const before = await p.task.findUnique({ where: { id: taskId }, select: { status: true, completedAt: true } });
  const undoOps: UndoOp[] = [
    ...(spawn?.undo ?? []),
    { action: "update", model: "task", id: taskId, data: { status: before!.status, completedAt: before!.completedAt } },
  ];
  const { activity } = await mutate({
    actor: { kind: "user" },
    verb: "task.edit.status",
    taskId,
    summary: spawn ? `“${title}” is done · ${spawn.summary}` : `“${title}” is done`,
    undo: { ops: undoOps },
    apply: async (tx) => {
      await tx.task.update({ where: { id: taskId }, data: { status: "done", completedAt: new Date() } });
      if (spawn) await spawn.run(tx);
    },
  });
  return activity.id;
}

async function main() {
  // 1 · after-completion spawns from the completion date (today), fixed from the
  //     scheduled date; completing reverses the spawn.
  console.log("1 · completion spawns the next occurrence, and undo reverses both");
  const today = new Date().toISOString().slice(0, 10);
  const plants = await makeSeries({
    title: "RT plants",
    pattern: "every_n_weeks",
    n: 1,
    mode: "after_completion",
    occ: today,
  });
  try {
    const actId = await completeWithSpawn(plants.taskId, "RT plants");
    const rows = await p.task.findMany({ where: { recurrenceRuleId: plants.ruleId }, orderBy: { occurrenceDate: "asc" } });
    assert(rows.length === 2, "a second occurrence was spawned");
    const next = rows.find((r) => r.status === "active")!;
    const expected = new Date(iso(today).getTime() + 7 * 86400000).toISOString().slice(0, 10);
    assert(day(next.occurrenceDate) === expected, `next occurrence is completion + 7 days (${expected})`);

    const hist = await getHabitHistory(plants.ruleId);
    assert(hist.doneCount === 1, "habit history counts one completion");

    await undo(actId);
    const after = await p.task.findMany({ where: { recurrenceRuleId: plants.ruleId } });
    assert(after.length === 1 && after[0].status === "active", "undo removed the spawn and re-opened the occurrence");
  } finally {
    await plants.cleanup();
  }

  // 2 · a missed fixed non-commitment occurrence is skipped (cancelled) and the
  //     series jumps to one future occurrence — misses do not stack.
  console.log("2 · missed fixed occurrences collapse to one, and the skip is recorded");
  const rent = await makeSeries({
    title: "RT rent",
    pattern: "monthly_date",
    dayOfMonth: 1,
    mode: "fixed",
    occ: "2026-01-01", // far in the past relative to any real run date
  });
  try {
    const res = await rollMissedOccurrences();
    assert(res.skipped >= 1, "the roll skipped at least the missed occurrence");
    const rows = await p.task.findMany({ where: { recurrenceRuleId: rent.ruleId } });
    const cancelled = rows.filter((r) => r.status === "cancelled");
    const active = rows.filter((r) => r.status === "active");
    assert(cancelled.length === 1, "the missed occurrence was cancelled, not left active");
    assert(active.length === 1, "exactly one future occurrence exists — no pile-up");
    assert(day(active[0].occurrenceDate)! >= today, "the surviving occurrence is not in the past");
    const skip = await p.activity.findFirst({ where: { verb: "recurrence.skip", taskId: { in: rows.map((r) => r.id) } } });
    assert(!!skip, "the series recorded the skip in the activity log");
  } finally {
    await rent.cleanup();
  }

  // 3 · a commitment recurrence is NOT auto-skipped (a missed promise is not
  //     silently erased).
  console.log("3 · a missed commitment occurrence is left alone");
  const promise = await makeSeries({
    title: "RT promise",
    pattern: "monthly_date",
    dayOfMonth: 1,
    mode: "fixed",
    occ: "2026-01-01",
    kind: "commitment",
  });
  try {
    await rollMissedOccurrences();
    const rows = await p.task.findMany({ where: { recurrenceRuleId: promise.ruleId } });
    assert(rows.length === 1 && rows[0].status === "active", "the commitment occurrence stayed active");
  } finally {
    await promise.cleanup();
  }

  console.log("\nWP8 recurrence roundtrip: all green.");
}

main().finally(() => p.$disconnect());
