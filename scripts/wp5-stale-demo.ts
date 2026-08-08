import { PrismaClient } from "@prisma/client";

/*
  WP5 · a demo fixture for verifying the stale block in the running app.

  Staleness is derived from the activity log and from created_at, both of which
  default to "now" through the normal app — so there is no way to make a task
  fourteen days old by clicking around. This script backdates a handful of tasks
  and their activity rows directly (a raw client, exactly as prisma/seed.ts does
  for the one user row) so the block has something real to show. It is a test
  fixture, never part of the app's own write path.

  It builds, oldest first:
    61d · kept twice   (two old keep rows)
    45d · kept once    (one old keep row)
    30d · first time
    22d, 18d, 15d, 14d · first time
  → seven stale tasks: three shown, four counted (oldest 22d), sweeps visible.
  Plus two active tasks touched yesterday, to prove recent activity is excluded.

  Re-running is idempotent: it clears anything it made last time first.
*/

const prisma = new PrismaClient();
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);
const PREFIX = "[stale-demo]";

async function makeTask(opts: {
  title: string;
  createdDaysAgo: number;
  keepDaysAgo?: number[];
  lastTouchDaysAgo?: number; // an extra recent activity row (for non-stale demos)
}) {
  const createdAt = daysAgo(opts.createdDaysAgo);
  const keeps = opts.keepDaysAgo ?? [];
  const task = await prisma.task.create({
    data: {
      title: `${PREFIX} ${opts.title}`,
      status: "active",
      source: "typed",
      createdAt,
      keepCount: keeps.length,
    },
  });

  // The creation row, dated with the task (the app writes one on capture). Every
  // row mutate() writes carries a non-null undoExpiresAt (a 30-day window), and
  // the staleness derivation now reads that — so the fixture sets it too, or the
  // touch would be misread as a reversed action. It counts as a touch at `at`.
  await prisma.activity.create({
    data: {
      actor: "user",
      verb: "task.capture",
      taskId: task.id,
      summary: `Added “${opts.title}”`,
      at: createdAt,
      undoExpiresAt: new Date(createdAt.getTime() + 30 * DAY),
    },
  });

  // Old keep rows — the kept count is counted from these (undoExpiresAt not null
  // = not undone). They are older than fourteen days, so the task is still stale.
  for (const d of keeps) {
    await prisma.activity.create({
      data: {
        actor: "user",
        verb: "task.bulkKeep",
        taskId: task.id,
        summary: "Kept 1 task",
        at: daysAgo(d),
        undoExpiresAt: new Date(Date.now() + 30 * DAY),
      },
    });
  }

  // A recent touch, for the not-stale demos.
  if (opts.lastTouchDaysAgo != null) {
    const at = daysAgo(opts.lastTouchDaysAgo);
    await prisma.activity.create({
      data: {
        actor: "user",
        verb: "task.edit.title",
        taskId: task.id,
        summary: `Renamed “${opts.title}”`,
        at,
        undoExpiresAt: new Date(at.getTime() + 30 * DAY),
      },
    });
  }

  return task;
}

async function main() {
  // Clear the previous run: activities first (FK), then the tasks.
  const prior = await prisma.task.findMany({
    where: { title: { startsWith: PREFIX } },
    select: { id: true },
  });
  const ids = prior.map((t) => t.id);
  if (ids.length) {
    await prisma.activity.deleteMany({ where: { taskId: { in: ids } } });
    await prisma.task.deleteMany({ where: { id: { in: ids } } });
  }

  await makeTask({ title: "Reconcile the 2024 mileage log", createdDaysAgo: 61, keepDaysAgo: [30, 20] });
  await makeTask({ title: "Chase the missing W-9 from Delta Freight", createdDaysAgo: 45, keepDaysAgo: [22] });
  await makeTask({ title: "Draft the Q3 board summary", createdDaysAgo: 30 });
  await makeTask({ title: "Cancel the unused Figma seats", createdDaysAgo: 22 });
  await makeTask({ title: "Return the warehouse key to facilities", createdDaysAgo: 18 });
  await makeTask({ title: "File the annual WSIB return", createdDaysAgo: 15 });
  await makeTask({ title: "Update the emergency contact sheet", createdDaysAgo: 14 });

  // Not stale — touched yesterday. Should never appear in the block.
  await makeTask({ title: "Prep tomorrow's standup notes", createdDaysAgo: 40, lastTouchDaysAgo: 1 });
  await makeTask({ title: "Review the new hire's PR", createdDaysAgo: 9, lastTouchDaysAgo: 1 });

  const stale = 7;
  console.log(`Seeded ${stale} stale demo tasks (+2 recently-touched, excluded).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
