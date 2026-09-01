"use server";

import { prisma } from "@/lib/prisma";
import { mutate } from "@/lib/mutate";
import { sendToAllDevices, type WebPushSubscription } from "@/lib/push";

/*
  Server actions for the WP7 push-proof harness.

  saveSubscription writes a `device` row through mutate() — invariant 1: no row
  reaches the database except through the logged write path. sendTestPush only
  sends (no DB write), then prunes any endpoint the push service says is gone,
  and that prune goes through mutate() too.

  This whole file is the harness. When push is proven on the phone, the real
  WP7 subscribe flow replaces it and is tied to the signed-in session.
*/

export interface SaveResult {
  ok: boolean;
  message: string;
}

export async function saveSubscription(
  subscription: WebPushSubscription,
  label: string | null
): Promise<SaveResult> {
  if (!subscription?.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
    return { ok: false, message: "The browser returned an incomplete subscription." };
  }

  // Read (allowed outside the write path) to decide the correct undo: restore a
  // pre-existing row, or delete a freshly created one.
  const existing = await prisma.device.findUnique({
    where: { endpoint: subscription.endpoint },
  });

  await mutate({
    actor: { kind: "user" },
    verb: "device.register",
    summary: "Registered this device for push notifications.",
    filterKind: "reminders",
    undo: existing
      ? {
          ops: [
            {
              action: "update",
              model: "device",
              id: existing.id,
              data: {
                keys: existing.keys as object,
                label: existing.label,
                notificationsEnabled: existing.notificationsEnabled,
                lastSeenAt: existing.lastSeenAt,
              },
            },
          ],
        }
      : { ops: [{ action: "deleteWhere", model: "device", where: { endpoint: subscription.endpoint } }] },
    apply: (tx) =>
      tx.device.upsert({
        where: { endpoint: subscription.endpoint },
        create: {
          endpoint: subscription.endpoint,
          keys: subscription.keys,
          label,
          notificationsEnabled: true,
          lastSeenAt: new Date(),
        },
        update: {
          keys: subscription.keys,
          label,
          notificationsEnabled: true,
          lastSeenAt: new Date(),
        },
      }),
  });

  return { ok: true, message: "This device is registered. Send a test push." };
}

export interface TestPushResult {
  ok: boolean;
  message: string;
}

export async function sendTestPush(): Promise<TestPushResult> {
  const deviceCount = await prisma.device.count({ where: { notificationsEnabled: true } });
  if (deviceCount === 0) {
    return { ok: false, message: "No device is registered yet. Enable notifications first." };
  }

  let result;
  try {
    result = await sendToAllDevices({
      title: "fini",
      body: "Push works. This came from the server.",
      tag: "fini-test",
    });
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }

  // Prune subscriptions the push service reports as gone, through the write path.
  for (const endpoint of result.goneEndpoints) {
    const device = await prisma.device.findUnique({ where: { endpoint } });
    if (!device) continue;
    await mutate({
      actor: { kind: "app" },
      verb: "device.prune",
      summary: "Removed a device whose push subscription had expired.",
      filterKind: "reminders",
      undo: { ops: [] }, // a gone subscription cannot be restored; nothing to undo
      apply: (tx) => tx.device.delete({ where: { id: device.id } }),
    });
  }

  const parts = [`Sent to ${result.sent} device(s)`];
  if (result.failed) parts.push(`${result.failed} failed`);
  if (result.goneEndpoints.length) parts.push(`${result.goneEndpoints.length} expired and were removed`);
  return { ok: result.sent > 0, message: parts.join(" · ") + "." };
}
