"use client";

import { useEffect, useState } from "react";
import { saveSubscription } from "./actions";

/*
  WP7 · the notification-setup line. This is the persistent line reminders.md
  calls for: it names when this device is silent and offers the browser's
  permission prompt. It sits at the top of today. Push is opt in — nothing arms
  itself — so a device is only registered when the user presses the button here.

  When notifications are already granted and the device is subscribed it steps out
  of the way, showing one quiet line rather than a callout.
*/

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

type Status = { kind: "idle" | "working" | "ok" | "error"; message: string };

export function NotificationSetup({ vapidPublicKey }: { vapidPublicKey: string | null }) {
  const [supported, setSupported] = useState(true);
  const [permission, setPermission] = useState<NotificationPermission | "unknown">("unknown");
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle", message: "" });

  useEffect(() => {
    const ok =
      "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    setSupported(ok);
    if (!ok) return;
    setPermission(Notification.permission);
    navigator.serviceWorker
      .getRegistration()
      .then((reg) => reg?.pushManager.getSubscription() ?? null)
      .then((sub) => setSubscribed(!!sub))
      .catch(() => setSubscribed(false));
  }, []);

  async function enable() {
    if (!vapidPublicKey) {
      setStatus({ kind: "error", message: "The server has no VAPID public key set." });
      return;
    }
    setStatus({ kind: "working", message: "Enabling…" });
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") {
        setStatus({ kind: "error", message: `Permission ${perm}. Allow notifications to be reminded.` });
        return;
      }

      const existing = await reg.pushManager.getSubscription();
      const subscription =
        existing ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
        }));

      const json = subscription.toJSON() as {
        endpoint?: string;
        keys?: { p256dh?: string; auth?: string };
      };
      const res = await saveSubscription(
        { endpoint: json.endpoint!, keys: { p256dh: json.keys!.p256dh!, auth: json.keys!.auth! } },
        navigator.userAgent.slice(0, 120)
      );
      setSubscribed(res.ok);
      setStatus({ kind: res.ok ? "ok" : "error", message: res.message });
    } catch (err) {
      setStatus({ kind: "error", message: (err as Error).message });
    }
  }

  if (!supported) {
    return (
      <p className="text-sm text-deadline">
        This browser cannot show push reminders (no service worker or Push API).
      </p>
    );
  }

  // Granted and subscribed: one quiet line, no callout.
  if (permission === "granted" && subscribed) {
    return <p className="text-xs text-muted">Reminders are on for this device.</p>;
  }

  // Otherwise this device is silent — name it plainly and offer the prompt.
  return (
    <div className="rounded border border-line bg-surface/50 px-3 py-2 text-sm">
      <p>
        {permission === "denied"
          ? "Notifications are blocked for this device — turn them on in the browser to be reminded."
          : "This device will not be reminded until you turn notifications on."}
      </p>
      <div className="mt-2 flex items-center gap-3">
        <button
          onClick={enable}
          disabled={status.kind === "working" || permission === "denied"}
          className="rounded border border-line bg-surface px-3 py-1.5 hover:border-accent disabled:opacity-40"
        >
          Turn on reminders for this device
        </button>
        {status.message && (
          <span className={status.kind === "error" ? "text-deadline text-xs" : "text-muted text-xs"}>
            {status.message}
          </span>
        )}
      </div>
    </div>
  );
}
