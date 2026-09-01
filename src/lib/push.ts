import webpush from "web-push";
import { prisma } from "./prisma";

/*
  Web Push sending (server only).

  VAPID keys are the server's identity to the push services (Apple, Google).
  They are read from the environment and never committed:
    - NEXT_PUBLIC_VAPID_PUBLIC_KEY  the public key (also shipped to the browser)
    - VAPID_PRIVATE_KEY             the private key (server secret)
    - VAPID_SUBJECT                 a mailto: the push service can reach

  This module only sends. It writes nothing to the database, so it does not go
  through mutate(); pruning a dead device endpoint (below) does.
*/

let configured = false;

function ensureConfigured(): void {
  if (configured) return;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) {
    throw new Error(
      "Push is not configured. Set NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT."
    );
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
}

/*
  The two shapes a push carries. A "reminder" is shown as a notification; a
  "close" carries no visible notification — it tells every device's service
  worker to withdraw the notifications for the named tags (multi-device
  withdrawal). The service worker branches on `type`.
*/
export type PushPayload =
  | {
      type: "reminder";
      title: string;
      body: string;
      tag: string;
      reminderId: string;
      /** How many times this reminder has already been snoozed, so the worker
       *  knows whether Later expands into reasons or into longer intervals. */
      snoozeCount: number;
    }
  | { type: "close"; tags: string[] };

export interface WebPushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface SendResult {
  sent: number;
  failed: number;
  goneEndpoints: string[]; // 404/410 — the subscription no longer exists
}

/**
 * Send one payload to every registered device. Returns a tally and the list of
 * endpoints the push service reports as gone (404/410), which the caller prunes
 * through mutate() so the delete is logged like any other write.
 */
export async function sendToAllDevices(payload: PushPayload): Promise<SendResult> {
  ensureConfigured();

  const devices = await prisma.device.findMany({
    where: { notificationsEnabled: true },
  });

  const body = JSON.stringify(payload);
  let sent = 0;
  let failed = 0;
  const goneEndpoints: string[] = [];

  for (const device of devices) {
    const subscription = {
      endpoint: device.endpoint,
      keys: device.keys as unknown as WebPushSubscription["keys"],
    };
    try {
      await webpush.sendNotification(subscription, body);
      sent += 1;
    } catch (err) {
      failed += 1;
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) goneEndpoints.push(device.endpoint);
    }
  }

  return { sent, failed, goneEndpoints };
}
