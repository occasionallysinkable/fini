import { prisma } from "./prisma";
import { mutate, type UndoOp } from "./mutate";
import { sendToAllDevices } from "./push";
import { spawnNextOccurrenceOps } from "./recurrence-service";
import {
  computeFireTime,
  reminderTag,
  reminderLabel,
  snoozeByMinutes,
  DEFAULT_SNOOZE_MINUTES,
  wallToUtc,
  type SnoozeReasonId,
} from "./reminders";

/*
  WP7 · reminder operations that touch the database. Every write goes through
  mutate() (invariant 1) with an undo payload that restores the prior state
  (invariant 2). The pure arithmetic lives in reminders.ts; this module is the
  seam between it, the Prisma rows, and the push channel.

  Callers:
    - capture (actions.ts) plans reminder rows with planReminders() and creates
      them inside its own capture mutate, so the whole capture reverses as one
      ledger line.
    - the task page (task/actions.ts) adds and removes reminders, and reschedules
      them when the due date or time moves.
    - the tick endpoint (/api/tick) fires the reminders that have come due.
    - the notification action endpoint (/api/reminder-action) resolves Done and
      the three snooze reasons from the lock screen.
*/

// ---------------------------------------------------------------------------
// Context: the user's zone and reminder settings (invariant 12 — read, never
// hard-coded). One user row.
// ---------------------------------------------------------------------------

export interface ReminderSettings {
  timeZone: string;
  snoozeMinutes: number;
  defaultReminder: { enabled: boolean; offsetMinutes: number };
}

export async function getReminderSettings(): Promise<ReminderSettings> {
  const user = await prisma.user.findFirst({ select: { timezone: true, settings: true } });
  const settings = (user?.settings ?? {}) as {
    snoozeIntervalMinutes?: number;
    defaultReminder?: { enabled?: boolean; offsetMinutes?: number };
  };
  return {
    timeZone: user?.timezone ?? "UTC",
    snoozeMinutes: settings.snoozeIntervalMinutes ?? DEFAULT_SNOOZE_MINUTES,
    defaultReminder: {
      enabled: settings.defaultReminder?.enabled ?? false,
      offsetMinutes: settings.defaultReminder?.offsetMinutes ?? 15,
    },
  };
}

// ---------------------------------------------------------------------------
// Planning reminder rows for capture (pure — no database). The typed reminders
// come from the parser; the default reminder is added only when the toggle is on
// and the user typed none of their own, so a task never gets a surprise second
// reminder on top of the ones it named.
// ---------------------------------------------------------------------------

export interface TypedReminder {
  offsetMinutes?: number;
  absoluteTime?: string; // "HH:MM"
}

export interface PlannedReminder {
  id: string;
  offsetMinutes: number | null;
  absoluteAt: Date | null;
  nextFireAtUtc: Date | null;
}

export function planReminders(opts: {
  dueDate: string | null;
  dueTime: string | null;
  fallbackDate: string; // today, for an absolute time with no due date
  timeZone: string;
  typed: TypedReminder[];
  defaultReminder: { enabled: boolean; offsetMinutes: number };
}): PlannedReminder[] {
  const rows: PlannedReminder[] = [];

  for (const t of opts.typed) {
    if (t.absoluteTime) {
      // An absolute reminder (+9am) is a time on the due date — or today when the
      // task has no due date (reminders.md: "Call the bank Fri +9am").
      const onDate = opts.dueDate ?? opts.fallbackDate;
      const absoluteAt = wallToUtc(onDate, t.absoluteTime, opts.timeZone);
      rows.push({ id: crypto.randomUUID(), offsetMinutes: null, absoluteAt, nextFireAtUtc: absoluteAt });
      continue;
    }
    const offsetMinutes = t.offsetMinutes ?? 0;
    const nextFireAtUtc = computeFireTime({
      dueDate: opts.dueDate,
      dueTime: opts.dueTime,
      timeZone: opts.timeZone,
      offsetMinutes,
    });
    if (!nextFireAtUtc) continue; // nothing to fire against (parser also drops these)
    rows.push({ id: crypto.randomUUID(), offsetMinutes, absoluteAt: null, nextFireAtUtc });
  }

  // The default reminder: on tasks the user did not put a reminder on, when the
  // toggle is on and there is a date to fire against (reminders.md).
  if (opts.defaultReminder.enabled && rows.length === 0 && opts.dueDate) {
    const nextFireAtUtc = computeFireTime({
      dueDate: opts.dueDate,
      dueTime: opts.dueTime,
      timeZone: opts.timeZone,
      offsetMinutes: opts.defaultReminder.offsetMinutes,
    });
    if (nextFireAtUtc) {
      rows.push({
        id: crypto.randomUUID(),
        offsetMinutes: opts.defaultReminder.offsetMinutes,
        absoluteAt: null,
        nextFireAtUtc,
      });
    }
  }

  return rows;
}

