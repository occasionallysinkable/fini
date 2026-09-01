/*
  Service worker — WP7 push-proof harness.

  This is the smallest worker that can prove push delivery end to end: it takes
  a push event and shows a notification, and it focuses the app when the
  notification is tapped. The full WP7 worker (Done / Later actions, the three
  snooze reasons, withdrawing on completion) is built only after push is proven
  on a real iOS home-screen app — so none of it is here yet.

  Served from /sw.js at the origin root so its scope is "/", covering every page.
*/

// Activate immediately rather than waiting for old tabs to close, so the very
// first subscribe on a fresh install has a live worker to push to.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  // The server sends JSON; fall back to a plain string so a malformed payload
  // still surfaces something rather than failing silently.
  let data = { title: "fini", body: "Test push", tag: "fini-test" };
  if (event.data) {
    try {
      data = { ...data, ...event.data.json() };
    } catch {
      data.body = event.data.text();
    }
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag,
      // Same tag collapses repeats instead of stacking; renotify makes a
      // repeat still buzz. Both matter once real reminders exist.
      renotify: true,
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) return client.focus();
      }
      return self.clients.openWindow("/push-check");
    })
  );
});
