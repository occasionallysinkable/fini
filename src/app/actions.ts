"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { mutate, undo, type UndoOp } from "@/lib/mutate";
import {
  getTask,
  buildCaptureContext,
  resolveProjectPath,
  resolvePerson,
} from "@/lib/queries";
import { parse, inferKind, todayInZone, weekdayOf, type Role, type Kind } from "@/lib/parse";

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Not signed in.");
  return session.user;
}

// ---------------------------------------------------------------------------
// WP2 · capture. The typed line is parsed (R16/R27), kind is inferred (R17),
// and the task — with any new project or person it referenced — is created in
// one mutate() call, so the whole capture reverses from a single ledger line.
// ---------------------------------------------------------------------------

function isoToDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

export interface CaptureState {
  ok: boolean;
  summary?: string;
  error?: string;
}

export async function captureTask(
  _prev: CaptureState,
  formData: FormData
): Promise<CaptureState> {
  await requireUser();
  const raw = String(formData.get("raw") ?? "").trim();
  if (!raw) return { ok: false };

  // Roles the user chose inline for people the parser left role-less (R16:
  // "without a role it asks once"). Keyed by the person's typed name.
  let roleChoices: Record<string, Role> = {};
  try {
    roleChoices = JSON.parse(String(formData.get("roles") ?? "{}"));
  } catch {
    roleChoices = {};
  }

  const ctx = await buildCaptureContext();

  // Resolve "today" in the user's own zone (invariant 10). The client sends its
  // IANA zone so the stored date matches the day the user is actually living,
  // not the server's UTC date. Falls back to the context's zone if absent.
  const tz = String(formData.get("tz") ?? "").trim();
  if (tz) {
    ctx.today = todayInZone(tz);
    ctx.todayWeekday = weekdayOf(ctx.today);
  }

  const p = parse(raw, ctx);

  if (!p.title) {
    return { ok: false, error: "Give the task a few words of its own — the rest were all fields." };
  }

  // Apply the inline role answers, then re-infer the kind (a chosen "asked"
  // makes it a commitment).
  const people = p.people.map((person) => ({
    ...person,
    role: person.role ?? roleChoices[person.name] ?? ("assignee" as Role),
  }));
  const kindInfo = p.kindExplicit
    ? { kind: p.kind, explicit: true }
    : inferKind(people, p.recurrence != null, null);
  const kind: Kind = kindInfo.kind;

  // Resolve the names to ids before the write, so the undo payload is known.
  const projectLevels = p.project ? await resolveProjectPath(p.project.path) : [];
  const leafProjectId = projectLevels.length ? projectLevels[projectLevels.length - 1].id : null;

  const resolvedPeople = await Promise.all(
    people.map(async (person) => ({
      ...person,
      ...(await resolvePerson(person.name)),
    }))
  );

  const taskId = crypto.randomUUID();

  // Reversal, in FK-safe order: links, then task, then anything this capture
  // newly created (people, then projects leaf→root).
  const undoOps: UndoOp[] = [
    { action: "deleteWhere", model: "taskPerson", where: { taskId } },
    { action: "deleteRow", model: "task", id: taskId },
  ];
  for (const person of resolvedPeople) {
    if (!person.existing) undoOps.push({ action: "deleteRow", model: "person", id: person.id });
  }
  for (const level of [...projectLevels].reverse()) {
    if (!level.existing) undoOps.push({ action: "deleteRow", model: "project", id: level.id });
  }

  await mutate({
    actor: { kind: "user" },
    verb: "task.capture",
    taskId,
    summary: `Added “${p.title}”`,
    undo: { ops: undoOps },
    apply: async (tx) => {
      for (const level of projectLevels) {
        if (!level.existing) {
          await tx.project.create({
            data: { id: level.id, name: level.name, parentId: level.parentId },
          });
        }
      }
      for (const person of resolvedPeople) {
        if (!person.existing) {
          await tx.person.create({ data: { id: person.id, name: person.name } });
        }
      }
      const task = await tx.task.create({
        data: {
          id: taskId,
          title: p.title,
          projectId: leafProjectId,
          kind,
          kindIsExplicit: p.kindExplicit,
          reason: p.reason,
          source: "typed",
          doDate: p.doDate ? isoToDate(p.doDate) : null,
          doDateSetBy: p.doDate ? "user" : null,
          dueDate: p.dueDate ? isoToDate(p.dueDate) : null,
          dueTime: p.dueTime,
          deferUntil: p.deferUntil ? isoToDate(p.deferUntil) : null,
          estimateMinutes: p.estimateGiven ? p.estimateMinutes : null,
          splittable: p.chunking?.splittable ?? false,
          minChunkMinutes: p.chunking?.minChunkMinutes ?? null,
        },
      });
      for (const person of resolvedPeople) {
        await tx.taskPerson.create({
          data: { taskId, personId: person.id, role: person.role },
        });
      }
      return task;
    },
  });

  revalidatePath("/");
  return { ok: true, summary: `Added “${p.title}”` };
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