/** The create-data and matching undo ops for a set of planned reminders, to fold
 *  into an existing mutate (capture). The reminders reverse with the task. */
export function reminderCreateOps(taskId: string, planned: PlannedReminder[]): {
  creates: { id: string; taskId: string; offsetMinutes: number | null; absoluteAt: Date | null; nextFireAtUtc: Date | null }[];
  undo: UndoOp[];
} {
  return {
    creates: planned.map((r) => ({
      id: r.id,
      taskId,
      offsetMinutes: r.offsetMinutes,
      absoluteAt: r.absoluteAt,
      nextFireAtUtc: r.nextFireAtUtc,
    })),
    undo: planned.map((r) => ({ action: "deleteRow" as const, model: "reminder" as const, id: r.id })),
  };
}

// ---------------------------------------------------------------------------
// Rescheduling when the due date or time moves (reminders.md · "When a reminder
// changes on its own"): every offset reminder moves with it; absolute reminders
// stay put. Returned as ops so the task-page edit folds them into its single
// mutate — the due-date change and the reschedule reverse together.
// ---------------------------------------------------------------------------

export interface ReschedulableReminder {
  id: string;
  offsetMinutes: number | null;
  absoluteAt: Date | null;
  nextFireAtUtc: Date | null;
}

export function reminderRescheduleOps(
  reminders: ReschedulableReminder[],
  newDue: { dueDate: string | null; dueTime: string | null },
  timeZone: string
): { apply: UndoOp[]; undo: UndoOp[] } {
  const apply: UndoOp[] = [];
  const undo: UndoOp[] = [];
  for (const r of reminders) {
    if (r.absoluteAt) continue; // absolute reminders keep their instant
    const next = computeFireTime({
      dueDate: newDue.dueDate,
      dueTime: newDue.dueTime,
      timeZone,
      offsetMinutes: r.offsetMinutes ?? 0,
    });
    apply.push({ action: "update", model: "reminder", id: r.id, data: { nextFireAtUtc: next } });
    undo.push({ action: "update", model: "reminder", id: r.id, data: { nextFireAtUtc: r.nextFireAtUtc } });
  }
  return { apply, undo };
}

// ---------------------------------------------------------------------------
// Firing — the tick endpoint's job. Selects the reminders that have come due,
// sends the push, records the event, and clears next_fire so it fires once.
// ---------------------------------------------------------------------------

export interface TickResult {
  due: number;
  fired: number;
  devices: number;
}

