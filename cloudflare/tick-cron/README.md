# Reminder tick cron

A Cloudflare Worker that POSTs to the fini app's `/api/tick` every minute, so
reminders fire to the minute with the app closed. It carries a shared secret;
the app refuses the endpoint without it.

## Deploy (once, ~5 minutes)

You need a free Cloudflare account and the `wrangler` CLI (`npm i -g wrangler`,
then `wrangler login`).

1. Pick a strong secret and set it on the app first (Vercel → the fini project →
   Settings → Environment Variables), for Production:

   ```
   CRON_SECRET = <a long random string>
   ```

   Redeploy the app so it picks up the variable.

2. In this folder, set your app URL in `wrangler.toml` (`APP_URL`).

3. Deploy the Worker and give it the same secret:

   ```bash
   cd cloudflare/tick-cron
   wrangler deploy
   wrangler secret put CRON_SECRET   # paste the SAME value as step 1
   ```

The cron trigger (`* * * * *`) starts firing on its own. To test immediately,
open `https://<your-worker>.workers.dev/?key=<CRON_SECRET>` — it runs one tick
and shows the app's JSON reply (`{"ok":true,"due":N,"fired":N,"devices":N}`).
