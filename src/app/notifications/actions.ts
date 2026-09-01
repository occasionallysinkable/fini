"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { getDeviceByEndpoint } from "@/lib/queries";
import { mutate } from "@/lib/mutate";
import type { WebPushSubscription } from "@/lib/push";

/*
  WP7 · registering a device for push, tied to the signed-in session. This
  replaces the throwaway /push-check harness: a device row is written only for a
  signed-in user, through mutate() (invariant 1), and it reverses like any other
  write. There is exactly one user, so a device belongs to that user implicitly;
  the session check is what stops an unauthenticated subscribe.
*/

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Not signed in.");
  return session.user;
}

export interface SaveResult {
  ok: boolean;
  message: string;
}

export async function saveSubscription(
  subscription: WebPushSubscription,
  label: string | null
): Promise<SaveResult> {
  await requireUser();
  if (!subscription?.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
    return { ok: false, message: "The browser returned an incomplete subscription." };
  }

  const existing = await getDeviceByEndpoint(subscription.endpoint);

  await mutate({
    actor: { kind: "user" },
    verb: "device.register",
    filterKind: "reminders",
    summary: "Registered this device for reminders.",
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
        update: { keys: subscription.keys, label, notificationsEnabled: true, lastSeenAt: new Date() },
      }),
  });

  revalidatePath("/");
  return { ok: true, message: "This device is registered for reminders." };
}
