/*
  SCAFFOLD — not the today screen. WP9 owns the real "/" today screen and builds
  it to R21 with the three answers and every branch in R1, R2 and R3; WP9 will
  replace this file. Until then this page is a plain surface for the packages
  built so far: WP2's capture box, and WP3's proof that availability is derived
  on read (the "Available now" list drops unavailable tasks; the full list keeps
  them) plus notes. It deliberately has no ranking, no reason sentence and no
  D/L/N answers — those are WP9's, and nothing here should grow into them.

  Kept minimal on purpose. New feature work does not belong on this file.
*/
import Link from "next/link";
import { auth, signOut } from "@/auth";
import {
  getAvailableTasks,
  getActiveTasksWithDetail,
  getDeletedTasks,
  getRecentActivity,
  getStandaloneNotes,
  buildCaptureContext,
} from "@/lib/queries";
import { renameTask, deleteTask, addNote, undoActivity } from "./actions";
import { CaptureBox } from "./CaptureBox";

function fmtDate(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

export default async function Home() {
  const session = await auth();

  if (!session?.user) {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <h1 className="text-lg font-semibold">fini</h1>
        <p className="mt-2 text-muted">
          The write spine. <Link href="/signin" className="text-accent underline">Sign in</Link> to use it.
        </p>
      </main>
    );
  }

  const [available, tasks, deleted, activity, standaloneNotes, captureContext] =
    await Promise.all([
      getAvailableTasks(),
      getActiveTasksWithDetail(),
      getDeletedTasks(),
      getRecentActivity(),
      getStandaloneNotes(),
      buildCaptureContext(),
    ]);

  const now = Date.now();
  const availableIds = new Set(available.map((t) => t.id));

  return (
    <main className="mx-auto max-w-2xl p-8">
      <header className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold">fini</h1>
        <nav className="flex items-baseline gap-3 text-sm text-muted">
          <Link href="/projects" className="hover:text-text">projects</Link>
          <Link href="/review" className="hover:text-text">review</Link>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/signin" });
            }}
          >
            <button className="hover:text-text">sign out</button>
          </form>
        </nav>
      </header>

      <p className="mt-1 text-muted">
        WP2 — one typed line becomes many fields. WP3 — projects, notes, and
        availability derived on read.
      </p>

      <section className="mt-8">
        <CaptureBox context={captureContext} />
      </section>

      {/* Availability is derived, never stored (invariant 4). This list is what
          the day views ask for: unavailable tasks are absent, not greyed —
          deferred-to-the-future, on a held project, or a later step of a
          sequence. They still exist in the full list below. */}
      <section className="mt-10">
        <h2 className="text-muted">Available now — derived on read</h2>
        <ul className="mt-2 flex flex-col gap-1">
          {available.length === 0 && (
            <li className="text-muted">Nothing is available right now.</li>
          )}
          {available.map((t) => {
            const due = fmtDate(t.dueDate);
            return (
              <li key={t.id} className="text-sm">
                {t.title}
                <span className="text-muted">
                  {t.project ? ` · ${t.project.name}` : ""}
                  {due ? ` · due ${due}` : ""}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      {/* The full management list: every active task, available or not, so the
          unavailable ones are visibly still here and not lost. */}
      <section className="mt-10">
        <h2 className="text-muted">All active tasks</h2>
        <ul className="mt-2 flex flex-col gap-3">
          {tasks.length === 0 && <li className="text-muted">No tasks. Add one above.</li>}
          {tasks.map((t) => {
            const facts: string[] = [t.kind];
            if (t.project) facts.push(t.project.name);
            const due = fmtDate(t.dueDate);
            if (due) facts.push(`due ${due}${t.dueTime ? ` ${t.dueTime}` : ""}`);
            if (t.doDate) facts.push(`do ${fmtDate(t.doDate)}`);
            const defer = fmtDate(t.deferUntil);
            if (defer) facts.push(`deferred to ${defer}`);
            if (t.estimateMinutes != null) facts.push(`${t.estimateMinutes}m`);
            // State reads as words (invariant 7): say plainly when a task is not
            // on the day and why the reader can infer from the facts above.
            if (!availableIds.has(t.id) && t.status === "active") facts.push("not available");
            return (
              <li key={t.id} className="border-b border-line pb-3">
                <div className="flex items-center gap-2">
                  <form action={renameTask} className="flex-1">
                    <input type="hidden" name="id" value={t.id} />
                    <input
                      name="title"
                      defaultValue={t.title}
                      className="w-full bg-transparent outline-none focus:text-accent"
                    />
                  </form>
                  <form action={deleteTask}>
                    <input type="hidden" name="id" value={t.id} />
                    <button className="text-muted hover:text-text">delete</button>
                  </form>
                </div>
                <div className="text-xs text-muted">{facts.join(" · ")}</div>

                {t.notes.length > 0 && (
                  <ul className="mt-1 flex flex-col gap-0.5 border-l border-line pl-3">
                    {t.notes.map((n) => (
                      <li key={n.id} className="text-xs text-muted">{n.body}</li>
                    ))}
                  </ul>
                )}
                <form action={addNote} className="mt-1 flex items-center gap-2 pl-3">
                  <input type="hidden" name="taskId" value={t.id} />
                  <input
                    name="body"
                    placeholder="add a note…"
                    className="flex-1 border-b border-line bg-transparent text-xs outline-none focus:text-accent"
                  />
                  <button className="text-xs text-accent hover:underline">note</button>
                </form>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Notes can stand alone, attached to no task. */}
      <section className="mt-10">
        <h2 className="text-muted">Standalone notes</h2>
        <form action={addNote} className="mt-2 flex items-center gap-2">
          <input
            name="body"
            placeholder="a thought that belongs to no task…"
            className="flex-1 border-b border-line bg-transparent py-1 outline-none focus:text-accent"
          />
          <button className="text-accent hover:underline">save</button>
        </form>
        {standaloneNotes.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1">
            {standaloneNotes.map((n) => (
              <li key={n.id} className="text-sm text-muted">{n.body}</li>
            ))}
          </ul>
        )}
      </section>

      {deleted.length > 0 && (
        <section className="mt-8">
          <h2 className="text-muted">Deleted (soft — deleted_at set, recoverable)</h2>
          <ul className="mt-2 flex flex-col gap-1">
            {deleted.map((t) => (
              <li key={t.id} className="text-muted line-through">{t.title}</li>
            ))}
          </ul>
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
