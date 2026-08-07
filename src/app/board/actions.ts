"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { mutate, type UndoOp } from "@/lib/mutate";
import {
  getTasksByIds,
  getProjectById,
  getTask,
  nextTaskPosition,
  nextSavedViewPosition,
} from "@/lib/queries";
import type { Kind } from "@/lib/parse";

// The closed status set, kept local so app code does not import @prisma/client.
type TaskStatus = "active" | "done" | "cancelled" | "someday";

/*
  WP4 · the board's writes. Every one goes through mutate() (invariant 1) with an
  undo payload that restores the prior state (invariant 2) — bulk actions
  included, so acting on many rows at once still reverses from a single ledger
  line. The action bar carries no confirmation dialog because every action
  undoes (decisions line 76, invariant 2).
*/

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Not signed in.");
  return session.user;
}

const KINDS = new Set<Kind>(["commitment", "own", "habit", "unassigned"]);

export interface BulkResult {
  ok?: boolean;
  summary?: string;
  /** The activity row's id, so the bar can offer inline undo (invariant 8). */
  activityId?: string;
  error?: string;
}

function plural(n: number): string {
  return n === 1 ? "task" : "tasks";
}

/**
 * Apply one action to every selected task in a single write. The change and a
 * per-task reversal are built together, so the whole selection reverses as one.
 * Actions: kill (soft-delete), kind, project, estimate, push.
 */
export async function bulkAction(
  _prev: BulkResult,
  formData: FormData
): Promise<BulkResult> {
  await requireUser();

  let ids: string[];
  try {
    ids = JSON.parse(String(formData.get("ids") ?? "[]"));
  } catch {
    ids = [];
  }
  const action = String(formData.get("action") ?? "");
  const value = String(formData.get("value") ?? "");
  if (!Array.isArray(ids) || ids.length === 0) return { error: "Nothing selected." };

  const tasks = await getTasksByIds(ids);
  if (tasks.length === 0) return { error: "Those tasks are gone." };
  const n = tasks.length;

  // Each branch builds: the forward data per task, the undo op per task, a verb,
  // a summary sentence, and an optional activity filter kind.
  let apply: (tx: Parameters<Parameters<typeof mutate>[0]["apply"]>[0]) => Promise<unknown>;
  const undoOps: UndoOp[] = [];
  let verb = "";
  let summary = "";
  let filterKind: "deletions" | null = null;

  switch (action) {
    case "kill": {
      verb = "task.bulkKill";
      summary = `Killed ${n} ${plural(n)}`;
      filterKind = "deletions";
      const now = new Date();
      for (const t of tasks) {
        undoOps.push({ action: "update", model: "task", id: t.id, data: { deletedAt: null } });
      }
      apply = (tx) =>
        tx.task.updateMany({ where: { id: { in: tasks.map((t) => t.id) } }, data: { deletedAt: now } });
      break;
    }
    case "kind": {
      if (!KINDS.has(value as Kind)) return { error: "Not a kind." };
      verb = "task.bulkKind";
      summary = `Set ${n} ${plural(n)} to ${value}`;
      for (const t of tasks) {
        undoOps.push({
          action: "update",
          model: "task",
          id: t.id,
          data: { kind: t.kind, kindIsExplicit: t.kindIsExplicit },
        });
      }
      apply = (tx) =>
        tx.task.updateMany({
          where: { id: { in: tasks.map((t) => t.id) } },
          // A hand-set kind is explicit, so inference will not overwrite it (R17).
          data: { kind: value as Kind, kindIsExplicit: true },
        });
      break;
    }
    case "project": {
      const projectId = value || null;
      let label = "No project";
      if (projectId) {
        const project = await getProjectById(projectId);
        if (!project) return { error: "No such project." };
        label = project.name;
      }
      verb = "task.bulkProject";
      summary = `Moved ${n} ${plural(n)} to ${label}`;
      for (const t of tasks) {
        undoOps.push({
          action: "update",
          model: "task",
          id: t.id,
          data: { projectId: t.projectId },
        });
      }
      apply = (tx) =>
        tx.task.updateMany({ where: { id: { in: tasks.map((t) => t.id) } }, data: { projectId } });
      break;
    }
    case "estimate": {
      const minutes = Number.parseInt(value, 10);
      if (!Number.isFinite(minutes) || minutes <= 0) return { error: "Give minutes as a number." };
      verb = "task.bulkEstimate";
      summary = `Set estimate ${minutes}m on ${n} ${plural(n)}`;
      for (const t of tasks) {
        undoOps.push({
          action: "update",
          model: "task",
          id: t.id,
          data: { estimateMinutes: t.estimateMinutes },
        });
      }
      apply = (tx) =>
        tx.task.updateMany({
          where: { id: { in: tasks.map((t) => t.id) } },
          data: { estimateMinutes: minutes },
        });
      break;
    }
    case "push": {
      // Push raises a task's standing so buried work resurfaces (the ranking's
      // push count). One increment per task, reversed to each prior count.
      verb = "task.bulkPush";
      summary = `Pushed ${n} ${plural(n)}`;
      for (const t of tasks) {
        undoOps.push({
          action: "update",
          model: "task",
          id: t.id,
          data: { pushCount: t.pushCount },
        });
      }
      apply = async (tx) => {
        for (const t of tasks) {
          await tx.task.update({ where: { id: t.id }, data: { pushCount: t.pushCount + 1 } });
        }
      };
      break;
    }
    default:
      return { error: "Unknown action." };
  }

  const { activity } = await mutate({
    actor: { kind: "user" },
    verb,
    summary,
    filterKind,
    undo: { ops: undoOps },
    apply,
  });

  revalidatePath("/board");
  revalidatePath("/");
  return { ok: true, summary, activityId: activity.id };
}

