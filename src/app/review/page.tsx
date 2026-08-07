import Link from "next/link";
import { auth } from "@/auth";
import { getProjectsDueForReview, getRecentActivity } from "@/lib/queries";
import { markProjectReviewed, setReviewInterval, undoActivity } from "../actions";

/*
  WP3 · the review screen (decisions line 311–313). It shows only the projects
  actually due, one at a time with their tasks. Marking one reviewed resets its
  clock through mutate() — so the review leaves an activity row and undoes — and
  the project drops out, the screen emptying toward nothing (R14 empty state).
*/

function fmtDate(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

export default async function ReviewPage() {
  const session = await auth();
  if (!session?.user) {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <p className="text-muted">
          <Link href="/signin" className="text-accent underline">Sign in</Link> to use it.
        </p>
      </main>
    );
  }

  const [due, activity] = await Promise.all([getProjectsDueForReview(), getRecentActivity()]);
  const now = Date.now();
  const current = due[0];
  const rest = due.slice(1);

  return (
    <main className="mx-auto max-w-2xl p-8">
      <header className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold">Review</h1>
        <nav className="flex gap-3 text-sm text-muted">
          <Link href="/" className="hover:text-text">tasks</Link>
          <Link href="/projects" className="hover:text-text">projects</Link>
        </nav>
      </header>

      {/* One at a time. Only the due projects appear; the screen empties as you
          mark each reviewed. */}
      {!current ? (
        <p className="mt-8 text-muted">Nothing is due for review.</p>
      ) : (
        <section className="mt-8">
          <h2 className="text-lg font-medium">{current.name}</h2>
          <p className="mt-1 text-sm text-muted">
            {current.lastReviewedAt
              ? `Last reviewed ${fmtDate(current.lastReviewedAt)}`
              : "Never reviewed"}
            {current.reviewIntervalDays ? ` · every ${current.reviewIntervalDays} days` : ""}
          </p>

          {current.tasks.length === 0 ? (
            <p className="mt-3 text-sm text-muted">
              No open tasks — a quiet project is exactly what review is for.
            </p>
          ) : (
            <ul className="mt-3 flex flex-col gap-1">
              {current.tasks.map((t) => {
                const due = fmtDate(t.dueDate);
                return (
                  <li key={t.id} className="text-sm">
                    {t.title}{" "}
                    <span className="text-muted">
                      · {t.status}
                      {due ? ` · due ${due}` : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
            <form action={markProjectReviewed}>
              <input type="hidden" name="id" value={current.id} />
              <button className="text-accent hover:underline">mark reviewed</button>
            </form>
            <form action={setReviewInterval} className="flex items-center gap-1">
              <input type="hidden" name="id" value={current.id} />
              <label className="text-muted">change cadence to every</label>
              <input
                name="days"
                type="number"
                min={1}
                defaultValue={current.reviewIntervalDays ?? ""}
                className="w-14 border-b border-line bg-transparent text-center outline-none focus:text-accent"
              />
              <span className="text-muted">days</span>
              <button className="text-accent hover:underline">set</button>
            </form>
          </div>

          {rest.length > 0 && (
            <p className="mt-6 text-sm text-muted">
              {rest.length} more due after this: {rest.map((p) => p.name).join(", ")}.
            </p>
          )}
        </section>
      )}

      <section className="mt-10">
        <h2 className="text-muted">Activity — the write path</h2>
        <ul className="mt-2 flex flex-col gap-1">
          {activity.map((a) => {
            const undoable = a.undoExpiresAt && a.undoExpiresAt.getTime() > now;
            return (
              <li key={a.id} className="flex items-center justify-between gap-3 py-1">
                <span>
                  <span className="text-muted">{a.actor}</span> · {a.summary}
                </span>
                {undoable && (
                  <form action={undoActivity}>
                    <input type="hidden" name="id" value={a.id} />
                    <button className="text-accent hover:underline">undo</button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
