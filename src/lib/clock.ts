/*
  WP12 · the invariant-11 clock (PURE).

  Invariant 11: "A commitment's clock is the other person's." When a task has an
  asked-by (or delegated-to) person with a timezone, its due time is interpreted
  in THAT person's zone and the safe start is computed there; your own tasks use
  your own zone. This is ONE function and no screen does its own conversion — the
  capture path, every due-date/time edit, and every change to the governing
  person's zone all run through here.

  It imports only the pure wall-clock→UTC helper from reminders.ts (which itself
  imports nothing), touches no database, and is unit-tested on its own — because
  this is exactly the arithmetic where a silent bug costs a deadline (a person in
  another zone, a DST boundary, a due date with no time, a task with no estimate).

  What lives here:
    - governingZone        which clock a task's deadline is read in (invariant 11).
    - commitmentDueInstant a due date/time + a zone → the UTC instant it lands at,
                           and the zone frozen alongside it (task.due_zone — the
                           snapshot that IS the history, so a later zone change
                           never retroactively moves a past commitment).
    - computeTaskDueInstant the two composed: a task's fields + its people + the
                           user's zone → { dueAtUtc, dueZone }.
    - safeStart            due_at_utc − estimate_minutes (Computed table).
    - orderChain           today's deadline-bearing tasks ordered by safe start.
*/

import { wallToUtc } from "./reminders";
import type { Role } from "./parse";

// ---------------------------------------------------------------------------
// The governing zone (invariant 11).
// ---------------------------------------------------------------------------

/** A person on the task, reduced to the two things the clock cares about. */
export interface CommitmentPerson {
  role: Role;
  timezone: string | null;
}

export interface GoverningZone {
  zone: string;
  /** True when the zone came from another person (a commitment read in their
   *  clock), false when it fell back to the user's own zone. */
  fromPerson: boolean;
}

/**
 * Which clock a task's deadline is read in. The asked-by person's zone wins
 * (invariant 11 names asked-by first); failing that a delegated-to person's
 * (R17 makes either a commitment); failing both — an own task, or a commitment
 * whose person has no zone on record — the user's own zone. A commitment person
 * with no timezone is NOT enough to pull the clock off the user's zone: the
 * ranking's "whose day closes" and this clock both only act "where the app knows
 * those facts" (decisions line 105), and a null zone is the app not knowing.
 */
export function governingZone(
  people: CommitmentPerson[],
  userZone: string
): GoverningZone {
  const asked = people.find((p) => p.role === "asked_by" && p.timezone);
  if (asked?.timezone) return { zone: asked.timezone, fromPerson: true };
  const deleg = people.find((p) => p.role === "delegated_to" && p.timezone);
  if (deleg?.timezone) return { zone: deleg.timezone, fromPerson: true };
  return { zone: userZone, fromPerson: false };
}

// ---------------------------------------------------------------------------
// The due instant.
// ---------------------------------------------------------------------------

export interface DueInstantInput {
  dueDate: string | null; // "YYYY-MM-DD"
  dueTime: string | null; // "HH:MM"
  zone: string; // the governing IANA zone
}

export interface DueInstant {
  /** The UTC instant the deadline lands at, or null when there is no due date. */
  dueAtUtc: Date | null;
  /** The zone that produced the instant, frozen alongside it — null when there
   *  is no instant. This is the task.due_zone snapshot: the history the invariant
   *  needs, so a later change to a person's zone leaves a past commitment where
   *  it was promised. */
  dueZone: string | null;
}

/**
 * The one clock: a due date/time and the governing zone in, a UTC instant out.
 *
 *   - No due date       → null (there is no deadline instant).
 *   - A due date + time → that wall-clock in the zone, as a UTC instant.
 *   - A due date, no time → 00:00 on the date in the zone (Computed table: "where
 *                          there is a due date and no due time, the due instant is
 *                          00:00 on that date" — the same fallback R25 uses).
 *
 * DST is handled by wallToUtc's refinement pass, so a due time inside a spring-
 * forward gap or a fall-back overlap still lands on the correct instant.
 */
export function commitmentDueInstant(input: DueInstantInput): DueInstant {
  if (!input.dueDate) return { dueAtUtc: null, dueZone: null };
  const hhmm = input.dueTime ?? "00:00";
  return { dueAtUtc: wallToUtc(input.dueDate, hhmm, input.zone), dueZone: input.zone };
}

/**
 * The composed clock used by the capture and edit paths: a task's due date/time
 * plus its people plus the user's zone → the instant and the frozen zone. This
 * is the single entry point invariant 11 promises ("no screen does its own
 * conversion").
 */
export function computeTaskDueInstant(opts: {
  dueDate: string | null;
  dueTime: string | null;
  people: CommitmentPerson[];
  userZone: string;
}): DueInstant {
  const { zone } = governingZone(opts.people, opts.userZone);
  return commitmentDueInstant({ dueDate: opts.dueDate, dueTime: opts.dueTime, zone });
}

// ---------------------------------------------------------------------------
// Safe start and the chain (Computed, never stored).
// ---------------------------------------------------------------------------

/**
 * Latest safe start = due_at_utc − estimate_minutes (Computed table). The last
 * moment you can start and still deliver. Null when there is no due instant or no
 * estimate — there is nothing to work backwards through. Note this reads the
 * estimate live: an estimate is derived, never stored on the safe start, so the
 * value is always current without a recompute write.
 */
export function safeStart(
  dueAtUtc: Date | null,
  estimateMinutes: number | null
): Date | null {
  if (!dueAtUtc || estimateMinutes == null) return null;
  return new Date(dueAtUtc.getTime() - estimateMinutes * 60_000);
}

export interface ChainInput {
  id: string;
  title: string;
  dueAtUtc: Date;
  estimateMinutes: number | null;
}

export interface ChainEntry {
  id: string;
  title: string;
  dueAtUtc: Date;
  estimateMinutes: number | null;
  /** null when the task has no estimate — it still bears a deadline, so it stays
   *  in the chain, ordered by its due instant, and the reader is told a number is
   *  missing rather than the task being dropped. */
  safeStart: Date | null;
}

/**
 * The chain: today's deadline-bearing tasks ordered by latest safe start
 * (Computed table). A task with no estimate has no safe start, so it is ordered
 * by its due instant instead — the honest fallback, since without an estimate the
 * app cannot say when you must start, only when it is due. Ties break on title so
 * the order is stable. Read-only on every screen; this builds the order, the
 * screen only renders it.
 */
export function orderChain(tasks: ChainInput[]): ChainEntry[] {
  return tasks
    .map((t) => ({
      id: t.id,
      title: t.title,
      dueAtUtc: t.dueAtUtc,
      estimateMinutes: t.estimateMinutes,
      safeStart: safeStart(t.dueAtUtc, t.estimateMinutes),
    }))
    .sort((a, b) => {
      const ak = (a.safeStart ?? a.dueAtUtc).getTime();
      const bk = (b.safeStart ?? b.dueAtUtc).getTime();
      if (ak !== bk) return ak - bk;
      return a.title.localeCompare(b.title);
    });
}
