import { prisma } from "./prisma";
import { inWrite } from "./write-context";

/*
  WP10 · engagement events. The failure this app most needs to detect is going a
  month without opening it (spec.md), and that can only be seen by measuring. The
  engagement_event table (present since WP1, written by nothing until now) records
  three moments:

    - open              · today is loaded
    - capture           · a task is successfully captured
    - planning_finished · the planning session ends  ← WP18's seam (see below)

  planning_finished is NOT recorded here. The planning queue is WP18; recording it
  now would mean writing a row at a moment that does not exist yet, i.e. faking it.
  The seam is left named: when WP18 lands, its "session finished" path calls
  recordEngagement("planning_finished", …) and nothing else changes.

  The write path — the one-line justification against invariant 1. Invariant 1
  binds domain mutations: reversible changes to the user's tasks that belong in the
  activity ledger as evidence. An engagement event is neither — it is append-only
  telemetry with no undo and no place in the activity stream, so putting it through
  mutate() would forge an undo payload and litter the ledger with "app opened" rows.
  It still goes through the write guard (inWrite), so there is exactly one sanctioned
  way to reach the database; it simply writes no activity row.
*/

export type Platform = "desktop" | "mobile";
export type EngagementKind = "open" | "capture" | "planning_finished";

/**
 * Read the platform off a User-Agent string (invariant: detect honestly, never
 * assume). Phones and tablets report a mobile token; everything else is desktop.
 * Pure, so the mapping is unit-tested without a request.
 */
export function detectPlatform(userAgent: string | null | undefined): Platform {
  const ua = (userAgent ?? "").toLowerCase();
  if (!ua) return "desktop";
  // Android phones carry "mobile"; Android tablets and iPads do not, but they are
  // still the away-from-desk device this split is meant to catch, so match the
  // family, not just the "mobile" token.
  return /mobi|android|iphone|ipad|ipod|windows phone|blackberry/.test(ua) ? "mobile" : "desktop";
}

/**
 * How close two opens have to be before the second is treated as the same visit
 * rather than a new one. A today screen re-renders on navigation and on every
 * server action's revalidate; without this window those re-renders would each
 * count as an "open" and the between-opens gaps the measurement exists to see
 * would collapse to seconds. Sixty seconds is comfortably longer than a render
 * round-trip and far shorter than any real gap between sittings.
 */
export const OPEN_DEDUPE_MS = 60_000;

/** Record one engagement event. `open` is deduped within OPEN_DEDUPE_MS so a
 *  burst of re-renders is one visit; the other kinds are each a real moment and
 *  are always recorded. */
export async function recordEngagement(kind: EngagementKind, platform: Platform): Promise<void> {
  if (kind === "open") {
    const since = new Date(Date.now() - OPEN_DEDUPE_MS);
    const recent = await prisma.engagementEvent.findFirst({
      where: { kind: "open", at: { gte: since } },
      select: { id: true },
    });
    if (recent) return;
  }
  // The create MUST be awaited INSIDE inWrite. A plain model op returns a lazy
  // PrismaPromise: `inWrite(() => prisma….create(…))` would build the query but
  // schedule its execution only on the later await — after the async-local write
  // context has exited — and the guard would then block it (invariant 1's runtime
  // check). Awaiting inside the callback schedules the query while the context is
  // still active. (mutate() avoids this because $transaction is eager.)
  await inWrite(async () => {
    await prisma.engagementEvent.create({ data: { kind, platform } });
  });
}
