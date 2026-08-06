import { PrismaClient } from "@prisma/client";
import { mutate, undo, type UndoOp } from "../src/lib/mutate";

/*
  End-to-end proof that a WP2 capture holds against a real database: one typed
  line becomes a task plus any new project and person it referenced, all through
  mutate(), and a single undo reverses the whole thing. Mirrors roundtrip.ts,
  which does the same for the bare WP1 spine.

  Needs DATABASE_URL to point at a Postgres instance with the schema migrated.
  Run: `npm run db:capture-roundtrip`.
*/

const prisma = new PrismaClient();

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error("FAIL: " + msg);
  console.log("ok — " + msg);
}

async function main() {
  // A capture that pulls in a brand-new project and a brand-new person, so the
  // undo has to reverse rows across four tables (project, person, task,
  // task_person) plus the activity log.
  const projectId = crypto.randomUUID();
  const personId = crypto.randomUUID();
  const taskId = crypto.randomUUID();
  const projectName = `rt-project-${taskId.slice(0, 8)}`;
  const personName = `rt-person-${taskId.slice(0, 8)}`;

  const undoOps: UndoOp[] = [
    { action: "deleteWhere", model: "taskPerson", where: { taskId } },
    { action: "deleteRow", model: "task", id: taskId },
    { action: "deleteRow", model: "person", id: personId },
    { action: "deleteRow", model: "project", id: projectId },
  ];

  const { activity: captured } = await mutate({
    actor: { kind: "user" },
    verb: "task.capture",
    taskId,
    summary: "Added “roundtrip capture”",
    undo: { ops: undoOps },
    apply: async (tx) => {
      await tx.project.create({ data: { id: projectId, name: projectName } });
      await tx.person.create({ data: { id: personId, name: personName } });
      const task = await tx.task.create({
        data: {
          id: taskId,
          title: "roundtrip capture",
          projectId,
          kind: "commitment",
          kindIsExplicit: false,
          source: "typed",
          dueDate: new Date("2026-08-13T00:00:00.000Z"),
          dueTime: "17:00",
          estimateMinutes: 90,
        },
      });
      await tx.taskPerson.create({
        data: { taskId, personId, role: "asked_by" },
      });
      return task;
    },
  });

  // Everything the capture wrote is there.
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  assert(task, "task exists after capture");
  assert(task?.projectId === projectId, "task is linked to the new project");
  assert(task?.dueTime === "17:00" && task?.estimateMinutes === 90, "parsed fields were stored");
  assert(await prisma.project.findUnique({ where: { id: projectId } }), "new project exists");
  assert(await prisma.person.findUnique({ where: { id: personId } }), "new person exists");
  assert(
    await prisma.taskPerson.findFirst({ where: { taskId, personId, role: "asked_by" } }),
    "the person-and-role pair exists"
  );
  assert(
    await prisma.activity.findFirst({ where: { taskId, verb: "task.capture" } }),
    "capture wrote an activity row (invariant 1)"
  );

  // One undo reverses the whole capture (invariant 2).
  await undo(captured.id);
  assert(!(await prisma.task.findUnique({ where: { id: taskId } })), "undo removed the task");
  assert(
    (await prisma.taskPerson.findMany({ where: { taskId } })).length === 0,
    "undo removed the person-and-role pair"
  );
  assert(!(await prisma.person.findUnique({ where: { id: personId } })), "undo removed the new person");
  assert(!(await prisma.project.findUnique({ where: { id: projectId } })), "undo removed the new project");

  console.log("\nAll capture round-trip checks passed.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
