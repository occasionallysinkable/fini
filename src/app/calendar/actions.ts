"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { mutate, type UndoOp } from "@/lib/mutate";
import {
  getTaskForBlock,
  getDayChargeContext,
  getShiftChargeList,
  getUserZone,
} from "@/lib/queries";
import {
  blockStartInstant,
  blockGridInterval,
  blockConsequence,
  type PlacementConsequence,
} from "@/lib/calendar";
import { chargeBlockAcrossShifts, type BlockInterval } from "@/lib/shifts";
import {
  startReminderSyncOps,
  applyStartReminderPlan,
} from "@/lib/start-reminder-service";

/*
  WP14 · the calendar's writes. Two controls own two different records
  (invariant 6):
    - the all-day strip sets a do date and nothing else (setDoDate);
    - the hour grid sets a do date AND a block (placeBlock).
  Neither ever touches due_date — a deadline moves only on an explicit user action
  on the task, and a chain (deadline-bearing) block refuses the grid entirely (its
  promise is moved on the task, not dragged here — R8).

  Every write goes through mutate() (invariant 1) and reverses from the activity
  page (invariant 2 — no save button, no confirm dialog). The consequence of a
  drop — the tablet's aware lines, or the over-capacity popup with its queue link —
  is returned so the screen prints it in the same frame (invariant 8, no toast).
*/

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Not signed in.");
  return session.user;
}

function isoToDbDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function isValidDay(iso: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso);
}

export interface PlaceResult {
  ok: boolean;
  /** Present when the drop was refused (a deadline block cannot be dragged). */
  refusal?: string;
  /** The tablet / popup consequence, printed in the same frame. */
  consequence?: PlacementConsequence;
}

const DEFAULT_BLOCK_MINUTES = 60; // a task with no estimate draws an hour block

/**
 * Place (or move, or resize) a block on the hour grid. Sets the do date from the
 * day dropped on (user-set — the person chose it) and the block from the time and
 * length. Block length IS the estimate (invariant 5): a task dragged in opens at
 * its estimate; a length passed different from the estimate rewrites it (a resize
 * is you saying it will take longer or less long). One action covers place / move
 * / resize because they write the same three fields.
 *
 * A deadline-bearing task refuses the grid: the promise is moved on the task page,
 * not dragged here (R8). Everything else moves freely.
 */
export async function placeBlock(input: {
  taskId: string;
  dayIso: string;
  startHHMM: string;
  lengthMinutes?: number | null;
}): Promise<PlaceResult> {
  await requireUser();
  const { taskId, dayIso, startHHMM } = input;
  if (!isValidDay(dayIso) || !/^\d{2}:\d{2}$/.test(startHHMM)) {
    return { ok: false, refusal: "That is not a valid time or day." };
  }

  const task = await getTaskForBlock(taskId);
  if (!task) return { ok: false, refusal: "That task is gone." };

  // The chain refuses the grid (R8): a deadline is moved on the task, never dragged.
  if (task.dueAtUtc != null) {
    return {
      ok: false,
      refusal: "This is a deadline — move it on the task page, not the calendar.",
    };
  }

  const tz = await getUserZone();
  const length =
    input.lengthMinutes && input.lengthMinutes > 0
      ? Math.round(input.lengthMinutes)
      : task.estimateMinutes ?? DEFAULT_BLOCK_MINUTES;

  const blockStart = blockStartInstant(dayIso, startHHMM, tz);
  const blockEnd = new Date(blockStart.getTime() + length * 60_000);
  const interval: BlockInterval = blockGridInterval(blockStart, blockEnd, tz);

  // The estimate and the block length are one number; placing/resizing writes both.
  const newEstimate = length;

  // WP13 · the estimate may have changed (a resize), which moves the safe start,
  // so recompute the start reminder in the same write. A tombstoned one stays off.
  const startPlan = await startReminderSyncOps({
    taskId,
    kind: task.kind,
    dueAtUtc: task.dueAtUtc, // null here (a deadline task was refused above)
    estimateMinutes: newEstimate,
  });

  const undoOps: UndoOp[] = [
    {
      action: "update",
      model: "task",
      id: taskId,
      data: {
        doDate: task.doDate,
        doDateSetBy: task.doDateSetBy,
        blockStart: task.blockStart,
        blockEnd: task.blockEnd,
        blockPlacedBy: task.blockPlacedBy,
        estimateMinutes: task.estimateMinutes,
      },
    },
    ...startPlan.undo,
  ];

  await mutate({
    actor: { kind: "user" },
    verb: "calendar.placeBlock",
    taskId,
    summary: `Placed “${task.title}” at ${startHHMM} on ${dayIso} (${fmtLen(length)})`,
    undo: { ops: undoOps },
    apply: async (tx) => {
      await tx.task.update({
        where: { id: taskId },
        data: {
          doDate: isoToDbDate(dayIso),
          doDateSetBy: "user",
          blockStart,
          blockEnd,
          blockPlacedBy: "user",
          estimateMinutes: newEstimate,
        },
      });
      await applyStartReminderPlan(tx, startPlan);
    },
  });

  // The consequence (invariant 8): charge the placed block against the day's other
  // work and read the tablet / popup out of the pure classifier.
  const { activeShifts, dayLabel } = await getDayChargeContext(dayIso, taskId);
  const charge = chargeBlockAcrossShifts(interval, activeShifts, task.categoryId);
  const consequence = blockConsequence({
    block: interval,
    charge,
    taskTitle: task.title,
    categoryName: task.category?.name ?? null,
    activeShifts: activeShifts.map((s) => ({
      id: s.id, name: s.name, startMinutes: s.startMinutes, endMinutes: s.endMinutes,
    })),
    dayLabel,
  });

  revalidateCalendar();
  return { ok: true, consequence };
}

