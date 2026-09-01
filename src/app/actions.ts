"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { mutate, undo, type UndoOp } from "@/lib/mutate";
import {
  getTask,
  getProjectById,
  getProjectDeletionSet,
  nextTaskPosition,
  buildCaptureContext,
  resolveProjectPath,
  resolvePerson,
} from "@/lib/queries";
import { parse, inferKind, todayInZone, weekdayOf, type Role, type Kind } from "@/lib/parse";
import { getReminderSettings, planReminders, reminderCreateOps } from "@/lib/reminder-service";

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
  // A new task lands at the end of its project's order (WP3 position).
  const position = await nextTaskPosition(leafProjectId);

  // WP7 · reminders you set. The parser already read the '+' tokens (R16); here
  // they become real Reminder rows with their fire instants computed in the
  // user's zone. The default-reminder toggle adds one when it is on and the user
  // named none — nothing arms itself otherwise (reminders are opt in).
  const reminderSettings = await getReminderSettings();
  const plannedReminders = planReminders({
    dueDate: p.dueDate,
    dueTime: p.dueTime,
    fallbackDate: ctx.today,
    timeZone: reminderSettings.timeZone,
    typed: p.reminders.map((r) => ({ offsetMinutes: r.offsetMinutes, absoluteTime: r.absoluteTime })),
    defaultReminder: reminderSettings.defaultReminder,
  });
  const reminderOps = reminderCreateOps(taskId, plannedReminders);

  // Reversal, in FK-safe order: reminders and links, then task, then anything
  // this capture newly created (people, then projects leaf→root).
  const undoOps: UndoOp[] = [
    ...reminderOps.undo,
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
          position,
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
      for (const r of reminderOps.creates) {
        await tx.reminder.create({ data: r });
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
  revalidatePath("/projects");
  revalidatePath("/review");
  revalidatePath("/board");
}

// ---------------------------------------------------------------------------
// WP3 · projects, sub-projects, notes, review. Every write goes through
// mutate() (invariant 1) with an undo payload that restores the prior state
// (invariant 2). Two levels in the interface is a UI constraint (R20); these
// actions accept any parentId, and the projects page only offers a child under
// a top-level project.
// ---------------------------------------------------------------------------

export async function createProject(formData: FormData) {
  await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const parentId = String(formData.get("parentId") ?? "").trim() || null;

  const id = crypto.randomUUID();
  await mutate({
    actor: { kind: "user" },
    verb: "project.create",
    summary: parentId ? `Added sub-project “${name}”` : `Added project “${name}”`,
    undo: { ops: [{ action: "deleteRow", model: "project", id }] },
    apply: (tx) => tx.project.create({ data: { id, name, parentId } }),
  });

  revalidatePath("/projects");
  revalidatePath("/");
}

export async function toggleProjectHold(formData: FormData) {
  await requireUser();
  const id = String(formData.get("id"));
  const before = await getProjectById(id);
  if (!before) return;
  const onHold = !before.onHold;

  await mutate({
    actor: { kind: "user" },
    verb: "project.hold",
    summary: `${onHold ? "Put" : "Took"} “${before.name}” ${onHold ? "on hold" : "off hold"}`,
    undo: { ops: [{ action: "update", model: "project", id, data: { onHold: before.onHold } }] },
    apply: (tx) => tx.project.update({ where: { id }, data: { onHold } }),
  });

  revalidatePath("/projects");
  revalidatePath("/");
}

export async function toggleProjectSequence(formData: FormData) {
  await requireUser();
  const id = String(formData.get("id"));
  const before = await getProjectById(id);
  if (!before) return;
  const isSequence = !before.isSequence;

  await mutate({
    actor: { kind: "user" },
    verb: "project.sequence",
    summary: `“${before.name}” is ${isSequence ? "now a sequence" : "no longer a sequence"}`,
    undo: { ops: [{ action: "update", model: "project", id, data: { isSequence: before.isSequence } }] },
    apply: (tx) => tx.project.update({ where: { id }, data: { isSequence } }),
  });

  revalidatePath("/projects");
  revalidatePath("/");
}

export async function setReviewInterval(formData: FormData) {
  await requireUser();
  const id = String(formData.get("id"));
  const before = await getProjectById(id);
  if (!before) return;

  const raw = String(formData.get("days") ?? "").trim();
  const parsed = raw === "" ? null : Number.parseInt(raw, 10);
  const days = parsed != null && Number.isFinite(parsed) && parsed > 0 ? parsed : null;

  await mutate({
    actor: { kind: "user" },
    verb: "project.reviewInterval",
    summary: days
      ? `Review “${before.name}” every ${days} day${days === 1 ? "" : "s"}`
      : `Cleared the review interval on “${before.name}”`,
    undo: {
      ops: [
        {
          action: "update",
          model: "project",
          id,
          data: { reviewIntervalDays: before.reviewIntervalDays },
        },
      ],
    },
    apply: (tx) => tx.project.update({ where: { id }, data: { reviewIntervalDays: days } }),
  });

  revalidatePath("/projects");
  revalidatePath("/review");
}

/**
 * Mark a project reviewed: reset its clock (decisions line 312). The write goes
 * through mutate() like everything else, so the review leaves an activity row
 * and undoes back to the previous last-reviewed timestamp.
 */
export async function markProjectReviewed(formData: FormData) {
  await requireUser();
  const id = String(formData.get("id"));
  const before = await getProjectById(id);
  if (!before) return;

  await mutate({
    actor: { kind: "user" },
    verb: "project.reviewed",
    summary: `Reviewed “${before.name}”`,
    undo: {
      ops: [
        {
          action: "update",
          model: "project",
          id,
          data: { lastReviewedAt: before.lastReviewedAt },
        },
      ],
    },
    apply: (tx) => tx.project.update({ where: { id }, data: { lastReviewedAt: new Date() } }),
  });

  revalidatePath("/review");
  revalidatePath("/projects");
}

/**
 * Delete a project, and everything in it, as one reversible set (invariant 2 —
 * a delete sets deleted_at and nothing else; no confirmation dialog, because it
 * undoes). The sub-projects beneath it and their live tasks go with it, and one
 * undo restores the whole set. Deletion is enforced in the read queries, so the
 * project then disappears from the tree, from board grouping and from review at
 * once.
 */
export async function deleteProject(formData: FormData) {
  await requireUser();
  const id = String(formData.get("id"));
  const project = await getProjectById(id);
  if (!project || project.deletedAt) return;

  const { projectIds, taskIds } = await getProjectDeletionSet(id);
  const now = new Date();

  // Undo restores exactly the rows this delete takes — the project, its
  // sub-projects and their live tasks — back to not-deleted. Rows that were
  // already deleted were never in the set, so undo never resurrects them.
  const undoOps: UndoOp[] = [
    ...projectIds.map((pid) => ({
      action: "update" as const,
      model: "project" as const,
      id: pid,
      data: { deletedAt: null },
    })),
    ...taskIds.map((tid) => ({
      action: "update" as const,
      model: "task" as const,
      id: tid,
      data: { deletedAt: null },
    })),
  ];

  const subCount = projectIds.length - 1;
  const parts: string[] = [];
  if (subCount > 0) parts.push(`${subCount} sub-project${subCount === 1 ? "" : "s"}`);
  if (taskIds.length > 0) parts.push(`${taskIds.length} task${taskIds.length === 1 ? "" : "s"}`);
  const summary = parts.length
    ? `Deleted “${project.name}” and everything in it — ${parts.join(", ")}`
    : `Deleted “${project.name}”`;

  await mutate({
    actor: { kind: "user" },
    verb: "project.delete",
    filterKind: "deletions",
    summary,
    undo: { ops: undoOps },
    apply: async (tx) => {
      await tx.project.updateMany({ where: { id: { in: projectIds } }, data: { deletedAt: now } });
      if (taskIds.length > 0) {
        await tx.task.updateMany({ where: { id: { in: taskIds } }, data: { deletedAt: now } });
      }
    },
  });

  revalidatePath("/projects");
  revalidatePath("/board");
  revalidatePath("/review");
  revalidatePath("/");
}

/** Add a note. Stands alone when no taskId is given, or attaches to a task. */
export async function addNote(formData: FormData) {
  await requireUser();
  const body = String(formData.get("body") ?? "").trim();
  if (!body) return;
  const taskId = String(formData.get("taskId") ?? "").trim() || null;

  const id = crypto.randomUUID();
  await mutate({
    actor: { kind: "user" },
    verb: "note.create",
    taskId,
    summary: taskId ? "Added a note to a task" : "Added a standalone note",
    undo: { ops: [{ action: "deleteRow", model: "note", id }] },
    apply: (tx) => tx.note.create({ data: { id, body, taskId } }),
  });

  revalidatePath("/");
  revalidatePath("/projects");
}
