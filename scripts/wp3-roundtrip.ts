import { mutate, undo, type UndoOp } from "../src/lib/mutate";
import {
  getProjectTree,
  getAvailableTasks,
  getStandaloneNotes,
  getProjectsDueForReview,
} from "../src/lib/queries";
import { prismaBase } from "../src/lib/prisma";
import { addDays } from "../src/lib/review";
import { todayInZone } from "../src/lib/parse";

/*
  End-to-end proof of WP3 against a real database, mirroring the WP1/WP2
  roundtrips. Everything a page would write goes through mutate(); everything a
  page would read goes through the query layer. No auth, no browser — just the
  real code paths on the real schema.

  Run: npx dotenv -e .env.local -- tsx scripts/wp3-roundtrip.ts
*/

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error("FAIL: " + msg);
  console.log("ok — " + msg);
}

// Track every row we create so the dev DB is left exactly as we found it.
const created = { projects: [] as string[], tasks: [] as string[], notes: [] as string[] };
const tag = crypto.randomUUID().slice(0, 8);

async function createProject(name: string, parentId: string | null, extra: Record<string, unknown> = {}) {
  const id = crypto.randomUUID();
  created.projects.push(id);
  await mutate({
    actor: { kind: "user" },
    verb: "project.create",
    summary: `Added project “${name}”`,
    undo: { ops: [{ action: "deleteRow", model: "project", id }] },
    apply: (tx) => tx.project.create({ data: { id, name, parentId, ...extra } }),
  });
  return id;
}

async function createTask(title: string, projectId: string | null, extra: Record<string, unknown> = {}) {
  const id = crypto.randomUUID();
  created.tasks.push(id);
  await mutate({
    actor: { kind: "user" },
    verb: "task.capture",
    taskId: id,
    summary: `Added “${title}”`,
    undo: { ops: [{ action: "deleteRow", model: "task", id }] },
    apply: (tx) => tx.task.create({ data: { id, title, projectId, source: "typed", ...extra } }),
  });
  return id;
}