export async function fireDueReminders(now: Date = new Date()): Promise<TickResult> {
  // Due: enabled, scheduled at or before now, on a task that is still active and
  // not deleted. (Blocked tasks suspend their reminders — that is WP15; there are
  // no blockers yet, so the status check is the whole guard for now.)
  const due = await prisma.reminder.findMany({
    where: {
      enabled: true,
      nextFireAtUtc: { not: null, lte: now },
      task: { deletedAt: null, status: "active" },
    },
    include: { task: { select: { id: true, title: true, reason: true, dueTime: true } } },
  });

  let fired = 0;
  let devices = 0;

  for (const r of due) {
    const body = notificationBody(r.task.dueTime, r.task.reason);
    const result = await sendToAllDevices({
      type: "reminder",
      title: r.task.title,
      body,
      tag: reminderTag(r.id),
      reminderId: r.id,
      snoozeCount: r.snoozeCount,
    });
    devices += result.sent;

    // Record the fire and clear next_fire so the reminder does not fire again.
    await mutate({
      actor: { kind: "app" },
      verb: "reminder.fire",
      taskId: r.task.id,
      filterKind: "reminders",
      summary: `${reminderLabel(r)} fired · “${r.task.title}” · delivered to ${result.sent} device${result.sent === 1 ? "" : "s"}`,
      undo: { ops: [] }, // a fired notification cannot be un-sent; nothing to undo
      apply: async (tx) => {
        await tx.reminderEvent.create({
          data: { reminderId: r.id, firedAt: now, devicesDelivered: result.sent, outcome: "fired" },
        });
        await tx.reminder.update({ where: { id: r.id }, data: { nextFireAtUtc: null } });
      },
    });
    fired += 1;

    // Prune any endpoint the push service reported as gone (404/410), through
    // the write path like every other delete.
    await pruneGoneEndpoints(result.goneEndpoints);
  }

  return { due: due.length, fired, devices };
}

/** The notification's second line: the due time and, where there is one, the
 *  task's own reason. reminders.md — never the word "reminder", never the rest
 *  of the day. */
function notificationBody(dueTime: string | null, reason: string | null): string {
  const parts: string[] = [];
  if (dueTime) parts.push(`Due ${dueTime}.`);
  if (reason) parts.push(reason);
  return parts.join(" ") || "Reminder is due.";
}

// ---------------------------------------------------------------------------
// Resolving a notification action from the lock screen (/api/reminder-action).
// Both actions resolve on the server so they work with the app closed.
// ---------------------------------------------------------------------------

export type NotificationAction =
  | { kind: "done"; reminderId: string }
  | { kind: "snooze"; reminderId: string; minutes: number; reason: SnoozeReasonId | null; at?: string };

export interface ActionResult {
  ok: boolean;
  message: string;
  /** Tags the caller should also withdraw locally (the device that acted). */
  closedTags: string[];
}

export async function resolveNotificationAction(
  action: NotificationAction,
  now: Date = new Date()
): Promise<ActionResult> {
  const reminder = await prisma.reminder.findUnique({
    where: { id: action.reminderId },
    include: { task: { select: { id: true, title: true, status: true, completedAt: true, deletedAt: true } } },
  });
  if (!reminder || reminder.task.deletedAt) {
    return { ok: false, message: "That reminder no longer exists.", closedTags: [] };
  }

  if (action.kind === "done") return completeFromNotification(reminder.task.id, now);
  return snoozeReminder(reminder.id, action, now);
}

/**
 * Done: complete the task, cancel every reminder on it, and withdraw its
 * notifications on every device (reminders.md — a stale reminder teaches you to
 * ignore reminders). One mutate; undo restores the task's status and every
 * reminder's armed state.
 */
