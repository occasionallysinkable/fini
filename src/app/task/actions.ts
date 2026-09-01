"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { mutate, type UndoOp } from "@/lib/mutate";
import {
  getTask,
  getTaskPageData,
  getUserSettingsRow,
  getReminder,
  getEnabledReminders,
  resolvePerson,
} from "@/lib/queries";
import { clampSidebarWidth, SIDEBAR_WIDTH_KEY, type TaskPageData } from "@/lib/task-page";
import type { Role } from "@/lib/parse";
import { computeFireTime, wallToUtc, reminderLabel, PRESETS } from "@/lib/reminders";
import {
  getReminderSettings,
  reminderRescheduleOps,
  type ReschedulableReminder,
} from "@/lib/reminder-service";

/*
  WP6 · the task page's writes. Every one goes through mutate() (invariant 1)
  with an undo payload that restores the prior state (invariant 2) — there is no
  save button because every edit undoes from the activity page (R6). Each action
  returns the freshly-read page so the sidebar updates in one round-trip.

  What the task page deliberately does NOT write: do_date (its owners are the
  calendar, the queue and the not-today branch — invariant 6) and actual_minutes
  (recorded at close of day). Both are shown read-only. Reminders are WP7.
*/

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Not signed in.");
  return session.user;
}

function isoToDateOrNull(raw: string): Date | null {
  const v = raw.trim();
  return v ? new Date(`${v}T00:00:00.000Z`) : null;
}

/** Re-read the page and revalidate the surfaces a task edit can change. */
async function reloadAndRevalidate(id: string): Promise<TaskPageData | null> {
  revalidatePath("/board");
  revalidatePath("/");
  return getTaskPageData(id);
}

/** Load (or reload) the sidebar's data. A server action so the client sidebar
 *  can fetch on open and after each edit without its own API route. */
export async function loadTaskPage(id: string): Promise<TaskPageData | null> {
  await requireUser();
  return getTaskPageData(id);
}

export type EditField =
  | "title"
  | "dueDate"
  | "dueTime"
  | "deferUntil"
  | "estimate"
  | "splittable"
  | "minChunk";

/**
 * Edit one field of the task in place (R6: edit in place, no save button). One
 * generic write covers every editable field, each reversing to its prior value.
 */
export async function editTaskPageField(input: {
  id: string;
  field: EditField;
  value: string;
}): Promise<TaskPageData | null> {
  await requireUser();
  const { id, field, value } = input;
  const before = await getTask(id);
  if (!before || before.deletedAt) return null;

  let data: Record<string, unknown>;
  let undoData: Record<string, unknown>;
  let summary: string;
  let filterKind: "dates" | null = null;

  switch (field) {
    case "title": {
      const v = value.trim();
      if (!v || v === before.title) return getTaskPageData(id);
      data = { title: v };
      undoData = { title: before.title };
      summary = `Renamed “${before.title}” to “${v}”`;
      break;
    }
    case "dueDate": {
      // due_date moves only on an explicit user action — this is one (invariant 6).
      const v = isoToDateOrNull(value);
      data = { dueDate: v };
      undoData = { dueDate: before.dueDate };
      summary = v
        ? `Due date on “${before.title}” set to ${value.trim()}`
        : `Cleared the due date on “${before.title}”`;
      filterKind = "dates";
      break;
    }
    case "dueTime": {
      const v = value.trim();
      if (v && !/^\d{2}:\d{2}$/.test(v)) return getTaskPageData(id);
      const next = v || null;
      data = { dueTime: next };
      undoData = { dueTime: before.dueTime };
      summary = next
        ? `Due time on “${before.title}” set to ${next}`
        : `Cleared the due time on “${before.title}”`;
      filterKind = "dates";
      break;
    }
    case "deferUntil": {
      const v = isoToDateOrNull(value);
      data = { deferUntil: v };
      undoData = { deferUntil: before.deferUntil };
      summary = v
        ? `Deferred “${before.title}” to ${value.trim()}`
        : `Cleared the defer date on “${before.title}”`;
      filterKind = "dates";
      break;
    }
    case "estimate": {
      const v = value.trim() === "" ? null : Number.parseInt(value, 10);
      if (v != null && (!Number.isFinite(v) || v <= 0)) return getTaskPageData(id);
      data = { estimateMinutes: v };
      undoData = { estimateMinutes: before.estimateMinutes };
      summary =
        v == null ? `Cleared the estimate on “${before.title}”` : `Estimate ${v}m on “${before.title}”`;
      break;
    }
    case "splittable": {
      const v = value === "true";
      if (v === before.splittable) return getTaskPageData(id);
      data = { splittable: v };
      undoData = { splittable: before.splittable };
      summary = `“${before.title}” is ${v ? "splittable" : "one run"}`;
      break;
    }
    case "minChunk": {
      const v = value.trim() === "" ? null : Number.parseInt(value, 10);
      if (v != null && (!Number.isFinite(v) || v <= 0)) return getTaskPageData(id);
      data = { minChunkMinutes: v };
      undoData = { minChunkMinutes: before.minChunkMinutes };
      summary =
        v == null
          ? `Cleared the smallest piece on “${before.title}”`
          : `Smallest piece ${v}m on “${before.title}”`;
      break;
    }
    default:
      return getTaskPageData(id);
  }

  // Moving the due date or time reschedules every offset reminder on the task in
  // the same write, so the change and the reschedule reverse together
  // (reminders.md: "Every offset reminder moves with it"). Absolute reminders are
  // left where they are.
  const reminderApply: UndoOp[] = [];
  const reminderUndo: UndoOp[] = [];
  if (field === "dueDate" || field === "dueTime") {
    const [reminders, settings] = await Promise.all([getEnabledReminders(id), getReminderSettings()]);
    if (reminders.length > 0) {
      const newDue =
        field === "dueDate"
          ? { dueDate: value.trim() || null, dueTime: before.dueTime }
          : { dueDate: dateToIso(before.dueDate), dueTime: value.trim() || null };
      const ops = reminderRescheduleOps(
        reminders as ReschedulableReminder[],
        newDue,
        settings.timeZone
      );
      reminderApply.push(...ops.apply);
      reminderUndo.push(...ops.undo);
    }
  }

  await mutate({
    actor: { kind: "user" },
    verb: `task.page.${field}`,
    taskId: id,
    summary,
    filterKind,
    undo: { ops: [{ action: "update", model: "task", id, data: undoData }, ...reminderUndo] },
    apply: async (tx) => {
      const updated = await tx.task.update({ where: { id }, data });
      for (const op of reminderApply) {
        if (op.action === "update") {
          await tx.reminder.update({ where: { id: op.id }, data: op.data });
        }
      }
      return updated;
    },
  });

  return reloadAndRevalidate(id);
}

