import { PrismaClient } from "@prisma/client";
import { mutate, undo } from "../src/lib/mutate";
import { getStaleData } from "../src/lib/queries";
import { KEEP_VERB } from "../src/lib/stale";

/*
  WP5 · end-to-end proof, against a real database, that undo returns a task to
  the stale block. The bug it guards: keep (or push) writes an activity row that
  the fourteen-day clock reads as a touch, so pressing undo restored the count
  but left the task muted for fourteen days — undo silently not undoing.

  The fix is in the derivation (queries.getStaleData / stale.isTouch): an undo
  row is not a touch, and neither is the action it reversed. This script keeps a
  stale task and undoes the keep, asserting it is back in the block with its kept
  count at zero — then the same for push. Run: `npm run db:wp5-stale-roundtrip`.
*/

const raw = new PrismaClient();
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);
const PREFIX = "[stale-roundtrip]";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error("FAIL: " + msg);
  console.log("ok — " + msg);
}

/** A stale task: backdated created_at and a backdated capture touch, so the
 *  fourteen-day clock already reads it as stale before we do anything. */
async function makeStaleTask(title: string) {
  const createdAt = daysAgo(61);
  const task = await raw.task.create({
    data: { title: `${PREFIX} ${title}`, status: "active", source: "typed", createdAt },
  });
  await raw.activity.create({
    data: {
      actor: "user",
      verb: "task.capture",
      taskId: task.id,
      summary: `Added “${title}”`,
      at: createdAt,
      undoExpiresAt: new Date(createdAt.getTime() + 30 * DAY),
    },
  });
  return task.id;
}

async function inBlock(taskId: string) {
  const data = await getStaleData();
  return data.rows.find((r) => r.id === taskId) ?? null;
}

async function cleanup() {
  const prior = await raw.task.findMany({
    where: { title: { startsWith: PREFIX } },
    select: { id: true },
  });
  const ids = prior.map((t) => t.id);
  if (ids.length) {
    await raw.activity.deleteMany({ where: { taskId: { in: ids } } });
    await raw.task.deleteMany({ where: { id: { in: ids } } });
  }
}

async function main() {
  await cleanup();

  // The derivation only speaks when the treatment is not "off". Force the block
  // for a deterministic run, restoring whatever was there afterwards.
  const user = await raw.user.findFirstOrThrow({ select: { id: true, settings: true } });
  const originalSettings = user.settings;
  await raw.user.update({
    where: { id: user.id },
    data: { settings: { ...((originalSettings ?? {}) as object), staleTreatment: "block" } },
  });

  try {
    // ---- keep, then undo -------------------------------------------------
    const keepId = await makeStaleTask("keep me");
    assert(await inBlock(keepId), "keep · task is in the block to begin with");

    // The real keep write (mirrors bulkAction's keep case: KEEP_VERB, taskId
    // stamped, keepCount bumped, reversible).
    const t = await raw.task.findUniqueOrThrow({ where: { id: keepId }, select: { keepCount: true } });
    const { activity: keepAct } = await mutate({
      actor: { kind: "user" },
      verb: KEEP_VERB,
      taskId: keepId,
      summary: "Kept 1 task",
      undo: { ops: [{ action: "update", model: "task", id: keepId, data: { keepCount: t.keepCount } }] },
      apply: (tx) => tx.task.update({ where: { id: keepId }, data: { keepCount: t.keepCount + 1 } }),
    });
    assert(!(await inBlock(keepId)), "keep · keeping mutes it — gone from the block");

    await undo(keepAct.id);
    const backAfterKeep = await inBlock(keepId);
    assert(backAfterKeep, "keep · undo returns the task to the block");
    assert(backAfterKeep!.keptCount === 0, "keep · kept count is back to zero after undo");

    // ---- push, then undo -------------------------------------------------
    const pushId = await makeStaleTask("push me");
    assert(await inBlock(pushId), "push · task is in the block to begin with");

    const p = await raw.task.findUniqueOrThrow({ where: { id: pushId }, select: { pushCount: true } });
    const { activity: pushAct } = await mutate({
      actor: { kind: "user" },
      verb: "task.bulkPush",
      taskId: pushId,
      summary: "Pushed 1 task",
      undo: { ops: [{ action: "update", model: "task", id: pushId, data: { pushCount: p.pushCount } }] },
      apply: (tx) => tx.task.update({ where: { id: pushId }, data: { pushCount: p.pushCount + 1 } }),
    });
    assert(!(await inBlock(pushId)), "push · pushing counts as a touch — gone from the block");

    await undo(pushAct.id);
    assert(await inBlock(pushId), "push · undo returns the task to the block");
    const restored = await raw.task.findUniqueOrThrow({ where: { id: pushId }, select: { pushCount: true } });
    assert(restored.pushCount === 0, "push · push count is back to zero after undo");

    console.log("\nAll WP5 undo-returns-to-block checks passed.");
  } finally {
    await cleanup();
    await raw.user.update({ where: { id: user.id }, data: { settings: originalSettings ?? undefined } });
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => raw.$disconnect());