async function completeFromNotification(taskId: string, now: Date): Promise<ActionResult> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, title: true, status: true, completedAt: true },
  });
  if (!task) return { ok: false, message: "That task no longer exists.", closedTags: [] };

  const reminders = await prisma.reminder.findMany({
    where: { taskId },
    select: { id: true, enabled: true, nextFireAtUtc: true },
  });

  const undo: UndoOp[] = [
    { action: "update", model: "task", id: taskId, data: { status: task.status, completedAt: task.completedAt } },
    ...reminders.map((r) => ({
      action: "update" as const,
      model: "reminder" as const,
      id: r.id,
      data: { enabled: r.enabled, nextFireAtUtc: r.nextFireAtUtc },
    })),
  ];

  if (task.status === "done") {
    // Already done (another device beat us to it). Still withdraw locally.
    return { ok: true, message: "Already done.", closedTags: reminders.map((r) => reminderTag(r.id)) };
  }

  // WP8 · completing a recurring task from the lock screen spawns its next
  // occurrence in the same write, exactly as completing it on the board does.
  const spawn = await spawnNextOccurrenceOps(taskId, now);

  await mutate({
    actor: { kind: "user" },
    verb: "reminder.done",
    taskId,
    filterKind: "reminders",
    summary: spawn
      ? `Completed “${task.title}” from a reminder · ${spawn.summary}`
      : `Completed “${task.title}” from a reminder`,
    undo: { ops: [...(spawn?.undo ?? []), ...undo] },
    apply: async (tx) => {
      await tx.task.update({ where: { id: taskId }, data: { status: "done", completedAt: now } });
      await tx.reminder.updateMany({ where: { taskId }, data: { enabled: false, nextFireAtUtc: null } });
      if (spawn) await spawn.run(tx);
    },
  });

  const closedTags = reminders.map((r) => reminderTag(r.id));
  // Withdraw the notifications on every OTHER device (this device closes its own).
  await sendToAllDevices({ type: "close", tags: closedTags });
  return { ok: true, message: "Done.", closedTags };
}

/**
 * A snooze: reschedule this one reminder, record why, and withdraw the showing
 * notification on the other devices — it re-arms itself at the new time through
 * the tick. No date on the task moves, no blocker is set (reminders.md).
 */
async function snoozeReminder(
  reminderId: string,
  action: Extract<NotificationAction, { kind: "snooze" }>,
  now: Date
): Promise<ActionResult> {
  const reminder = await prisma.reminder.findUnique({
    where: { id: reminderId },
    include: { task: { select: { id: true, title: true } } },
  });
  if (!reminder) return { ok: false, message: "That reminder no longer exists.", closedTags: [] };

  const at = action.at ? new Date(action.at) : snoozeByMinutes(now, action.minutes);
  const tag = reminderTag(reminderId);

  await mutate({
    actor: { kind: "user" },
    verb: "reminder.snooze",
    taskId: reminder.task.id,
    filterKind: "reminders",
    summary: snoozeSummary(reminder.task.title, action),
    undo: {
      ops: [
        {
          action: "update",
          model: "reminder",
          id: reminderId,
          data: { nextFireAtUtc: reminder.nextFireAtUtc, snoozeCount: reminder.snoozeCount },
        },
      ],
    },
    apply: async (tx) => {
      await tx.reminder.update({
        where: { id: reminderId },
        data: { nextFireAtUtc: at, snoozeCount: reminder.snoozeCount + 1 },
      });
      await tx.reminderEvent.create({
        data: {
          reminderId,
          firedAt: now,
          outcome: "snoozed",
          snoozeReason: action.reason ?? null,
          snoozeMinutes: action.minutes || null,
        },
      });
    },
  });

  await sendToAllDevices({ type: "close", tags: [tag] });
  return { ok: true, message: "Snoozed.", closedTags: [tag] };
}

function snoozeSummary(
  title: string,
  action: Extract<NotificationAction, { kind: "snooze" }>
): string {
  const reasonText: Record<SnoozeReasonId, string> = {
    middle_of_something: "in the middle of something",
    wrong_time_of_day: "wrong time of day",
    waiting_on_someone: "waiting on someone",
  };
  const why = action.reason ? `, ${reasonText[action.reason]}` : "";
  return `Snoozed${why} · “${title}”`;
}

// ---------------------------------------------------------------------------
// Endpoint pruning — a subscription the push service reports gone (404/410) is
// removed through the write path, like the harness did.
// ---------------------------------------------------------------------------

async function pruneGoneEndpoints(endpoints: string[]): Promise<void> {
  for (const endpoint of endpoints) {
    const device = await prisma.device.findUnique({ where: { endpoint } });
    if (!device) continue;
    await mutate({
      actor: { kind: "app" },
      verb: "device.prune",
      filterKind: "reminders",
      summary: "Removed a device whose push subscription had expired.",
      undo: { ops: [] },
      apply: (tx) => tx.device.delete({ where: { id: device.id } }),
    });
  }
}
