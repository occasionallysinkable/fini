/*
  Service worker — WP7 reminders (v2, simplified for the target platforms).

  It does three jobs, all so a reminder works with the app closed and the phone
  locked (reminders.md):

    1. push  · a "reminder" push shows a notification with two actions, Done and
               Later. A "close" push carries no notification — it withdraws the
               notifications for the named tags, which is how completing on one
               device withdraws the reminder on the rest.

    2. click · BOTH actions resolve on the SERVER (a fetch to
               /api/reminder-action carrying the session cookie), so they work
               from the lock screen without opening the app. Done completes the
               task; Later reschedules it by the snooze interval. Each shows a
               short confirmation so you know the tap landed.

    3. scope · served from /sw.js at the origin root so its scope is "/".

  Why two flat actions and not the three-reason expansion the design sketched:
  Windows and Android Chrome — the only platforms in scope — render at most two
  notification buttons (Notification.maxActions === 2), so a three-reason screen
  could never fully show there, and re-showing the notification to morph the
  buttons was unreliable and confusing on a real phone. Later therefore snoozes
  directly; the per-snooze reason capture is deferred (see reminders.md).

  SW_VERSION only exists to guarantee this file differs byte-for-byte from the
  previous one, so browsers fetch and activate it instead of a cached copy.
*/
const SW_VERSION = "wp7-2";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data = { type: "reminder", title: "fini", body: event.data.text() };
    }
  }

  if (data.type === "close") {
    // Withdraw the notifications for these tags on this device (multi-device
    // withdrawal when the task is completed or snoozed elsewhere).
    event.waitUntil(
      self.registration.getNotifications().then((list) => {
        for (const n of list) {
          if (!data.tags || data.tags.includes(n.tag)) n.close();
        }
      })
    );
    return;
  }

  // A reminder: two single-tap actions, Done and Later.
  event.waitUntil(
    self.registration.showNotification(data.title || "fini", {
      body: data.body || "",
      tag: data.tag,
      renotify: true,
      requireInteraction: true,
      data: { reminderId: data.reminderId, tag: data.tag },
      actions: [
        { action: "done", title: "Done" },
        { action: "later", title: "Later" },
      ],
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  const action = event.action;
  const data = event.notification.data || {};
  const reminderId = data.reminderId;

  event.notification.close();

  // Tapping the notification body (no button) just brings the app forward.
  if (!action) {
    event.waitUntil(focusApp());
    return;
  }
  if (!reminderId) return;

  // Done completes the task; Later snoozes it by the settings interval. Both are
  // resolved on the server so they work from the lock screen.
  const body =
    action === "done"
      ? { reminderId, action: "done" }
      : action === "later"
        ? { reminderId, action: "snooze" }
        : null;
  if (!body) return;

  const okText = action === "done" ? "Marked done." : "I'll remind you again shortly.";

  event.waitUntil(
    fetch("/api/reminder-action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body),
    })
      .then((res) =>
        // Confirm the tap landed (or say plainly that it did not) — never leave
        // the user guessing whether Done worked. Same tag replaces the original;
        // silent so it does not buzz again.
        res.ok
          ? self.registration.showNotification("fini", { body: okText, tag: data.tag, silent: true })
          : notifyFailure(data.tag)
      )
      .catch(() => notifyFailure(data.tag))
  );
});

function notifyFailure(tag) {
  return self.registration.showNotification("fini", {
    body: "Could not reach the server — open the app to finish.",
    tag,
  });
}

function focusApp() {
  return self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    for (const client of clients) {
      if ("focus" in client) return client.focus();
    }
    return self.clients.openWindow("/");
  });
}