/**
 * Edit one field of one task in place (decisions line 75: clicking a row does
 * nothing — the fields edit in place). One generic write covers every editable
 * column, each reversing to its prior value. do_date is deliberately not here:
 * its owners are the calendar, the queue and the not-today branch (invariant 6),
 * so the board does not write it.
 */
const KIND_SET = new Set<Kind>(["commitment", "own", "habit", "unassigned"]);
const STATUS_SET = new Set<TaskStatus>(["active", "done", "cancelled", "someday"]);

function isoToDateOrNull(raw: string): Date | null {
  const v = raw.trim();
  return v ? new Date(`${v}T00:00:00.000Z`) : null;
}

export async function editTaskField(formData: FormData): Promise<void> {
  await requireUser();
  const id = String(formData.get("taskId") ?? "");
  const field = String(formData.get("field") ?? "");
  const raw = String(formData.get("value") ?? "");
  const before = await getTask(id);
  if (!before || before.deletedAt) return;

  let data: Record<string, unknown>;
  let undoData: Record<string, unknown>;
  let summary: string;

  switch (field) {
    case "title": {
      const v = raw.trim();
      if (!v || v === before.title) return;
      data = { title: v };
      undoData = { title: before.title };
      summary = `Renamed “${before.title}” to “${v}”`;
      break;
    }
    case "project": {
      const projectId = raw || null;
      if (projectId === before.projectId) return;
      let label = "No project";
      if (projectId) {
        const p = await getProjectById(projectId);
        if (!p) return;
        label = p.name;
      }
      data = { projectId };
      undoData = { projectId: before.projectId };
      summary = `Moved “${before.title}” to ${label}`;
      break;
    }
    case "estimate": {
      const v = raw.trim() === "" ? null : Number.parseInt(raw, 10);
      if (v != null && (!Number.isFinite(v) || v <= 0)) return;
      data = { estimateMinutes: v };
      undoData = { estimateMinutes: before.estimateMinutes };
      summary = v == null ? `Cleared the estimate on “${before.title}”` : `Estimate ${v}m on “${before.title}”`;
      break;
    }
    case "dueDate": {
      // due_date moves only on an explicit user action — this is one (invariant 6).
      const v = isoToDateOrNull(raw);
      data = { dueDate: v };
      undoData = { dueDate: before.dueDate };
      summary = v ? `Due date on “${before.title}” set to ${raw}` : `Cleared the due date on “${before.title}”`;
      break;
    }
    case "deferUntil": {
      const v = isoToDateOrNull(raw);
      data = { deferUntil: v };
      undoData = { deferUntil: before.deferUntil };
      summary = v ? `Deferred “${before.title}” to ${raw}` : `Cleared the defer date on “${before.title}”`;
      break;
    }
    case "kind": {
      if (!KIND_SET.has(raw as Kind) || raw === before.kind) return;
      data = { kind: raw as Kind, kindIsExplicit: true };
      undoData = { kind: before.kind, kindIsExplicit: before.kindIsExplicit };
      summary = `Set “${before.title}” to ${raw}`;
      break;
    }
    case "status": {
      if (!STATUS_SET.has(raw as TaskStatus) || raw === before.status) return;
      data = { status: raw as TaskStatus };
      undoData = { status: before.status };
      summary = `“${before.title}” is ${raw}`;
      break;
    }
    default:
      return;
  }

  await mutate({
    actor: { kind: "user" },
    verb: `task.edit.${field}`,
    taskId: id,
    summary,
    filterKind: field === "dueDate" || field === "deferUntil" ? "dates" : null,
    undo: { ops: [{ action: "update", model: "task", id, data: undoData }] },
    apply: (tx) => tx.task.update({ where: { id }, data }),
  });

  revalidatePath("/board");
  revalidatePath("/");
}

/**
 * Quick-add from a board row (decisions line 67–68). A blank row already carries
 * its group's project when grouped by project; the pinned row asks for the
 * project when not. Just a title and a project — the board is deliberately not
 * the main way in (decisions line 69), so this does not run the full parser.
 */
export async function quickAddTask(formData: FormData) {
  await requireUser();
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;
  const projectId = String(formData.get("projectId") ?? "").trim() || null;

  const id = crypto.randomUUID();
  const position = await nextTaskPosition(projectId);
  await mutate({
    actor: { kind: "user" },
    verb: "task.quickAdd",
    taskId: id,
    summary: `Added “${title}”`,
    undo: { ops: [{ action: "deleteRow", model: "task", id }] },
    apply: (tx) =>
      tx.task.create({ data: { id, title, projectId, position, source: "typed" } }),
  });

  revalidatePath("/board");
  revalidatePath("/");
}

/**
 * Save the current filtered view (decisions line 66: created only from a
 * filtered state, never a blank form). The client shows the control only when
 * filter chips are present, so a save always carries a filter.
 */
export async function createSavedView(formData: FormData) {
  await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;

  let config: { columns: unknown; grouping: unknown; sort: unknown; filter: unknown };
  try {
    config = JSON.parse(String(formData.get("config") ?? "{}"));
  } catch {
    return;
  }

  const id = crypto.randomUUID();
  const position = await nextSavedViewPosition();
  await mutate({
    actor: { kind: "user" },
    verb: "savedView.create",
    summary: `Saved the view “${name}”`,
    undo: { ops: [{ action: "deleteRow", model: "savedView", id }] },
    apply: (tx) =>
      tx.savedView.create({
        data: {
          id,
          name,
          position,
          columns: (config.columns ?? []) as object,
          grouping: (config.grouping ?? []) as object,
          sort: (config.sort ?? {}) as object,
          filter: (config.filter ?? []) as object,
        },
      }),
  });

  revalidatePath("/board");
}