/**
 * Set a task's do date from the all-day strip (invariant 6 — the strip sets a do
 * date and nothing else). If the task currently has a block, moving it to all-day
 * clears the block (all-day means "this day, no time"). Reverses like every write.
 */
export async function setDoDate(input: { taskId: string; dayIso: string }): Promise<PlaceResult> {
  await requireUser();
  const { taskId, dayIso } = input;
  if (!isValidDay(dayIso)) return { ok: false, refusal: "That is not a valid day." };

  const task = await getTaskForBlock(taskId);
  if (!task) return { ok: false, refusal: "That task is gone." };

  await mutate({
    actor: { kind: "user" },
    verb: "calendar.setDoDate",
    taskId,
    summary: `Do “${task.title}” on ${dayIso}`,
    undo: {
      ops: [
        {
          action: "update",
          model: "task",
          id: taskId,
          data: {
            doDate: task.doDate,
            doDateSetBy: task.doDateSetBy,
            blockStart: task.blockStart,
            blockEnd: task.blockEnd,
            blockPlacedBy: task.blockPlacedBy,
          },
        },
      ],
    },
    apply: (tx) =>
      tx.task.update({
        where: { id: taskId },
        // The do date is one the user chose, so it is user-set. Clearing the block
        // removes any timed placement — all-day carries a day, never an hour.
        data: {
          doDate: isoToDbDate(dayIso),
          doDateSetBy: "user",
          blockStart: null,
          blockEnd: null,
          blockPlacedBy: null,
        },
      }),
  });

  revalidateCalendar();
  return { ok: true };
}

/**
 * Send a task back to the rail: clear its do date and any block. Reverses a
 * placement wholesale. Does not touch the due date (invariant 6).
 */
export async function clearDoDate(input: { taskId: string }): Promise<PlaceResult> {
  await requireUser();
  const task = await getTaskForBlock(input.taskId);
  if (!task) return { ok: false, refusal: "That task is gone." };

  await mutate({
    actor: { kind: "user" },
    verb: "calendar.clearDoDate",
    taskId: input.taskId,
    summary: `Took “${task.title}” off the calendar`,
    undo: {
      ops: [
        {
          action: "update",
          model: "task",
          id: input.taskId,
          data: {
            doDate: task.doDate,
            doDateSetBy: task.doDateSetBy,
            blockStart: task.blockStart,
            blockEnd: task.blockEnd,
            blockPlacedBy: task.blockPlacedBy,
          },
        },
      ],
    },
    apply: (tx) =>
      tx.task.update({
        where: { id: input.taskId },
        data: { doDate: null, doDateSetBy: null, blockStart: null, blockEnd: null, blockPlacedBy: null },
      }),
  });

  revalidateCalendar();
  return { ok: true };
}

/** The over-capacity popup's queue link (WP18 is the full queue): everything
 *  charged to one shift on a day, so you can see what to take off. */
export async function loadShiftCharge(input: { shiftId: string; dayIso: string }) {
  await requireUser();
  return getShiftChargeList(input.shiftId, input.dayIso);
}

// --- small helpers -------------------------------------------------------

function fmtLen(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

function revalidateCalendar() {
  revalidatePath("/calendar");
  revalidatePath("/");
  revalidatePath("/board");
  revalidatePath("/settings");
}
