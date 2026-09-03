"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { mutate, undo, type UndoOp } from "@/lib/mutate";
import {
  getTask,
  getProjectById,
  getProjectDeletionSet,
  getBlocker,
  getOverride,
  nextTaskPosition,
  buildCaptureContext,
  resolveProjectPath,
  resolvePerson,
} from "@/lib/queries";
import { parse, inferKind, todayInZone, weekdayOf, type Role, type Kind } from "@/lib/parse";
import { spawnNextOccurrenceOps } from "@/lib/recurrence-service";
import { shortDate, overrideReason, type OverrideReasonCode } from "@/lib/today";
import { getReminderSettings, planReminders, reminderCreateOps } from "@/lib/reminder-service";
import { firstOccurrenceOnOrAfter, type RecurrenceSpec } from "@/lib/recurrence";
import {
  planCapturedRecurrence,
  type RecurrenceTemplate,
  type CapturedRecurrencePlan,
} from "@/lib/recurrence-service";

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

  const reminderSettings = await getReminderSettings();

  // WP8 · recurrence. When the line carried an `every`/`every!` token, capture
  // creates the rule and the FIRST occurrence together. The recurrence supplies
  // the occurrence's date — so a bare "at 9am" that the parser read as a due time
  // today becomes the time on the first scheduled date, not today. The date lands
  // on due_date for a deadline (a due time/keyword, or a commitment) and on
  // do_date otherwise (a habit is a day you work on it, placed by the app).
  let recurrencePlan: CapturedRecurrencePlan | null = null;
  // Effective dates the reminders and the task columns key off. Default to the
  // parser's own reading; recurrence overrides them below.
  let occDueDate: Date | null = p.dueDate ? isoToDate(p.dueDate) : null;
  let occDoDate: Date | null = p.doDate ? isoToDate(p.doDate) : null;
  let occDoDateSetBy: "user" | "app" | null = p.doDate ? "user" : null;
  let occurrenceDate: Date | null = null;
  let recurrenceRuleId: string | null = null;
  let reminderDueDateIso: string | null = p.dueDate;

  if (p.recurrence) {
    const spec: RecurrenceSpec = {
      pattern: p.recurrence.pattern,
      weekdays: p.recurrence.weekdays,
      dayOfMonth: p.recurrence.dayOfMonth,
      n: p.recurrence.n,
      mode: p.recurrence.mode,
    };
    const firstDate = firstOccurrenceOnOrAfter(spec, ctx.today);
    const dateKind: "due" | "do" =
      p.dueTime || p.dueKeyword || kind === "commitment" ? "due" : "do";
    const template: RecurrenceTemplate = {
      title: p.title,
      projectId: leafProjectId,
      categoryId: null,
      kind,
      kindIsExplicit: p.kindExplicit,
      reason: p.reason,
      estimateMinutes: p.estimateGiven ? p.estimateMinutes : null,
      splittable: p.chunking?.splittable ?? false,
      minChunkMinutes: p.chunking?.minChunkMinutes ?? null,
      dueTime: p.dueTime,
      dateKind,
      people: resolvedPeople.map((pp) => ({ personId: pp.id, role: pp.role })),
      reminders: p.reminders.map((r) =>
        r.absoluteTime
          ? ({ kind: "absolute", time: r.absoluteTime } as const)
          : ({ kind: "offset", offsetMinutes: r.offsetMinutes ?? 0 } as const)
      ),
    };
    recurrencePlan = planCapturedRecurrence({ spec, today: ctx.today, template, firstDate });
    occDueDate = recurrencePlan.occurrence.dueDate;
    occDoDate = recurrencePlan.occurrence.doDate;
    occDoDateSetBy = recurrencePlan.occurrence.doDateSetBy;
    occurrenceDate = recurrencePlan.occurrence.occurrenceDate;
    recurrenceRuleId = recurrencePlan.ruleId;
    reminderDueDateIso = dateKind === "due" ? firstDate : null;
  }

  // WP7 · reminders you set. The parser already read the '+' tokens (R16); here
  // they become real Reminder rows with their fire instants computed in the
  // user's zone. The default-reminder toggle adds one when it is on and the user
  // named none — nothing arms itself otherwise (reminders are opt in). With a
  // recurrence, the first occurrence's date is what they fire against.
  const plannedReminders = planReminders({
    dueDate: reminderDueDateIso,
    dueTime: p.dueTime,
    fallbackDate: recurrencePlan ? recurrencePlan.firstDate : ctx.today,
    timeZone: reminderSettings.timeZone,
    typed: p.reminders.map((r) => ({ offsetMinutes: r.offsetMinutes, absoluteTime: r.absoluteTime })),
    defaultReminder: reminderSettings.defaultReminder,
  });
  const reminderOps = reminderCreateOps(taskId, plannedReminders);

  // Reversal, in FK-safe order: reminders and links, then task, then the rule
  // (the task points at it), then anything this capture newly created (people,
  // then projects leaf→root).
  const undoOps: UndoOp[] = [
    ...reminderOps.undo,
    { action: "deleteWhere", model: "taskPerson", where: { taskId } },
    { action: "deleteRow", model: "task", id: taskId },
  ];
  if (recurrencePlan) undoOps.push(recurrencePlan.ruleUndo);
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
      // The rule is created before the task that points at it (WP8).
      if (recurrencePlan) {
        await tx.recurrenceRule.create({
          data: {
            id: recurrencePlan.ruleData.id,
            pattern: recurrencePlan.ruleData.pattern,
            weekdays: recurrencePlan.ruleData.weekdays,
            dayOfMonth: recurrencePlan.ruleData.dayOfMonth,
            n: recurrencePlan.ruleData.n,
            mode: recurrencePlan.ruleData.mode,
            template: recurrencePlan.ruleData.template as unknown as object,
          },
        });
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
          recurrenceRuleId,
          occurrenceDate,
          doDate: occDoDate,
          doDateSetBy: occDoDateSetBy,
          dueDate: occDueDate,
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
  revalidatePath("/activity");
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

// ---------------------------------------------------------------------------
// WP9 · today's three answers (R1, R2, R3) and their ledger (R4). Each answer
// goes through mutate() (invariant 1) and returns the activity id + its summary
// so the screen can print the one ledger line and offer undo (U) on it. Every
// answer is reversible; there are no confirmation dialogs (invariant 2).
//
// What each answer writes is the whole difference between them (decisions 113):
//   • Done      — completes the task, reusing the SAME completion path as the
//                 board's status→done (completedAt + the WP8 recurrence spawn).
//   • Not today — moves the do date only, never the due date (invariant 6).
//   • Waiting   — writes a person + a blocker; the expected-by seeds the do date.
//   • Something else — records an override and moves NO date (decisions 250).
// ---------------------------------------------------------------------------

export interface TodayAnswer {
  ok?: boolean;
  activityId?: string;
  summary?: string;
  error?: string;
  /** For something-else: the override row, so a reason can be attached after. */
  overrideId?: string;
}

/**
 * Done. Completes the task through the same path the board's status→done uses
 * (src/app/board/actions.ts · editTaskField): it stamps completedAt so habit
 * history and recency reads work, and it spawns the next recurrence occurrence
 * in the SAME write (WP8) so a completion never loses the next occurrence. The
 * whole thing reverses from one ledger line.
 */
export async function completeTaskToday(id: string): Promise<TodayAnswer> {
  await requireUser();
  const before = await getTask(id);
  if (!before || before.deletedAt) return { error: "That task is gone." };
  if (before.status === "done") return { error: "Already done." };

  const spawn = await spawnNextOccurrenceOps(id);
  const summary = spawn ? `Done: “${before.title}” · ${spawn.summary}` : `Done: “${before.title}”`;

  const { activity } = await mutate({
    actor: { kind: "user" },
    verb: "today.done",
    taskId: id,
    summary,
    undo: {
      ops: [
        ...(spawn?.undo ?? []),
        {
          action: "update",
          model: "task",
          id,
          data: { status: before.status, completedAt: before.completedAt },
        },
      ],
    },
    apply: async (tx) => {
      await tx.task.update({ where: { id }, data: { status: "done", completedAt: new Date() } });
      if (spawn) await spawn.run(tx);
    },
  });

  revalidatePath("/");
  revalidatePath("/board");
  return { ok: true, activityId: activity.id, summary };
}

/**
 * Not today → a date (tomorrow, the named weekday, or a picked day) or "no date".
 * Moves the do date and nothing else — the due date is untouched (invariant 6),
 * because a deadline is not rescheduled by deciding not to do it today. The
 * label is the word the row showed, echoed back into the ledger.
 */
export async function notTodayMove(
  id: string,
  dateIso: string,
  label: string
): Promise<TodayAnswer> {
  await requireUser();
  const before = await getTask(id);
  if (!before || before.deletedAt) return { error: "That task is gone." };

  const doDate = dateIso ? isoToDate(dateIso) : null;
  const summary = `Not today → ${label} · “${before.title}”`;

  const { activity } = await mutate({
    actor: { kind: "user" },
    verb: "today.notToday",
    taskId: id,
    filterKind: "dates",
    summary,
    undo: {
      ops: [
        {
          action: "update",
          model: "task",
          id,
          data: { doDate: before.doDate, doDateSetBy: before.doDateSetBy },
        },
      ],
    },
    // The do date is one the user chose for themselves, so it is user-set.
    apply: (tx) =>
      tx.task.update({ where: { id }, data: { doDate, doDateSetBy: doDate ? "user" : null } }),
  });

  revalidatePath("/");
  revalidatePath("/board");
  return { ok: true, activityId: activity.id, summary };
}

/**
 * Not today → waiting on someone (R3). Names a person (creating an unknown name
 * in the same keystroke), writes a blocker with the expected-by date, and seeds
 * the do date from that date — the due date stays put (invariant 6, decisions
 * 113). The whole thing reverses from one line.
 *
 * Deferred to WP15, with the seam noted: suspending the task's reminders while
 * it is blocked, and the nightly job that flips a passed expected-by to "late".
 * The schema (blocker.state) already carries what those need.
 */
export async function notTodayWaiting(
  id: string,
  personName: string,
  expectedByIso: string
): Promise<TodayAnswer> {
  await requireUser();
  const before = await getTask(id);
  if (!before || before.deletedAt) return { error: "That task is gone." };
  const name = personName.trim();
  if (!name) return { error: "Name the person you are waiting on." };

  const person = await resolvePerson(name);
  const blockerId = crypto.randomUUID();
  const expectedBy = expectedByIso ? isoToDate(expectedByIso) : null;
  const seededDo = expectedBy; // the expected-by seeds the do date (decisions 113)
  const whenWord = expectedByIso ? `, expected ${shortDate(expectedByIso)}` : "";
  const summary = `Waiting on ${name}${whenWord} · “${before.title}”`;

  const undoOps: UndoOp[] = [
    {
      action: "update",
      model: "task",
      id,
      data: { doDate: before.doDate, doDateSetBy: before.doDateSetBy },
    },
    { action: "deleteRow", model: "blocker", id: blockerId },
  ];
  if (!person.existing) undoOps.push({ action: "deleteRow", model: "person", id: person.id });

  const { activity } = await mutate({
    actor: { kind: "user" },
    verb: "today.waitingOn",
    taskId: id,
    filterKind: "people",
    summary,
    undo: { ops: undoOps },
    apply: async (tx) => {
      if (!person.existing) await tx.person.create({ data: { id: person.id, name } });
      await tx.blocker.create({
        data: { id: blockerId, taskId: id, personId: person.id, expectedBy, state: "waiting" },
      });
      // The do date is seeded from the other person's forecast, so it is app-set.
      await tx.task.update({ where: { id }, data: { doDate: seededDo, doDateSetBy: seededDo ? "app" : before.doDateSetBy } });
    },
  });

  revalidatePath("/");
  revalidatePath("/board");
  return { ok: true, activityId: activity.id, summary };
}

/**
 * When a task already carries a blocker, not-today edits the one field that
 * moved: the expected-by date (R3). Editing it re-seeds the do date and leaves
 * the due date alone (decisions 115).
 */
export async function editBlockerExpectedBy(
  taskId: string,
  blockerId: string,
  expectedByIso: string
): Promise<TodayAnswer> {
  await requireUser();
  const [task, blocker] = await Promise.all([getTask(taskId), getBlocker(blockerId)]);
  if (!task || task.deletedAt) return { error: "That task is gone." };
  if (!blocker || blocker.taskId !== taskId) return { error: "No such blocker." };

  const expectedBy = expectedByIso ? isoToDate(expectedByIso) : null;
  const whenWord = expectedByIso ? shortDate(expectedByIso) : "no date";
  const summary = `Expected-by → ${whenWord} · “${task.title}”`;

  const { activity } = await mutate({
    actor: { kind: "user" },
    verb: "today.expectedBy",
    taskId,
    filterKind: "dates",
    summary,
    undo: {
      ops: [
        { action: "update", model: "blocker", id: blockerId, data: { expectedBy: blocker.expectedBy } },
        {
          action: "update",
          model: "task",
          id: taskId,
          data: { doDate: task.doDate, doDateSetBy: task.doDateSetBy },
        },
      ],
    },
    apply: async (tx) => {
      await tx.blocker.update({ where: { id: blockerId }, data: { expectedBy } });
      await tx.task.update({
        where: { id: taskId },
        data: { doDate: expectedBy, doDateSetBy: expectedBy ? "app" : task.doDateSetBy },
      });
    },
  });

  revalidatePath("/");
  revalidatePath("/board");
  return { ok: true, activityId: activity.id, summary };
}

/**
 * Take the blocker off (R3: the single word "remove blocker"). It clears the
 * blocker — soft, reversible (invariant 2) — and returns the task to your own
 * work. The seeded do date is left as it stands; it is the plan now, and a
 * separate owner.
 */
export async function removeBlocker(taskId: string, blockerId: string): Promise<TodayAnswer> {
  await requireUser();
  const [task, blocker] = await Promise.all([getTask(taskId), getBlocker(blockerId)]);
  if (!task || task.deletedAt) return { error: "That task is gone." };
  if (!blocker || blocker.taskId !== taskId || blocker.state === "cleared") {
    return { error: "No blocker to remove." };
  }

  const summary = `Blocker removed · “${task.title}”`;
  const { activity } = await mutate({
    actor: { kind: "user" },
    verb: "today.removeBlocker",
    taskId,
    filterKind: "people",
    summary,
    undo: {
      ops: [
        {
          action: "update",
          model: "blocker",
          id: blockerId,
          data: { state: blocker.state, clearedAt: blocker.clearedAt },
        },
      ],
    },
    apply: (tx) =>
      tx.blocker.update({ where: { id: blockerId }, data: { state: "cleared", clearedAt: new Date() } }),
  });

  revalidatePath("/");
  revalidatePath("/board");
  return { ok: true, activityId: activity.id, summary };
}

/**
 * Something else (R1/R2). Records the override — the task rejected, the task
 * chosen — and moves no date at all (decisions 250). The rejected task keeps its
 * estimate, its hours and its place on today. The reason is asked after the pick
 * and is optional (setOverrideReason); here the override is created with a null
 * reason, exactly the hand-test case "pick, then give no reason".
 */
export async function chooseSomethingElse(
  rejectedId: string,
  chosenId: string
): Promise<TodayAnswer> {
  await requireUser();
  if (rejectedId === chosenId) return { error: "That is the same task." };
  const [rejected, chosen] = await Promise.all([getTask(rejectedId), getTask(chosenId)]);
  if (!rejected || rejected.deletedAt) return { error: "The rejected task is gone." };
  if (!chosen || chosen.deletedAt) return { error: "That task is gone." };

  const overrideId = crypto.randomUUID();
  const summary = `Something else: chose “${chosen.title}” over “${rejected.title}”`;

  const { activity } = await mutate({
    actor: { kind: "user" },
    verb: "today.somethingElse",
    taskId: chosenId,
    filterKind: "overrides",
    summary,
    undo: { ops: [{ action: "deleteRow", model: "override", id: overrideId }] },
    apply: (tx) =>
      tx.override.create({
        data: {
          id: overrideId,
          rejectedTaskId: rejectedId,
          chosenTaskId: chosenId,
          // No reason yet; the record concerns both tasks until one is given.
          pointsAt: "both",
        },
      }),
  });

  revalidatePath("/");
  return { ok: true, activityId: activity.id, summary, overrideId };
}

/**
 * Attach a reason to an override after the pick (R1). The four canned reasons
 * map onto a field the app understands and point at their side; the fifth is
 * free text, filed against both. Nothing in v1 parses the free text — it is read
 * on the activity page's overrides filter (R10, decisions 284).
 */
export async function setOverrideReason(
  overrideId: string,
  code: OverrideReasonCode,
  freeText?: string
): Promise<TodayAnswer> {
  await requireUser();
  const option = overrideReason(code);
  if (!option) return { error: "Not a reason." };
  const text = (freeText ?? "").trim();
  if (option.freeText && !text) return { error: "Write the line, or leave it." };

  // The override row is read via a query so app code never imports Prisma.
  const before = await getOverride(overrideId);
  if (!before) return { error: "No such override." };

  const reasonText = option.freeText ? text : null;
  const shown = option.freeText ? `“${text}”` : option.human;
  const summary = `Reason: ${shown}`;

  const { activity } = await mutate({
    actor: { kind: "user" },
    verb: "today.overrideReason",
    taskId: before.chosenTaskId,
    filterKind: "overrides",
    summary,
    undo: {
      ops: [
        {
          action: "update",
          model: "override",
          id: overrideId,
          data: {
            reasonCode: before.reasonCode,
            reasonText: before.reasonText,
            pointsAt: before.pointsAt,
          },
        },
      ],
    },
    apply: (tx) =>
      tx.override.update({
        where: { id: overrideId },
        data: { reasonCode: code, reasonText, pointsAt: option.pointsAt },
      }),
  });

  revalidatePath("/");
  return { ok: true, activityId: activity.id, summary };
}