/** A stored date column (midnight-UTC) back to "YYYY-MM-DD". */
function dateToIso(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

const ROLES = new Set<Role>(["asked_by", "waiting_on", "delegated_to", "assignee"]);

/**
 * Attach a person to the task as a person-and-role pair (R7). The human is named
 * first, an unknown name is created in the same keystroke, then a role is picked.
 * The whole pair — and the person, if this created them — reverses from one
 * ledger line. A pair that already exists is a no-op.
 */
export async function addTaskPerson(input: {
  id: string;
  name: string;
  role: Role;
}): Promise<TaskPageData | null> {
  await requireUser();
  const { id, role } = input;
  const name = input.name.trim();
  if (!name || !ROLES.has(role)) return getTaskPageData(id);

  const task = await getTask(id);
  if (!task || task.deletedAt) return null;

  const person = await resolvePerson(name);

  const undoOps: UndoOp[] = [
    { action: "deleteWhere", model: "taskPerson", where: { taskId: id, personId: person.id, role } },
  ];
  if (!person.existing) {
    undoOps.push({ action: "deleteRow", model: "person", id: person.id });
  }

  await mutate({
    actor: { kind: "user" },
    verb: "task.page.addPerson",
    taskId: id,
    filterKind: "people",
    summary: `${person.existing ? "Added" : "Created"} ${name} on “${task.title}”`,
    undo: { ops: undoOps },
    apply: async (tx) => {
      if (!person.existing) {
        await tx.person.create({ data: { id: person.id, name } });
      }
      // Skip if the exact pair is already present (idempotent, no collision).
      const already = await tx.taskPerson.findUnique({
        where: { taskId_personId_role: { taskId: id, personId: person.id, role } },
      });
      if (!already) {
        await tx.taskPerson.create({ data: { taskId: id, personId: person.id, role } });
      }
    },
  });

  return reloadAndRevalidate(id);
}

/** Add a note to the task (R6: the Notes section). Stands as its own reversible
 *  write, like every other. */
export async function addTaskNote(input: { id: string; body: string }): Promise<TaskPageData | null> {
  await requireUser();
  const body = input.body.trim();
  if (!body) return getTaskPageData(input.id);
  const task = await getTask(input.id);
  if (!task || task.deletedAt) return null;

  const noteId = crypto.randomUUID();
  await mutate({
    actor: { kind: "user" },
    verb: "task.page.addNote",
    taskId: input.id,
    summary: `Added a note to “${task.title}”`,
    undo: { ops: [{ action: "deleteRow", model: "note", id: noteId }] },
    apply: (tx) => tx.note.create({ data: { id: noteId, body, taskId: input.id } }),
  });

  return reloadAndRevalidate(input.id);
}

/**
 * Persist the sidebar's dragged width (R6: "its width is remembered"). It lives
 * in user.settings under SIDEBAR_WIDTH_KEY — the same key WP10 reads. The write
 * goes through mutate() like every other (invariant 1) and undoes to the prior
 * settings. Called on drag-end only, so a resize is one write, not a stream.
 */
export async function setSidebarWidth(width: number): Promise<void> {
  await requireUser();
  const clamped = clampSidebarWidth(width);
  const user = await getUserSettingsRow();
  if (!user) return;
  const prev = (user.settings ?? {}) as Record<string, unknown>;
  if (prev[SIDEBAR_WIDTH_KEY] === clamped) return;
  const next = { ...prev, [SIDEBAR_WIDTH_KEY]: clamped };

  await mutate({
    actor: { kind: "user" },
    verb: "settings.sidebarWidth",
    summary: `Sidebar width ${clamped}px`,
    undo: { ops: [{ action: "update", model: "user", id: user.id, data: { settings: prev } }] },
    apply: (tx) => tx.user.update({ where: { id: user.id }, data: { settings: next } }),
  });

  revalidatePath("/board");
}

// ---------------------------------------------------------------------------
// WP7 · reminders on the task page. A preset is an offset from the due time (so
// moving the deadline moves it); a custom reminder is an absolute date and time
// that stays put. Both compute their fire instant in the user's zone. Removing a
// reminder disables it rather than destroying the row (invariant 2), so it
// reverses like every other write.
// ---------------------------------------------------------------------------

export async function addReminder(input: {
  id: string;
  presetId?: string;
  absoluteDate?: string;
  absoluteTime?: string;
}): Promise<TaskPageData | null> {
  await requireUser();
  const task = await getTask(input.id);
  if (!task || task.deletedAt) return null;
  const settings = await getReminderSettings();

  const reminderId = crypto.randomUUID();
  let data: { offsetMinutes: number | null; absoluteAt: Date | null; nextFireAtUtc: Date | null };

  if (input.presetId) {
    const preset = PRESETS.find((p) => p.id === input.presetId);
    if (!preset) return getTaskPageData(input.id);
    // A preset needs a due date to offset from; the UI does not offer it without
    // one, and this guards the action path too.
    if (!task.dueDate) return getTaskPageData(input.id);
    const nextFireAtUtc = computeFireTime({
      dueDate: dateToIso(task.dueDate),
      dueTime: task.dueTime,
      timeZone: settings.timeZone,
      offsetMinutes: preset.offsetMinutes,
    });
    data = { offsetMinutes: preset.offsetMinutes, absoluteAt: null, nextFireAtUtc };
  } else if (input.absoluteDate && input.absoluteTime) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.absoluteDate) || !/^\d{2}:\d{2}$/.test(input.absoluteTime)) {
      return getTaskPageData(input.id);
    }
    const absoluteAt = wallToUtc(input.absoluteDate, input.absoluteTime, settings.timeZone);
    data = { offsetMinutes: null, absoluteAt, nextFireAtUtc: absoluteAt };
  } else {
    return getTaskPageData(input.id);
  }

  await mutate({
    actor: { kind: "user" },
    verb: "reminder.add",
    taskId: input.id,
    filterKind: "reminders",
    summary: `Added a reminder (${reminderLabel({ offsetMinutes: data.offsetMinutes, absoluteAt: data.absoluteAt })}) on “${task.title}”`,
    undo: { ops: [{ action: "deleteRow", model: "reminder", id: reminderId }] },
    apply: (tx) => tx.reminder.create({ data: { id: reminderId, taskId: input.id, ...data } }),
  });

  return reloadAndRevalidate(input.id);
}

export async function removeReminder(input: { id: string; reminderId: string }): Promise<TaskPageData | null> {
  await requireUser();
  const reminder = await getReminder(input.reminderId);
  if (!reminder || reminder.taskId !== input.id || !reminder.enabled) return getTaskPageData(input.id);
  const task = await getTask(input.id);

  await mutate({
    actor: { kind: "user" },
    verb: "reminder.remove",
    taskId: input.id,
    filterKind: "reminders",
    summary: `Removed a reminder on “${task?.title ?? "a task"}”`,
    undo: {
      ops: [
        {
          action: "update",
          model: "reminder",
          id: input.reminderId,
          data: { enabled: reminder.enabled, nextFireAtUtc: reminder.nextFireAtUtc },
        },
      ],
    },
    apply: (tx) =>
      tx.reminder.update({ where: { id: input.reminderId }, data: { enabled: false, nextFireAtUtc: null } }),
  });

  return reloadAndRevalidate(input.id);
}
