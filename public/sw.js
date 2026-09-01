/*
  Service worker — WP7 reminders.

  It does three jobs, all so a reminder works with the app closed and the phone
  locked (reminders.md):

    1. push  · a "reminder" push shows a notification with two actions, Done and
               Later. A "close" push carries no notification — it withdraws the
               notifications for the named tags, which is how completing on one
               device withdraws the reminder on the rest.

    2. click · Done and each snooze reason resolve on the SERVER (a fetch to
               /api/reminder-action carrying the session cookie), so they work
               from the lock screen without opening the app. Later does not hit
               the server: it re-shows the notification expanded into the three
               reasons — or, once a reminder has been snoozed twice, into a row of
               longer intervals (the count rides along in the push payload).

    3. scope · served from /sw.js at the origin root so its scope is "/",
               covering every page.

  Web notifications allow only Notification.maxActions buttons (two in practice
  on Chrome/Edge and Android). The expansion lists the reasons in priority order;
  the OS renders as many as it allows and drops the rest.
*/

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// The three snooze reasons and the second-snooze intervals. Kept in step with
// SNOOZE_REASONS / intervalChoices in src/lib/reminders.ts.
const REASONS = [
  { action: "reason-middle_of_something", title: "In the middle of something" },
  { action: "reason-wrong_time_of_day", title: "Wrong time of day" },
  { action: "reason-waiting_on_someone", title: "Waiting on someone" },
];
const INTERVALS = [
  { action: "int-30m", title: "30 minutes" },
  { action: "int-1h", title: "1 hour" },
  { action: "int-evening", title: "this evening" },
  { action: "int-morning", title: "tomorrow morning" },
];

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
    // Withdraw the notifications for these tags on this device.
    event.waitUntil(
      self.registration.getNotifications().then((list) => {
        for (const n of list) {
          if (!data.tags || data.tags.includes(n.tag)) n.close();
        }
      })
    );
    return;
  }

  // A reminder. Two actions — Done and Later — which is what fits reliably.
  event.waitUntil(
    self.registration.showNotification(data.title || "fini", {
      body: data.body || "",
      tag: data.tag,
      renotify: true,
      requireInteraction: true,
      data: { reminderId: data.reminderId, snoozeCount: data.snoozeCount || 0, tag: data.tag, stage: "fired" },
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

  // Later — expand in place into the reasons, or into the intervals once this
  // reminder has been snoozed twice. No server call; this is a re-display.
  if (action === "later" && reminderId) {
    event.notification.close();
    const intervals = (data.snoozeCount || 0) >= 2;
    const header = intervals ? "Remind me again — pick a time" : "Why not now?";
    event.waitUntil(
      self.registration.showNotification(event.notification.title, {
        body: header,
        tag: data.tag,
        renotify: true,
        requireInteraction: true,
        data: { ...data, stage: intervals ? "intervals" : "reasons" },
        actions: intervals ? INTERVALS : REASONS,
      })
    );
    return;
  }

  event.notification.close();

  // Body click (no action) just brings the app forward.
  if (!action) {
    event.waitUntil(focusApp());
    return;
  }

  // Done, a reason, or an interval — all resolve on the server.
  let body = null;
  if (action === "done") {
    body = { reminderId, action: "done" };
  } else if (action.startsWith("reason-")) {
    body = { reminderId, action: "snooze", reason: action.slice("reason-".length) };
  } else if (action.startsWith("int-")) {
    body = { reminderId, action: "snooze", interval: action.slice("int-".length) };
  }
  if (!body) return;

  event.waitUntil(
    fetch("/api/reminder-action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body),
    }).catch(() => {
      // Offline or the session lapsed: leave a short note rather than fail silently.
      return self.registration.showNotification("fini", {
        body: "Could not reach the server — open the app to finish.",
        tag: data.tag,
      });
    })
  );
});

function focusApp() {
  return self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    for (const client of clients) {
      if ("focus" in client) return client.focus();
    }
    return self.clients.openWindow("/");
  });
}
