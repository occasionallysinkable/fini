import { NextResponse } from "next/server";
import { fireDueReminders } from "@/lib/reminder-service";
import { rollMissedOccurrences } from "@/lib/recurrence-service";
import { recordWeeklyExportDueIfNeeded } from "@/lib/export-service";
import { backfillDueInstants } from "@/lib/clock-service";
import { armExistingStartReminders } from "@/lib/start-reminder-service";

/*
  WP7 · the tick endpoint. A Cloudflare Worker cron trigger posts here every
  minute with a shared secret (handoff: Vercel's free cron runs once a day, which
  is useless for minute-accurate reminders). It fires every reminder that has come
  due and returns a small tally.

  The secret is CRON_SECRET, sent as `Authorization: Bearer <secret>`. It is a
  server secret set in the hosting environment and in the Worker — never shipped
  to the browser. With no secret configured the endpoint refuses, so a
  misconfigured deploy fails closed rather than firing for anyone who finds the URL.
*/

export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const expected = (process.env.CRON_SECRET ?? "").trim();
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  // Length check first so the equality compare is not a length oracle.
  return token.length === expected.length && token === expected;
}

export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const now = new Date();
  // WP12 · fill due_at_utc on any commitment captured before the clock existed
  // (idempotent — only rows with a due date and a null instant). Runs before the
  // reminders so the chain and any instant-dependent read is current this tick.
  const backfill = await backfillDueInstants();
  // WP13 · arm a start reminder on every existing commitment with a due date that
  // has none yet (R22 · "existing commitments armed in one pass"). Runs AFTER the
  // backfill so due_at_utc is filled before the safe start is read, and it is
  // idempotent — a commitment already carrying one (armed or removed) is skipped.
  const armed = await armExistingStartReminders();
  // WP8 · collapse any missed recurring occurrences before firing, so a skipped
  // habit's reminder does not fire against a date that has already passed.
  const roll = await rollMissedOccurrences(now);
  const result = await fireDueReminders(now);
  // WP10 · the weekly export nudge. Idempotent by reading the log, so this
  // every-minute tick records "an export is due" at most once a week.
  const exportDue = await recordWeeklyExportDueIfNeeded(now);
  return NextResponse.json({
    ok: true,
    ...result,
    skipped: roll.skipped,
    exportDue,
    backfilled: backfill.filled,
    startRemindersArmed: armed.armed,
  });
}
