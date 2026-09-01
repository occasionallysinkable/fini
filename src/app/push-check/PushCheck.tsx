"use client";

import { useEffect, useState } from "react";
import { saveSubscription, sendTestPush } from "./actions";

/*
  The push-proof harness UI. It reports what the browser supports, subscribes to
  push, and fires a server-sent test push. It is deliberately plain: this exists
  to answer one question on a real phone — does push arrive when the app is
  installed to the home screen — and nothing more.
*/

// VAPID's applicationServerKey must be a Uint8Array; the public key is base64url.
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  // Back the view with an explicit ArrayBuffer so the type is Uint8Array<ArrayBuffer>,
  // which is what applicationServerKey (BufferSource) requires.
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

type Status = { kind: "idle" | "working" | "ok" | "error"; message: string };

export function PushCheck({ vapidPublicKey }: { vapidPublicKey: string | null }) {
  const [support, setSupport] = useState<string[]>([]);
  const [standalone, setStandalone] = useState(false);
  const [permission, setPermission] = useState<string>("unknown");
  const [subStatus, setSubStatus] = useState<Status>({ kind: "idle", message: "" });
  const [pushStatus, setPushStatus] = useState<Status>({ kind: "idle", message: "" });

  useEffect(() => {
    const missing: string[] = [];
    if (!("serviceWorker" in navigator)) missing.push("service workers");
    if (!("PushManager" in window)) missing.push("the Push API");
    if (!("Notification" in window)) missing.push("notifications");
    setSupport(missing);

    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setStandalone(isStandalone);

    if ("Notification" in window) setPermission(Notification.permission);
  }, []);

  async function subscribe() {
    if (!vapidPublicKey) {
      setSubStatus({ kind: "error", message: "The server has no VAPID public key set. Add the env vars and redeploy." });
      return;
    }
    setSubStatus({ kind: "working", message: "Registering…" });
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") {
        setSubStatus({ kind: "error", message: `Permission ${perm}. iOS asks only from a home-screen app.` });
        return;
      }

      const existing = await reg.pushManager.getSubscription();
      const subscription =
        existing ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
        }));

      const json = subscription.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
      const res = await saveSubscription(
        { endpoint: json.endpoint!, keys: { p256dh: json.keys!.p256dh!, auth: json.keys!.auth! } },
        navigator.userAgent.slice(0, 120)
      );
      setSubStatus({ kind: res.ok ? "ok" : "error", message: res.message });
    } catch (err) {
      setSubStatus({ kind: "error", message: (err as Error).message });
    }
  }

  async function fireTestPush() {
    setPushStatus({ kind: "working", message: "Sending…" });
    try {
      const res = await sendTestPush();
      setPushStatus({ kind: res.ok ? "ok" : "error", message: res.message });
    } catch (err) {
      setPushStatus({ kind: "error", message: (err as Error).message });
    }
  }

  return (
    <div className="space-y-6">
      <section className="space-y-1 text-sm">
        <p>
          Home-screen app:{" "}
          <strong>{standalone ? "yes — launched standalone" : "no — this is a browser tab"}</strong>
        </p>
        <p>
          Notification permission: <strong>{permission}</strong>
        </p>
        {support.length > 0 && (
          <p className="text-red-600">This browser is missing: {support.join(", ")}.</p>
        )}
        {!standalone && (
          <p className="text-amber-700">
            On iPhone, push only arrives from a home-screen app. Use Share → Add to Home Screen, then
            open this from the home-screen icon before enabling notifications.
          </p>
        )}
      </section>

      <section className="space-y-2">
        <button
          onClick={subscribe}
          disabled={subStatus.kind === "working" || support.length > 0}
          className="rounded bg-black px-4 py-2 text-white disabled:opacity-40"
        >
          1 · Enable notifications on this device
        </button>
        {subStatus.message && (
          <p className={subStatus.kind === "error" ? "text-red-600 text-sm" : "text-sm"}>{subStatus.message}</p>
        )}
      </section>

      <section className="space-y-2">
        <button
          onClick={fireTestPush}
          disabled={pushStatus.kind === "working"}
          className="rounded border border-black px-4 py-2 disabled:opacity-40"
        >
          2 · Send a test push from the server
        </button>
        {pushStatus.message && (
          <p className={pushStatus.kind === "error" ? "text-red-600 text-sm" : "text-sm"}>{pushStatus.message}</p>
        )}
        <p className="text-xs text-muted">
          After tapping this, lock the phone or switch apps — the notification should still arrive.
        </p>
      </section>
    </div>
  );
}
