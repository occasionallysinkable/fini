import { NextResponse } from "next/server";
import { fireDueReminders } from "@/lib/reminder-service";

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
  const result = await fireDueReminders(new Date());
  return NextResponse.json({ ok: true, ...result });
}
