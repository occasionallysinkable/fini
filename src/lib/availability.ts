import type { TaskStatus } from "@prisma/client";

/*
  Invariant 4 — availability is derived, never stored.

  `isAvailable` is the ONE function that decides whether a task is offered to
  the day views. No column holds the answer and no saved filter reimplements
  it (decisions line 305–309). Adding a fifth reason later makes every view
  correct at once; a stored flag would mean a migration and a saved filter
  would mean editing every view by hand.

  It is pure: everything it reads is passed in, so it unit-tests without a
  database. The read layer (queries.ts) resolves the project and the sequence
  order, then calls this.

  Unavailable means ABSENT from every day view, not greyed out (decisions
  line 310). Callers drop the task; they do not render it faded.
*/

/** The project facts availability depends on. Null when the task has no project. */
export interface ProjectAvailability {
  onHold: boolean;
  isSequence: boolean;
}

/** Everything `isAvailable` needs about one task, resolved by the caller. */
export interface TaskAvailabilityView {
  /** The task's defer date, or null. A DATE column (invariant 10). */
  deferUntil: Date | null;
  /** The task's project, or null when it belongs to none. */
  project: ProjectAvailability | null;
  /**
   * For a sequence project only: whether this task is its first unfinished
   * task. Derived by `firstUnfinishedTaskId` below. Ignored unless the project
   * is a sequence.
   */
  isFirstUnfinishedInSequence: boolean;
}

/** "YYYY-MM-DD" for a DATE-typed value (stored at UTC midnight). */
function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * True when the task is available to the day views. The four conditions are
 * decisions line 309, in order; any one of them makes the task unavailable.
 *
 * @param view   the task's defer date, project and sequence position
 * @param today  "YYYY-MM-DD" in the user's zone (from todayInZone)
 */
export function isAvailable(view: TaskAvailabilityView, today: string): boolean {
  // 1 · Defer date in the future. The task genuinely does not exist yet
  //     (decisions line 310); on or after the date it is back with no action.
  if (view.deferUntil && ymd(view.deferUntil) > today) return false;

  // 2 · The project is on hold.
  if (view.project?.onHold) return false;

  // 3 · The project is a sequence and this is not its first unfinished task.
  //     The other steps still exist — absent from the day, not deleted
  //     (decisions line 307–308) — so opening the project still shows them.
  if (view.project?.isSequence && !view.isFirstUnfinishedInSequence) return false;

  // 4 · The task is blocked by another task. Blockers are WP15; until then no
  //     task is ever considered blocked, so this condition never removes
  //     availability yet. When WP15 lands, replace this constant with a real
  //     check over the task's unresolved blocker rows.
  const blockedByAnotherTask = false; // WP15 owns this.
  if (blockedByAnotherTask) return false;

  return true;
}

/** A task's fields the sequence order reads. */
interface SequenceTask {
  id: string;
  status: TaskStatus;
  deletedAt: Date | null;
}

/**
 * The id of a sequence project's first unfinished task, or null when every
 * task is finished. "Unfinished" means status `active`: a done, cancelled or
 * someday task is not a live step, and a deleted task is gone.
 *
 * Order is `position` ascending, which the caller must impose before calling.
 * Position is an explicit column (WP3) so a step can be inserted mid-sequence
 * or reordered — `createdAt` could do neither.
 */
export function firstUnfinishedTaskId(tasksInOrder: SequenceTask[]): string | null {
  const step = tasksInOrder.find((t) => t.deletedAt == null && t.status === "active");
  return step?.id ?? null;
}
