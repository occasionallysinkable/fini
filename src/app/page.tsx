import Link from "next/link";
import { auth, signOut } from "@/auth";
import { getActiveTasks, getDeletedTasks, getRecentActivity } from "@/lib/queries";
import { createTask, renameTask, deleteTask, undoActivity } from "./actions";

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

  const [tasks, deleted, activity] = await Promise.all([
    getActiveTasks(),
    getDeletedTasks(),
    getRecentActivity(),
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
        WP1 — every change below goes through the one write path and is reversible from the ledger.
      </p>

      <section className="mt-8">
        <form action={createTask} className="flex gap-2">
          <input
            name="title"
            placeholder="Add a task"
            autoFocus
            className="flex-1 rounded border border-line bg-surface px-3 py-2 outline-none focus:border-accent"
          />
          <button className="rounded border border-line bg-surface px-3 py-2 hover:border-accent">
            Add
          </button>
        </form>

        <ul className="mt-4 flex flex-col gap-2">
          {tasks.length === 0 && <li className="text-muted">No tasks. Add one above.</li>}
          {tasks.map((t) => (
            <li key={t.id} className="flex items-center gap-2 border-b border-line py-2">
              <form action={renameTask} className="flex flex-1 gap-2">
                <input type="hidden" name="id" value={t.id} />
                <input
                  name="title"
                  defaultValue={t.title}
                  className="flex-1 bg-transparent outline-none focus:text-accent"
                />
              </form>
              <form action={deleteTask}>
                <input type="hidden" name="id" value={t.id} />
                <button className="text-muted hover:text-text">Delete</button>
              </form>
            </li>
          ))}
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
