/*
  WP5 · the stale block — the pure logic behind "work that has gone stale".

  Everything here is a pure function of its inputs, so it unit-tests without a
  database or a browser. The server query (queries.getStaleData) derives the raw
  facts from the activity log and hands them here; the client component
  (Board.tsx) renders what these functions return.

  The rules this encodes (decisions "Work that has gone stale", handoff line 99):

    - Stale is DERIVED, never stored (invariant 3-in-spirit): a task is stale
      when it has had no activity row for fourteen days and its status is active.
      There is no muted_until column and no timer. Keeping a task writes an
      activity row, so the fourteen-day clock resets by the very rule that
      defines staleness — the mute is the same mechanism as the definition.

    - The interval is FIXED at fourteen days and never lengthens (decisions line
      91). A kept-but-untouched task returns at 14, 28, 42, 56 days — always the
      same step. This needs no code of its own: each keep writes an activity row,
      and fourteen days later the same derivation makes it stale again.

    - The kept count is COUNTED FROM THE LOG (handoff line 99), not stored as the
      display's source of truth. queries.getStaleData counts keep rows that have
      not been undone; keepCount on the task is kept in step for WP17's ranking
      but is not what the block reads.
*/

const DAY_MS = 24 * 60 * 60 * 1000;

/** Fourteen days, the one interval (decisions line 86, handoff line 99). */
export const STALE_AFTER_DAYS = 14;

/** Three rows at a time, however many are stale (decisions line 88). */
export const STALE_ROWS_SHOWN = 3;

/**
 * When the two sweep controls ("go through all N", "kill all N") appear. The
 * spec says "past a handful" (decisions line 93) but names no number, so this
 * is a judgement call, not a spec value: with three rows shown, six stale tasks
 * means three more sit counted-but-unshown behind them, which is the point where
 * offering them one row at a time stops being the right offer. Eleven is the
 * example in R12's planning line, not the threshold.
 */
export const SWEEP_THRESHOLD = 6;

/** The verb every keep activity row carries. Shared by the writer (board
 *  actions) and the counter (queries.getStaleData) so the two never drift. */
export const KEEP_VERB = "task.bulkKeep";

/** The verb mutate()'s undo() stamps on a reversal row. Defined here so both the
 *  ledger's writer (mutate.ts) and the staleness reader use the one string. */
export const UNDO_VERB = "undo";

/**
 * Whether an activity row counts as *touching* its task — the thing the
 * fourteen-day clock reads. Two kinds of row are present in the ledger but are
 * not work on the task:
 *
 *   1. An undo row (verb === UNDO_VERB) records that something was reversed. It
 *      is the opposite of a touch, so counting it would mean pressing undo could
 *      never return a task to the block.
 *   2. An action that was itself undone. undo() consumes the original's undo
 *      window by nulling undoExpiresAt, so a null on a non-undo row marks a
 *      reversed action. It didn't happen, so it is not a touch either. (Every
 *      live write mutate() makes carries a non-null undoExpiresAt — a real, even
 *      long-expired, touch keeps its timestamp; only a reversal nulls it.)
 *
 * So keep-then-undo leaves neither the keep nor the undo counting, and the task
 * falls back to its last genuine touch — returning to the block. Same for push.
 */
export function isTouch(row: { verb: string; undoExpiresAt: Date | null }): boolean {
  return row.verb !== UNDO_VERB && row.undoExpiresAt !== null;
}

/** The most recent genuine touch among a task's activity rows, or null when it
 *  has none (a brand-new task, or one whose only writes were all reversed). */
export function lastTouchAt(
  rows: { verb: string; undoExpiresAt: Date | null; at: Date }[]
): Date | null {
  let latest: Date | null = null;
  for (const row of rows) {
    if (!isTouch(row)) continue;
    if (!latest || row.at.getTime() > latest.getTime()) latest = row.at;
  }
  return latest;
}

/** The three positions of the stale-treatment control (decisions lines 87, 96).
 *  "block" is the default; "inPlace" is the quieter marked-in-place alternative;
 *  "off" turns the whole mechanism off. It lives in the board's config panel and
 *  persists in user.settings — nothing about the board lives in Settings. */
