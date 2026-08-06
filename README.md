# fini — WP1: schema and the write spine

This is work package 1 only: every table in the data model, single-address auth,
and the `mutate()` write path with working undo. Nothing from WP2 onward is here.

## Stack (from `docs/handoff.md`, unchanged)

Next.js App Router + TypeScript · Postgres on Neon + Prisma · Tailwind v4 with
design tokens as CSS custom properties · Auth.js email magic link · hosted on
Vercel.

## Local setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill it in (Neon URL, `AUTH_SECRET`,
   `ALLOWED_EMAIL`, SMTP for the magic link).
3. `npx prisma migrate dev` — creates every table.
4. `npm run db:seed` — writes the one user row (`ALLOWED_EMAIL`).
5. `npm run dev` — open http://localhost:3000, sign in with the allowed address.

## Proving the spine

- `npm test` — unit test of the reversal dispatch (no DB needed).
- `npm run db:roundtrip` — against a live DB: creates, updates and soft-deletes a
  task through `mutate()`, undoes each, and asserts the restored state.

## Deploy (Vercel + Neon)

1. Create a Neon Postgres database; copy its connection string.
2. Import the repo into Vercel. Set `DATABASE_URL`, `AUTH_SECRET`,
   `ALLOWED_EMAIL`, `EMAIL_SERVER`, `EMAIL_FROM`, and `AUTH_URL` (your Vercel URL).
3. Build command is `npm run build` (runs `prisma generate` then `next build`).
4. Run migrations against the production DB once: `npx prisma migrate deploy`
   (or add it to the build). The database persists across redeploys — Neon is
   separate from the Vercel build, so a redeploy never touches the data.

## Enforcing the write path (invariant 1)

`mutate()` being the only write path is enforced two ways, not by convention:

- **Runtime.** `src/lib/prisma.ts` exports a *guarded* client. Any
  create/update/delete made through it outside `mutate()`'s write context
  throws before it reaches the database. `mutate()` marks its transaction with
  an async-local flag (`src/lib/write-context.ts`); the guard lets those writes
  through and blocks all others. The Auth.js adapter uses a separate unguarded
  client for its own session/verification rows.
- **Build time.** An ESLint rule (`eslint.config.mjs`) fails the build if
  anything under `src/app` imports the Prisma client directly. Components read
  through `src/lib/queries.ts` and write through `mutate()`, so the runtime
  guard can never be reached past.

`npm test` includes a test that a direct write throws.

## The invariants this package holds

1. Every write goes through `src/lib/mutate.ts`, which also writes an `activity`
   row (actor, summary, undo payload).
2. Every write is reversible; deletes set `deleted_at` and nothing else; there
   are no confirmation dialogs.
3. No stored totals. 5. Estimate is one nullable integer of minutes.
10. Dates are `@db.Date`; instants are `DateTime` (UTC). 12. No life-specific
    values in code — only in `prisma/seed.ts`.

The remaining invariants (7, 8, 9, 14) are surfaced by later, screen-heavy
packages; nothing here violates them.
