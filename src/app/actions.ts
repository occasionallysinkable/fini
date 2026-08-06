"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { mutate, undo } from "@/lib/mutate";
import { getTask } from "@/lib/queries";

/*
  WP1 demonstration actions. They exist to prove the spine end to end:
  every one goes through mutate(), every one writes an activity row, and each
  is reversible from the ledger. This is not capture (that is WP2) — a task is
  created from a bare title with no parsing.
*/

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Not signed in.");
  return session.user;
}

export async function createTask(formData: FormData) {
  await requireUser();
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;

  // Pre-generate the id so the undo payload is known before the write runs.
  const id = crypto.randomUUID();

  await mutate({
    actor: { kind: "user" },
    verb: "task.create",
    taskId: id,
    summary: `Added “${title}”`,
    undo: { ops: [{ action: "deleteRow", model: "task", id }] },
    apply: (tx) => tx.task.create({ data: { id, title } }),
  });

  revalidatePath("/");
}

export async function renameTask(formData: FormData) {
  await requireUser();
  const id = String(formData.get("id"));
  const title = String(formData.get("title") ?? "").trim();
  if (!id || !title) return;

  const before = await getTask(id);
  if (!before) return;

  await mutate({
    actor: { kind: "user" },
    verb: "task.rename",
    taskId: id,
    summary: `Renamed “${before.title}” to “${title}”`,
    undo: { ops: [{ action: "update", model: "task", id, data: { title: before.title } }] },
    apply: (tx) => tx.task.update({ where: { id }, data: { title } }),
  });

  revalidatePath("/");
}

export async function deleteTask(formData: FormData) {
  await requireUser();
  const id = String(formData.get("id"));
  const before = await getTask(id);
  if (!before || before.deletedAt) return;

  // A delete sets deletedAt and nothing else (invariant 2).
  await mutate({
    actor: { kind: "user" },
    verb: "task.delete",
    taskId: id,
    summary: `Deleted “${before.title}”`,
    filterKind: "deletions",
    undo: { ops: [{ action: "update", model: "task", id, data: { deletedAt: null } }] },
    apply: (tx) => tx.task.update({ where: { id }, data: { deletedAt: new Date() } }),
  });

  revalidatePath("/");
}

export async function undoActivity(formData: FormData) {
  await requireUser();
  const id = String(formData.get("id"));
  if (!id) return;
  await undo(id);
  revalidatePath("/");
}
