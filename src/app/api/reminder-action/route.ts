import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  getReminderSettings,
  resolveNotificationAction,
  type NotificationAction,
} from "@/lib/reminder-service";
import { intervalChoices, type SnoozeReasonId } from "@/lib/reminders";

/*
  WP7 · the notification action endpoint. The service worker posts here when the
  user presses Done or a snooze reason on a notification — carrying the session
  cookie, so it works from the lock screen with the app closed (reminders.md:
  both actions resolve on the server).

  The worker sends only what it knows: the reminder id, whether this is Done or a
  snooze, and either the reason (first two snoozes) or the interval id (the
  second-snooze row). The zone-aware arithmetic — how long the interval is —
  stays on the server, where the user's zone and snooze-interval setting live.
*/

export const dynamic = "force-dynamic";

const REASONS: SnoozeReasonId[] = ["middle_of_something", "wrong_time_of_day", "waiting_on_someone"];

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let payload: { reminderId?: string; action?: string; reason?: string; interval?: string };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad request" }, { status: 400 });
  }

  const reminderId = String(payload.reminderId ?? "");
  if (!reminderId) return NextResponse.json({ ok: false, error: "no reminder" }, { status: 400 });

  const now = new Date();
  let action: NotificationAction;

  if (payload.action === "done") {
    action = { kind: "done", reminderId };
  } else if (payload.action === "snooze") {
    const settings = await getReminderSettings();
    if (payload.interval) {
      // The second-snooze row: pick the chosen interval's exact instant.
      const choice = intervalChoices(now, settings.timeZone).find((c) => c.id === payload.interval);
      if (!choice) return NextResponse.json({ ok: false, error: "bad interval" }, { status: 400 });
      const minutes = Math.round((choice.at.getTime() - now.getTime()) / 60_000);
      action = { kind: "snooze", reminderId, minutes, reason: null, at: choice.at.toISOString() };
    } else {
      // A reason snooze: reschedule by the settings interval, record the reason.
      const reason = REASONS.includes(payload.reason as SnoozeReasonId)
        ? (payload.reason as SnoozeReasonId)
        : null;
      action = { kind: "snooze", reminderId, minutes: settings.snoozeMinutes, reason };
    }
  } else {
    return NextResponse.json({ ok: false, error: "bad action" }, { status: 400 });
  }

  const result = await resolveNotificationAction(action, now);
  return NextResponse.json(result, { status: result.ok ? 200 : 409 });
}