async function main() {
  const user = await prismaBase.user.findFirst();
  const today = todayInZone(user?.timezone ?? "UTC");
  const future = addDays(today, 30);
  const futureDate = new Date(`${future}T00:00:00.000Z`);

  // --- Criterion: two levels in the interface, any depth in the data ---
  const passport = await createProject(`Renew passport ${tag}`, null, { isSequence: true });
  const admin = await createProject(`Admin ${tag}`, null);
  const sub = await createProject(`Correspondence ${tag}`, admin); // level 2
  const deep = await createProject(`2024 ${tag}`, sub); // level 3 — data only
  assert(true, "created a 3-level project chain in the data");

  const tree = await getProjectTree();
  const adminNode = tree.find((p) => p.id === admin);
  assert(adminNode, "getProjectTree returns the top-level Admin project");
  assert(adminNode!.children.some((c) => c.id === sub), "…with its level-2 child nested under it");
  // getProjectTree draws two levels; the level-3 project is absent from the tree
  // but present in the data.
  const treeHasDeep = JSON.stringify(tree).includes(deep);
  assert(!treeHasDeep, "the level-3 project is NOT in the two-level tree (UI limit)");
  const deepRow = await prismaBase.project.findUnique({ where: { id: deep } });
  assert(deepRow?.parentId === sub, "…yet the level-3 project exists in the data with the right parent");

  // --- Criterion: sequence projects expose only the first unfinished task ---
  const step1 = await createTask(`Get photos ${tag}`, passport, { position: 0 });
  const step2 = await createTask(`Fill the form ${tag}`, passport, { position: 1 });
  const step3 = await createTask(`Post it ${tag}`, passport, { position: 2 });

  let avail = await getAvailableTasks();
  let availIds = new Set(avail.map((t) => t.id));
  assert(availIds.has(step1), "sequence: first step (lowest position) is available");
  assert(!availIds.has(step2) && !availIds.has(step3), "sequence: later steps are absent, not present");

  // Order is position, not creation time: move step1 to the end and step2 (the
  // now-lowest position) becomes the available one — a reorder createdAt cannot do.
  await mutate({
    actor: { kind: "user" },
    verb: "task.reorder",
    taskId: step1,
    summary: "Moved the first step to the end",
    undo: { ops: [{ action: "update", model: "task", id: step1, data: { position: 0 } }] },
    apply: (tx) => tx.task.update({ where: { id: step1 }, data: { position: 10 } }),
  });
  avail = await getAvailableTasks();
  availIds = new Set(avail.map((t) => t.id));
  assert(availIds.has(step2), "sequence: after reordering by position, step 2 is the available one");
  assert(!availIds.has(step1) && !availIds.has(step3), "sequence: the reordered step is now a later step");
  // Restore original order for the completion flow below.
  await mutate({
    actor: { kind: "user" },
    verb: "task.reorder",
    taskId: step1,
    summary: "Restored the first step",
    undo: { ops: [{ action: "update", model: "task", id: step1, data: { position: 10 } }] },
    apply: (tx) => tx.task.update({ where: { id: step1 }, data: { position: 0 } }),
  });
  avail = await getAvailableTasks();
  availIds = new Set(avail.map((t) => t.id));
  assert(availIds.has(step1), "sequence: restored, step 1 is first again");

  // Complete the first step; the second becomes available that instant.
  await mutate({
    actor: { kind: "user" },
    verb: "task.complete",
    taskId: step1,
    summary: "Completed the first step",
    undo: { ops: [{ action: "update", model: "task", id: step1, data: { status: "active", completedAt: null } }] },
    apply: (tx) => tx.task.update({ where: { id: step1 }, data: { status: "done", completedAt: new Date() } }),
  });
  avail = await getAvailableTasks();
  availIds = new Set(avail.map((t) => t.id));
  assert(availIds.has(step2), "sequence: after finishing step 1, step 2 is available");
  assert(!availIds.has(step3), "sequence: step 3 still absent");

  // --- Criterion: availability derived — defer date and project on hold ---
  const deferred = await createTask(`Book flu jab ${tag}`, admin, { deferUntil: futureDate });
  const onHeld = await createTask(`Held task ${tag}`, admin);
  // Put Admin on hold.
  await mutate({
    actor: { kind: "user" },
    verb: "project.hold",
    summary: "Put Admin on hold",
    undo: { ops: [{ action: "update", model: "project", id: admin, data: { onHold: false } }] },
    apply: (tx) => tx.project.update({ where: { id: admin }, data: { onHold: true } }),
  });
  avail = await getAvailableTasks();
  availIds = new Set(avail.map((t) => t.id));
  assert(!availIds.has(deferred), "availability: a future defer date makes a task absent");
  assert(!availIds.has(onHeld), "availability: an on-hold project makes its tasks absent");
  // Take Admin off hold → its non-deferred task returns.
  await mutate({
    actor: { kind: "user" },
    verb: "project.hold",
    summary: "Took Admin off hold",
    undo: { ops: [{ action: "update", model: "project", id: admin, data: { onHold: true } }] },
    apply: (tx) => tx.project.update({ where: { id: admin }, data: { onHold: false } }),
  });
  avail = await getAvailableTasks();
  availIds = new Set(avail.map((t) => t.id));
  assert(availIds.has(onHeld), "availability: off hold, the task is available again");
  assert(!availIds.has(deferred), "availability: the deferred task is still absent");

  // --- Criterion: review intervals per project; screen shows only what is due ---
  const reviewProj = await createProject(`Quarterly thing ${tag}`, null, { reviewIntervalDays: 90 });
  let due = await getProjectsDueForReview();
  assert(due.some((p) => p.id === reviewProj), "review: a never-reviewed project with a cadence is due");
  // Mark reviewed through mutate() → resets the clock, writes an activity row.
  const before = await prismaBase.project.findUnique({ where: { id: reviewProj } });
  const { activity: reviewActivity } = await mutate({
    actor: { kind: "user" },
    verb: "project.reviewed",
    summary: "Reviewed the quarterly thing",
    undo: { ops: [{ action: "update", model: "project", id: reviewProj, data: { lastReviewedAt: before!.lastReviewedAt } }] },
    apply: (tx) => tx.project.update({ where: { id: reviewProj }, data: { lastReviewedAt: new Date() } }),
  });
  due = await getProjectsDueForReview();
  assert(!due.some((p) => p.id === reviewProj), "review: after marking reviewed, it drops off the due list");
  const afterReview = await prismaBase.project.findUnique({ where: { id: reviewProj } });
  assert(afterReview?.lastReviewedAt != null, "review: the clock (last_reviewed_at) was reset");
  // Undo the review → due again (proves it went through mutate()).
  await undo(reviewActivity.id);
  due = await getProjectsDueForReview();
  assert(due.some((p) => p.id === reviewProj), "review: undo restores it to the due list");

  // --- Criterion: notes attach to a task or stand alone ---
  const standaloneNoteId = crypto.randomUUID();
  created.notes.push(standaloneNoteId);
  await mutate({
    actor: { kind: "user" },
    verb: "note.create",
    summary: "Added a standalone note",
    undo: { ops: [{ action: "deleteRow", model: "note", id: standaloneNoteId }] },
    apply: (tx) => tx.note.create({ data: { id: standaloneNoteId, body: `standalone ${tag}`, taskId: null } }),
  });
  const taskNoteId = crypto.randomUUID();
  created.notes.push(taskNoteId);
  const { activity: taskNoteActivity } = await mutate({
    actor: { kind: "user" },
    verb: "note.create",
    taskId: step2,
    summary: "Added a note to a task",
    undo: { ops: [{ action: "deleteRow", model: "note", id: taskNoteId }] },
    apply: (tx) => tx.note.create({ data: { id: taskNoteId, body: `on-task ${tag}`, taskId: step2 } }),
  });
  const standalones = await getStandaloneNotes();
  assert(standalones.some((n) => n.id === standaloneNoteId), "notes: the standalone note is returned by getStandaloneNotes");
  assert(!standalones.some((n) => n.id === taskNoteId), "notes: the task-attached note is NOT in the standalone list");
  const attached = await prismaBase.note.findUnique({ where: { id: taskNoteId } });
  assert(attached?.taskId === step2, "notes: the task note is attached to its task");
  // Undo a note creation.
  await undo(taskNoteActivity.id);
  const goneNote = await prismaBase.note.findUnique({ where: { id: taskNoteId } });
  assert(goneNote == null, "notes: undo removes the created note");

  console.log("\nALL WP3 CRITERIA VERIFIED");
}

async function cleanup() {
  // Remove everything the run created, in FK-safe order, via the unguarded
  // client (this is test scaffolding, not a user action).
  await prismaBase.activity.deleteMany({ where: { taskId: { in: created.tasks } } });
  await prismaBase.note.deleteMany({ where: { id: { in: created.notes } } });
  await prismaBase.note.deleteMany({ where: { taskId: { in: created.tasks } } });
  await prismaBase.task.deleteMany({ where: { id: { in: created.tasks } } });
  // Projects self-reference via parent_id, so delete children before parents:
  // reverse of creation order does exactly that.
  for (const id of [...created.projects].reverse()) {
    await prismaBase.project.delete({ where: { id } }).catch(() => {});
  }
  // Activity rows for project/note writes have no taskId link for some; clear by verb+recency is risky,
  // so leave general activity rows (they are harmless history). Task-linked ones removed above.
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    await prismaBase.$disconnect();
  });
