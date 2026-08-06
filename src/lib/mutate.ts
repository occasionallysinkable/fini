import { Prisma } from "@prisma/client";
import type { Activity, ActivityFilterKind } from "@prisma/client";
import { prisma } from "./prisma";
import { inWrite } from "./write-context";

/*
  The write spine (invariants 1 and 2).

  Every domain write in the app goes through mutate(). There is no other path.
  mutate() runs the caller's change and, in the SAME transaction, writes one
  `activity` row carrying:
    - the actor (who did it: the user, the app, or a named person),
    - a one-sentence summary of what happened, and
    - an undo payload that is, on its own, enough to restore the previous state.

  Deletes are never destructive here: a delete sets `deletedAt` and nothing
  else, so it reverses like any other change. There are no confirmation
  dialogs anywhere in the app because every action undoes.
*/

// The Prisma model delegates a mutation may touch, by their client key.
// Kept as an explicit map so an undo payload can only name a real table.
const MODELS = {
  user: (tx: Tx) => tx.user,
  person: (tx: Tx) => tx.person,
  project: (tx: Tx) => tx.project,
  category: (tx: Tx) => tx.category,
  task: (tx: Tx) => tx.task,
  taskPerson: (tx: Tx) => tx.taskPerson,
  blocker: (tx: Tx) => tx.blocker,
  taskDependency: (tx: Tx) => tx.taskDependency,
  reminder: (tx: Tx) => tx.reminder,
  reminderEvent: (tx: Tx) => tx.reminderEvent,
  shift: (tx: Tx) => tx.shift,
  shiftCategory: (tx: Tx) => tx.shiftCategory,
  recurrenceRule: (tx: Tx) => tx.recurrenceRule,
  note: (tx: Tx) => tx.note,
  override: (tx: Tx) => tx.override,
  planningSession: (tx: Tx) => tx.planningSession,
  device: (tx: Tx) => tx.device,
  savedView: (tx: Tx) => tx.savedView,
  engagementEvent: (tx: Tx) => tx.engagementEvent,
} as const;

export type ModelName = keyof typeof MODELS;

export type Tx = Prisma.TransactionClient;

export interface Actor {
  kind: "user" | "app" | "person";
  personId?: string | null;
}

// One step of the reverse. Applied in order, these restore the prior state.
//  - update:    set `data` back onto the row (reverses an edit, or reverses a
//               soft-delete with data = { deletedAt: null }).
//  - deleteRow: remove a row that a create added (reverses a create). Optional
//               relations pointing at it are set null by the schema, so history
//               rows survive with a dangling pointer rather than blocking.
//  - deleteWhere: remove every row of a model matching a where clause. Needed
//               to reverse a create that added rows to a composite-key table
//               (e.g. task_person), which has no single `id` to name.
export type UndoOp =
  | { action: "update"; model: ModelName; id: string; data: Record<string, unknown> }
  | { action: "deleteRow"; model: ModelName; id: string }
  | { action: "deleteWhere"; model: ModelName; where: Record<string, unknown> };

export interface UndoPayload {
  ops: UndoOp[];
}

export interface MutateInput<T> {
  actor: Actor;
  /** Short machine verb, e.g. "person.rename". Stored on the activity row. */
  verb: string;
  /** The human sentence shown in the ledger and the activity page. */
  summary: string;
  taskId?: string | null;
  filterKind?: ActivityFilterKind | null;
  /** Enough, on its own, to restore the previous state. */
  undo: UndoPayload;
  /** How long the undo stays offered. Default 30 days (matches recoverable deletes). */
  undoTtlMs?: number;
  /** The actual change. Runs inside the transaction that also logs it. */
  apply: (tx: Tx) => Promise<T>;
}

const DEFAULT_UNDO_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export async function mutate<T>(
  input: MutateInput<T>
): Promise<{ result: T; activity: Activity }> {
  const undoExpiresAt = new Date(Date.now() + (input.undoTtlMs ?? DEFAULT_UNDO_TTL_MS));

  // inWrite marks this transaction as the sanctioned write path; the guard on
  // the Prisma client lets these writes through and blocks every other one.
  return inWrite(() =>
    prisma.$transaction(async (tx) => {
      const result = await input.apply(tx as unknown as Tx);

    const activity = await tx.activity.create({
      data: {
        actor: input.actor.kind,
        actorPersonId: input.actor.personId ?? null,
        verb: input.verb,
        taskId: input.taskId ?? null,
        summary: input.summary,
        filterKind: input.filterKind ?? null,
        undoPayload: input.undo as unknown as Prisma.InputJsonValue,
        undoExpiresAt,
      },
    });

      return { result, activity };
    })
  );
}

// Run the reverse steps against a transaction. Exported so the reversal logic
// can be unit-tested against a stub transaction without a live database.
export async function applyUndoOps(tx: Tx, ops: UndoOp[]): Promise<void> {
  for (const op of ops) {
    const delegate = MODELS[op.model](tx) as {
      update: (args: unknown) => Promise<unknown>;
      delete: (args: unknown) => Promise<unknown>;
      deleteMany: (args: unknown) => Promise<unknown>;
    };
    if (op.action === "update") {
      await delegate.update({ where: { id: op.id }, data: op.data });
    } else if (op.action === "deleteWhere") {
      await delegate.deleteMany({ where: op.where });
    } else {
      await delegate.delete({ where: { id: op.id } });
    }
  }
}

/**
 * Reverse a previously logged activity. Restores the prior state from the
 * activity's undo payload, consumes the undo window so it cannot fire twice,
 * and logs the reversal as its own activity row (invariant 1 again: the undo
 * is itself a write).
 */
export async function undo(activityId: string): Promise<Activity> {
  return inWrite(() =>
    prisma.$transaction(async (tx) => {
    const original = await tx.activity.findUnique({ where: { id: activityId } });
    if (!original) throw new Error(`No activity ${activityId}`);
    if (!original.undoExpiresAt || original.undoExpiresAt.getTime() < Date.now()) {
      throw new Error("Nothing to undo — the window has passed.");
    }
    const payload = original.undoPayload as unknown as UndoPayload | null;
    if (!payload?.ops?.length) throw new Error("This activity has no undo payload.");

    await applyUndoOps(tx as unknown as Tx, payload.ops);

    // Consume the window so the same activity cannot be undone again.
    await tx.activity.update({
      where: { id: original.id },
      data: { undoExpiresAt: null },
    });

    // If reversing a create removed the task this activity pointed at, the
    // reversal cannot link to it any more — leave it unlinked rather than
    // dangle a foreign key.
    let reversalTaskId = original.taskId;
    if (reversalTaskId) {
      const stillThere = await tx.task.findUnique({ where: { id: reversalTaskId } });
      if (!stillThere) reversalTaskId = null;
    }

    return tx.activity.create({
      data: {
        actor: "app",
        verb: "undo",
        taskId: reversalTaskId,
        summary: `Undid: ${original.summary}`,
        filterKind: original.filterKind,
        undoPayload: Prisma.JsonNull,
        undoExpiresAt: null,
      },
    });
    })
  );
}
