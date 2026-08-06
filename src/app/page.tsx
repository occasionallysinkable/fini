import Link from "next/link";
import { auth, signOut } from "@/auth";
import {
  getActiveTasks,
  getDeletedTasks,
  getRecentActivity,
  buildCaptureContext,
} from "@/lib/queries";
import { renameTask, deleteTask, undoActivity } from "./actions";
import { CaptureBox } from "./CaptureBox";

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

  const [tasks, deleted, activity, captureContext] = await Promise.all([
    getActiveTasks(),
    getDeletedTasks(),
    getRecentActivity(),
    buildCaptureContext(),
  ]);

  const now = Date.now();

  return (
    <main className="mx-auto max-w-2xl p-8">
      <header className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold">fini</h1>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/signin" });
          }}
        >
          <button className="text-muted hover:text-text">Sign out ({session.user.email})</button>
        </form>
      </header>

      <p className="mt-1 text-muted">
        WP2 — one typed line becomes many fields. What the app understood is echoed below in prose.
      </p>

      <section className="mt-8">
        <CaptureBox context={captureContext} />

        <ul className="mt-6 flex flex-col gap-2">
          {tasks.length === 0 && <li className="text-muted">No tasks. Add one above.</li>}
          {tasks.map((t) => {
            // State reads as words, never colour (invariant 7). A compact line
            // of what capture stored, so the parse is visible after the write.
            const facts: string[] = [t.kind];
            if (t.dueDate) {
              const d = t.dueDate.toISOString().slice(0, 10);
              facts.push(`due ${d}${t.dueTime ? ` ${t.dueTime}` : ""}`);
            }
            if (t.doDate) facts.push(`do ${t.doDate.toISOString().slice(0, 10)}`);
            if (t.estimateMinutes != null) facts.push(`${t.estimateMinutes}m`);
            return (
              <li key={t.id} className="flex items-center gap-2 border-b border-line py-2">
                <div className="flex-1">
                  <form action={renameTask} className="flex gap-2">
                    <input type="hidden" name="id" value={t.id} />
                    <input
                      name="title"
                      defaultValue={t.title}
                      className="w-full bg-transparent outline-none focus:text-accent"
                    />
                  </form>
                  <div className="text-xs text-muted">{facts.join(" · ")}</div>
                </div>
                <form action={deleteTask}>
                  <input type="hidden" name="id" value={t.id} />
                  <button className="text-muted hover:text-text">Delete</button>
                </form>
              </li>
            );
          })}
        </ul>
      </section>

      {deleted.length > 0 && (
        <section className="mt-8">
          <h2 className="text-muted">Deleted (soft — deleted_at set, recoverable)</h2>
          <ul className="mt-2 flex flex-col gap-1">
            {deleted.map((t) => (
              <li key={t.id} className="text-muted line-through">
                {t.title}
              </li>
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
