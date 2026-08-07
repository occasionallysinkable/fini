import Link from "next/link";
import { auth } from "@/auth";
import { getProjectTree, getRecentActivity } from "@/lib/queries";
import { firstUnfinishedTaskId } from "@/lib/availability";
import {
  createProject,
  toggleProjectHold,
  toggleProjectSequence,
  setReviewInterval,
  addNote,
  undoActivity,
} from "../actions";

/*
  WP3 · projects and sub-projects. Two levels in the interface (R20); the data
  nests deeper and that depth is simply not drawn. A sub-project is created only
  under a top-level project, which is what keeps the interface at two levels
  without the schema knowing anything about a limit.

  State reads as words, never colour (invariant 7). Consequences and undo live
  in the activity strip at the foot of the page (invariant 8 / R4).
*/

type Tree = Awaited<ReturnType<typeof getProjectTree>>;
type ProjectNode = Tree[number];
type ChildNode = ProjectNode["children"][number];
type TaskRow = ProjectNode["tasks"][number];

function fmtDate(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

// One task line inside a project. For a sequence project only the first
// unfinished task is available now; the rest exist but are later steps.
function TaskLine({
  task,
  isSequence,
  firstStepId,
}: {
  task: TaskRow;
  isSequence: boolean;
  firstStepId: string | null;
}) {
  const words: string[] = [task.status];
  const due = fmtDate(task.dueDate);
  if (due) words.push(`due ${due}${task.dueTime ? ` ${task.dueTime}` : ""}`);
  const defer = fmtDate(task.deferUntil);
  if (defer) words.push(`deferred to ${defer}`);
  if (isSequence) {
    words.push(task.id === firstStepId ? "available now" : "later in sequence");
  }
  return (
    <li className="py-1 text-sm">
      {task.title} <span className="text-muted">· {words.join(" · ")}</span>
    </li>
  );
}

function ProjectFlags({ p }: { p: ProjectNode | ChildNode }) {
  const flags: string[] = [];
  if (p.isSequence) flags.push("sequence");
  if (p.onHold) flags.push("on hold");
  if (p.reviewIntervalDays) flags.push(`review every ${p.reviewIntervalDays}d`);
  if (flags.length === 0) return null;
  return <span className="text-muted"> · {flags.join(" · ")}</span>;
}

// The row of plain-word controls a project carries. Same set on a child, minus
// the "add sub-project" form (that is the two-level limit, held in the UI).
function ProjectControls({ p, canNest }: { p: ProjectNode | ChildNode; canNest: boolean }) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
      <form action={toggleProjectSequence}>
        <input type="hidden" name="id" value={p.id} />
        <button className="text-accent hover:underline">
          {p.isSequence ? "make a plain project" : "make a sequence"}
        </button>
      </form>
      <form action={toggleProjectHold}>
        <input type="hidden" name="id" value={p.id} />
        <button className="text-accent hover:underline">
          {p.onHold ? "take off hold" : "put on hold"}
        </button>
      </form>
      <form action={setReviewInterval} className="flex items-center gap-1">
        <input type="hidden" name="id" value={p.id} />
        <label className="text-muted">review every</label>
        <input
          name="days"
          type="number"
          min={1}
          defaultValue={p.reviewIntervalDays ?? ""}
          placeholder="—"
          className="w-14 border-b border-line bg-transparent text-center outline-none focus:text-accent"
        />
        <span className="text-muted">days</span>
        <button className="text-accent hover:underline">set</button>
      </form>
      {canNest && (
        <form action={createProject} className="flex items-center gap-1">
          <input type="hidden" name="parentId" value={p.id} />
          <input
            name="name"
            placeholder="add sub-project…"
            className="w-40 border-b border-line bg-transparent outline-none focus:text-accent"
          />
          <button className="text-accent hover:underline">add</button>
        </form>
      )}
    </div>
  );
}

function TaskList({ p }: { p: ProjectNode | ChildNode }) {
  if (p.tasks.length === 0) {
    return <p className="mt-1 text-sm text-muted">No tasks yet.</p>;
  }
  const firstStepId = firstUnfinishedTaskId(p.tasks);
  return (
    <ul className="mt-1">
      {p.tasks.map((t) => (
        <TaskLine key={t.id} task={t} isSequence={p.isSequence} firstStepId={firstStepId} />
      ))}
    </ul>
  );
}

export default async function ProjectsPage() {
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

  const [tree, activity] = await Promise.all([getProjectTree(), getRecentActivity()]);
  const now = Date.now();

  return (
    <main className="mx-auto max-w-2xl p-8">
      <header className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold">Projects</h1>
        <nav className="flex gap-3 text-sm text-muted">
          <Link href="/" className="hover:text-text">tasks</Link>
          <Link href="/review" className="hover:text-text">review</Link>
        </nav>
      </header>
      <p className="mt-1 text-muted">
        Two levels here; the data nests as deep as you like. A sequence shows one
        available step at a time — the rest stay, just not on the day.
      </p>

      <form action={createProject} className="mt-6 flex items-center gap-2">
        <input
          name="name"
          placeholder="new project…"
          // Empty state: the useful input is already focused (decisions line 347).
          autoFocus={tree.length === 0}
          className="flex-1 border-b border-line bg-transparent py-1 outline-none focus:text-accent"
        />
        <button className="text-accent hover:underline">add project</button>
      </form>

      <div className="mt-8 flex flex-col gap-8">
        {tree.length === 0 && <p className="text-muted">No projects yet.</p>}
        {tree.map((p) => (
          <section key={p.id}>
            <h2 className="font-medium">
              {p.name}
              <ProjectFlags p={p} />
            </h2>
            <ProjectControls p={p} canNest />
            <TaskList p={p} />

            {p.children.length > 0 && (
              <div className="mt-3 flex flex-col gap-4 border-l border-line pl-4">
                {p.children.map((c) => (
                  <div key={c.id}>
                    <h3 className="text-sm font-medium">
                      {c.name}
                      <ProjectFlags p={c} />
                    </h3>
                    {/* No "add sub-project" here: that is the two-level limit,
                        held in the interface rather than the schema (R20). */}
                    <ProjectControls p={c} canNest={false} />
                    <TaskList p={c} />
                  </div>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>

      <section className="mt-10">
        <h2 className="text-muted">A standalone note</h2>
        <form action={addNote} className="mt-2 flex items-center gap-2">
          <input
            name="body"
            placeholder="a thought that belongs to no task…"
            className="flex-1 border-b border-line bg-transparent py-1 outline-none focus:text-accent"
          />
          <button className="text-accent hover:underline">save</button>
        </form>
      </section>

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
