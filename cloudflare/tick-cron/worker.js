/*
  fini · reminder tick cron (Cloudflare Worker).

  Handoff decision: reminders need minute accuracy and must fire with the app
  closed. Vercel's free cron runs once a day, which is useless here; a Cloudflare
  Worker cron trigger runs every minute, is free, and does not sleep. All this
  Worker does is POST to the app's /api/tick with the shared secret — the app
  does the actual firing.

  Two configured values (see wrangler.toml):
    - APP_URL     the app's origin, e.g. https://fini.vercel.app  (a plain var)
    - CRON_SECRET the shared secret, matching the app's CRON_SECRET (a Worker
                  secret — set with `wrangler secret put CRON_SECRET`, never in
                  the .toml).
*/

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(fireTick(env));
  },

  // A manual trigger for testing from a browser or curl: GET /?key=<CRON_SECRET>.
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.searchParams.get("key") !== env.CRON_SECRET) {
      return new Response("forbidden", { status: 403 });
    }
    const res = await fireTick(env);
    return new Response(res.body, { status: res.status, headers: { "content-type": "application/json" } });
  },
};

async function fireTick(env) {
  const res = await fetch(`${env.APP_URL}/api/tick`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
  });
  const body = await res.text();
  return { status: res.status, body };
}
