import Link from "next/link";
import { auth } from "@/auth";
import { getBoardData, getRecentActivity, getStaleData, getUserSettingsRow } from "@/lib/queries";
import { readSidebarWidth } from "@/lib/task-page";
import { Board } from "./Board";

/*
  WP4 · the board. A spreadsheet-like sheet with a search bar over it: all active
  tasks grouped by project, soonest due first, four default columns. Everything
  interactive — column scrolling under the frozen title, the config panel,
  selection and its action bar, search takeover, Tab-to-filter — lives in the
  client <Board>. This server component only reads and hands it a plain payload.

  Out of scope here, by the build order: the stale block (WP5), the task page
  (WP6, so clicking a row does nothing — its default), and anything in Settings
  (WP10). The board config lives entirely in the panel, never in Settings.
*/

export default async function BoardPage() {
  const session = await auth();
  if (!session?.user) {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <p className="text-muted">
          <Link href="/signin" className="text-accent underline">
            Sign in
          </Link>{" "}
          to use it.
        </p>
      </main>
    );
  }

  const [data, activity, stale, userSettings] = await Promise.all([
    getBoardData(),
    getRecentActivity(),
    getStaleData(),
    getUserSettingsRow(),
  ]);
  // The task-page sidebar's remembered width lives in user.settings (WP6 writes
  // it there; WP10 reads the same key). Defaults when never dragged.
  const sidebarWidth = readSidebarWidth(userSettings?.settings);

  return (
    <main className="mx-auto max-w-5xl p-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold">Board</h1>
        <nav className="flex gap-3 text-sm text-muted">
          <Link href="/" className="hover:text-text">
            tasks
          </Link>
          <Link href="/projects" className="hover:text-text">
            projects
          </Link>
          <Link href="/review" className="hover:text-text">
            review
          </Link>
        </nav>
      </header>

      <Board
        data={data}
        stale={stale}
        initialSidebarWidth={sidebarWidth}
        activity={activity.map((a) => ({
          id: a.id,
          actor: a.actor,
          summary: a.summary,
          undoable: !!a.undoExpiresAt && a.undoExpiresAt.getTime() > Date.now(),
        }))}
      />
    </main>
  );
}
