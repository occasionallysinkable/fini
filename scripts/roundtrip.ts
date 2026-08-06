import { PrismaClient } from "@prisma/client";
import { mutate, undo } from "../src/lib/mutate";

/*
  End-to-end proof that the write spine holds against a real database. Needs
  DATABASE_URL to point at a Postgres instance with the schema migrated.

  It exercises all three reversals — create, update, soft-delete — and asserts
  the row's state after each undo. Run: `npm run db:roundtrip`.
*/

const prisma = new PrismaClient();

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error("FAIL: " + msg);
  console.log("ok — " + msg);
}

async function main() {
  const id = crypto.randomUUID();

  // create
  const { activity: created } = await mutate({
    actor: { kind: "user" },
    verb: "task.create",
    taskId: id,
    summary: "Added “roundtrip”",
    undo: { ops: [{ action: "deleteRow", model: "task", id }] },
    apply: (tx) => tx.task.create({ data: { id, title: "roundtrip" } }),
  });
  assert(await prisma.task.findUnique({ where: { id } }), "task exists after create");
  assert(
    await prisma.activity.findFirst({ where: { taskId: id, verb: "task.create" } }),
    "create wrote an activity row (invariant 1)"
  );

  // update, then undo the update
  const before = await prisma.task.findUniqueOrThrow({ where: { id } });
  await mutate({
    actor: { kind: "user" },
    verb: "task.rename",
    taskId: id,
    summary: "Renamed",
    undo: { ops: [{ action: "update", model: "task", id, data: { title: before.title } }] },
    apply: (tx) => tx.task.update({ where: { id }, data: { title: "changed" } }),
  }).then(({ activity }) => undo(activity.id));
  assert(
    (await prisma.task.findUniqueOrThrow({ where: { id } })).title === "roundtrip",
    "undo restored the previous title (invariant 2)"
  );

  // soft-delete, then undo the delete
  await mutate({
    actor: { kind: "user" },
    verb: "task.delete",
    taskId: id,
    summary: "Deleted",
    undo: { ops: [{ action: "update", model: "task", id, data: { deletedAt: null } }] },
    apply: (tx) => tx.task.update({ where: { id }, data: { deletedAt: new Date() } }),
  }).then(({ activity }) => undo(activity.id));
  assert(
    (await prisma.task.findUniqueOrThrow({ where: { id } })).deletedAt === null,
    "undo cleared deletedAt"
  );

  // undo the original create — the row should be gone
  await undo(created.id);
  assert(!(await prisma.task.findUnique({ where: { id } })), "undo of create removed the row");

  console.log("\nAll spine checks passed.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