export type StaleTreatment = "block" | "inPlace" | "off";

/**
 * Read the stale treatment out of the user's settings JSON. Defaults to "block".
 * Falls back to the older boolean shape (`staleMechanism: false` → off) so a row
 * seeded before this control existed still reads sensibly.
 */
export function readStaleTreatment(settings: unknown): StaleTreatment {
  const s = (settings ?? {}) as { staleTreatment?: unknown; staleMechanism?: unknown };
  if (s.staleTreatment === "block" || s.staleTreatment === "inPlace" || s.staleTreatment === "off") {
    return s.staleTreatment;
  }
  if (s.staleMechanism === false) return "off";
  return "block";
}

/**
 * The fourteen-day derivation. A task is stale when its status is active and no
 * activity row has touched it in fourteen days. `lastActivityAt` is the most
 * recent activity row's timestamp, or null when the task has none at all — in
 * which case creation stands in, so an imported task with no ledger history is
 * still judged by the same clock.
 */
export function isStale(
  input: { status: string; lastActivityAt: Date | null; createdAt: Date },
  now: Date
): boolean {
  if (input.status !== "active") return false;
  const ref = input.lastActivityAt ?? input.createdAt;
  return now.getTime() - ref.getTime() >= STALE_AFTER_DAYS * DAY_MS;
}

/** Total age in whole days since creation — the number printed beside the kept
 *  count and named as "oldest" for the counted remainder (decisions line 90). */
export function ageInDays(createdAt: Date, now: Date): number {
  return Math.floor((now.getTime() - createdAt.getTime()) / DAY_MS);
}

/**
 * The kept-count wording (decisions line 90). First appearance has never been
 * kept and shows no label; the second reads "kept once", the third "kept twice".
 * Keeping is not a reset — the count rises, and it is shown.
 */
export function keptLabel(keptCount: number): string | null {
  if (keptCount <= 0) return null;
  if (keptCount === 1) return "kept once";
  if (keptCount === 2) return "kept twice";
  return `kept ${keptCount} times`;
}

/** One stale task as the block shows it. */
export interface StaleTaskInput {
  id: string;
  title: string;
  projectName: string | null;
  createdAt: Date;
  /** Keep rows counted from the log (not undone). */
  keptCount: number;
}

export interface StaleRow {
  id: string;
  title: string;
  projectName: string | null;
  keptCount: number;
  keptLabel: string | null;
  ageDays: number;
}

/**
 * Turn the stale tasks into display rows, oldest first. Oldest means greatest
 * total age (earliest created), which is also how "the oldest" is named for the
 * counted remainder and how the three shown rows are chosen — the most-dead work
 * leads. There is no ranking here; that arrives in WP17.
 */
export function buildStaleRows(tasks: StaleTaskInput[], now: Date): StaleRow[] {
  return [...tasks]
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((t) => ({
      id: t.id,
      title: t.title,
      projectName: t.projectName,
      keptCount: t.keptCount,
      keptLabel: keptLabel(t.keptCount),
      ageDays: ageInDays(t.createdAt, now),
    }));
}

/**
 * The three-at-a-time cut (decisions line 88). Shows three rows by default;
 * "go through all" (a sweep) expands to every row. Whatever is not shown is
 * counted, and the oldest age among the unshown is named. Rows arrive already
 * ordered oldest-first from buildStaleRows, so the first unshown row is the
 * oldest of the remainder.
 */
export function staleView(
  rows: StaleRow[],
  expanded: boolean
): { shown: StaleRow[]; remainderCount: number; remainderOldestAgeDays: number | null } {
  const shown = expanded ? rows : rows.slice(0, STALE_ROWS_SHOWN);
  const remainderCount = rows.length - shown.length;
  const remainderOldestAgeDays = remainderCount > 0 ? rows[shown.length].ageDays : null;
  return { shown, remainderCount, remainderOldestAgeDays };
}

/** True once the pile is bad enough to offer sweeps (see SWEEP_THRESHOLD). */
export function showSweeps(totalCount: number): boolean {
  return totalCount >= SWEEP_THRESHOLD;
}
