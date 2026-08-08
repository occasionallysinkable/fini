import { prisma } from "./prisma";
import { todayInZone, weekdayOf, type ParseContext, type ShiftWindow } from "./parse";
import { isAvailable } from "./availability";
import { isReviewDue } from "./review";
import { collectProjectSubtree } from "./projects";
import type { BoardTask, ColumnId, GroupKey, Sort } from "./board";

/*
  The read layer. Components and routes call these instead of importing the
  Prisma client themselves — the ESLint boundary forbids that import in app
  code, so every database touch (read or write) goes through a vetted lib
  module. Writes go through mutate(); reads go through here.
*/

export function getActiveTasks() {
  return prisma.task.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
  });
}

export function getDeletedTasks() {
  return prisma.task.findMany({
    where: { deletedAt: { not: null } },
    orderBy: { modifiedAt: "desc" },
  });
}

export function getRecentActivity() {
  return prisma.activity.findMany({ orderBy: { at: "desc" }, take: 30 });
}

export function getTask(id: string) {
  return prisma.task.findUnique({ where: { id } });
}

// ---------------------------------------------------------------------------
// WP3 · projects, sub-projects, notes, availability, review.
// ---------------------------------------------------------------------------

/** "Today" as a date in the user's own zone (invariant 10). */
async function todayForUser(): Promise<string> {
  const user = await prisma.user.findFirst({ select: { timezone: true } });
  return todayInZone(user?.timezone ?? "UTC");
}

/**
 * The project tree for the interface: top-level projects, each with their
 * direct children and the tasks of both, tasks ordered by createdAt (the
 * sequence order — invariant, no position column). The UI renders two levels
 * (R20); the data may nest deeper, and that depth is simply not drawn.
 */
export function getProjectTree() {
  const tasksArg = {
    where: { deletedAt: null },
    // Sequence order is position, then createdAt as a stable tiebreak.
    orderBy: [{ position: "asc" as const }, { createdAt: "asc" as const }],
  };
  // A deleted project (deleted_at set) is gone from the tree — the check lives
  // here in the query, not in isAvailable(), because deletion must hide a
  // project from every surface, not only the day views.
  return prisma.project.findMany({
    where: { parentId: null, deletedAt: null },
    orderBy: { name: "asc" },
    include: {
      tasks: tasksArg,
      children: {
        where: { deletedAt: null },
        orderBy: { name: "asc" },
        include: { tasks: tasksArg },
      },
    },
  });
}

/** Flat list of every live project, for the "add sub-project under…" picker. */
export function getAllProjects() {
  return prisma.project.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" } });
}

export function getProjectById(id: string) {
  return prisma.project.findUnique({ where: { id } });
}

/**
 * The live rows a project delete would take with it: the project, every
 * sub-project beneath it (any depth), and every not-already-deleted task in any
 * of them. Returned so the action can soft-delete the set in one write and build
 * an undo that restores exactly this set — nothing that was already deleted.
 */
export async function getProjectDeletionSet(
  rootId: string
): Promise<{ projectIds: string[]; taskIds: string[] }> {
  const liveProjects = await prisma.project.findMany({
    where: { deletedAt: null },
    select: { id: true, parentId: true },
  });
  const projectIds = collectProjectSubtree(liveProjects, rootId);
  const tasks = await prisma.task.findMany({
    where: { projectId: { in: projectIds }, deletedAt: null },
    select: { id: true },
  });
  return { projectIds, taskIds: tasks.map((t) => t.id) };
}

/** The next position for a task appended to the end of a project (or no project). */
export async function nextTaskPosition(projectId: string | null): Promise<number> {
  const agg = await prisma.task.aggregate({
    where: { projectId, deletedAt: null },
    _max: { position: true },
  });
  return (agg._max.position ?? -1) + 1;
}

/**
 * The day-view list: active tasks that are available right now (invariant 4).
 * Unavailable tasks are ABSENT here, not returned-and-greyed — the caller shows
 * exactly what comes back. For a sequence project, only its first unfinished
 * task survives the filter; the later steps still exist and show when you open
 * the project (getProjectTree), just not here.
 */
export async function getAvailableTasks() {
  const today = await todayForUser();
  const tasks = await prisma.task.findMany({
    where: { deletedAt: null, status: "active" },
    include: { project: true },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });

  // First unfinished task per sequence project. The query is active-only and
  // ordered by position, so the first task seen in a sequence project is its
  // lowest-position unfinished step.
  const firstStep = new Map<string, string>();
  for (const t of tasks) {
    if (t.projectId && t.project?.isSequence && !firstStep.has(t.projectId)) {
      firstStep.set(t.projectId, t.id);
    }
  }

  return tasks.filter((t) =>
    isAvailable(
      {
        deferUntil: t.deferUntil,
        project: t.project
          ? { onHold: t.project.onHold, isSequence: t.project.isSequence }
          : null,
        isFirstUnfinishedInSequence:
          t.projectId != null && t.project?.isSequence
            ? firstStep.get(t.projectId) === t.id
            : true,
      },
      today
    )
  );
}

// ---------------------------------------------------------------------------
// WP4 · the board. Reads all the board and its search need in one round: every
// active task (the board shows all of them, available or not — it is for
// organising and retrieval, not the day), the finished tasks and notes and
// projects that search also reaches, and the saved views strip. Rows are shaped
// into BoardTask (strings, not Date objects) here so the client component
// receives a plain, serialisable payload.
// ---------------------------------------------------------------------------

function ymd(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

type TaskWithProject = {
  id: string;
  title: string;
  projectId: string | null;
  project: { name: string } | null;
  kind: string;
  status: string;
  dueDate: Date | null;
  dueTime: string | null;
  doDate: Date | null;
  deferUntil: Date | null;
  estimateMinutes: number | null;
  recurrenceRuleId: string | null;
  createdAt: Date;
};

function toBoardTask(t: TaskWithProject): BoardTask {
  return {
    id: t.id,
    title: t.title,
    projectId: t.projectId,
    projectName: t.project?.name ?? null,
    kind: t.kind,
    status: t.status,
    dueDate: ymd(t.dueDate),
    dueTime: t.dueTime,
    doDate: ymd(t.doDate),
    deferUntil: ymd(t.deferUntil),
    estimateMinutes: t.estimateMinutes,
    recurring: t.recurrenceRuleId != null,
    createdAt: t.createdAt.toISOString(),
  };
}

export interface SavedViewRow {
  id: string;
  name: string;
  columns: ColumnId[];
  grouping: GroupKey[];
  sort: Sort;
  filter: string[];
}

export interface BoardData {
  active: BoardTask[];
  completed: BoardTask[];
  projects: { id: string; name: string }[];
  notes: { id: string; body: string; taskId: string | null }[];
  savedViews: SavedViewRow[];
}

export async function getBoardData(): Promise<BoardData> {
  const withProject = {
    include: { project: { select: { name: true } } },
    orderBy: [{ position: "asc" as const }, { createdAt: "asc" as const }],
  };
  const [active, completed, projects, notes, savedViews] = await Promise.all([
    prisma.task.findMany({ where: { deletedAt: null, status: "active" }, ...withProject }),
    prisma.task.findMany({
      where: { deletedAt: null, status: { in: ["done", "cancelled"] } },
      ...withProject,
    }),
    prisma.project.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.note.findMany({
      select: { id: true, body: true, taskId: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.savedView.findMany({ orderBy: [{ position: "asc" }, { name: "asc" }] }),
  ]);

  return {
    active: active.map(toBoardTask),
    completed: completed.map(toBoardTask),
    projects,
    notes,
    savedViews: savedViews.map((v) => ({
      id: v.id,
      name: v.name,
      columns: (v.columns as ColumnId[]) ?? [],
      grouping: (v.grouping as GroupKey[]) ?? [],
      sort: (v.sort as unknown as Sort) ?? { field: "due", dir: "asc" },
      filter: (v.filter as string[]) ?? [],
    })),
  };
}

/** The tasks named by a bulk selection, with just the fields an undo payload
 *  needs to restore. Reads go through the vetted lib layer, never app code. */
export function getTasksByIds(ids: string[]) {
  return prisma.task.findMany({
    where: { id: { in: ids }, deletedAt: null },
    select: {
      id: true,
      title: true,
      kind: true,
      kindIsExplicit: true,
      projectId: true,
      estimateMinutes: true,
      pushCount: true,
    },
  });
}

/** The next position for the saved-views strip (appended to the end). */
export async function nextSavedViewPosition(): Promise<number> {
  const agg = await prisma.savedView.aggregate({ _max: { position: true } });
  return (agg._max.position ?? -1) + 1;
}

/** Notes that stand alone (attached to no task), newest first. */
export function getStandaloneNotes() {
  return prisma.note.findMany({ where: { taskId: null }, orderBy: { createdAt: "desc" } });
}

/** Active tasks with their project and notes, for the management list. */
export function getActiveTasksWithDetail() {
  return prisma.task.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
    include: { project: true, notes: { orderBy: { createdAt: "desc" } } },
  });
}

/**
 * The projects due for review today (decisions line 312), each with its open
 * tasks. Never-reviewed projects come first, then the longest overdue. The
 * review screen shows one at a time; this is the ordered queue it walks.
 */
export async function getProjectsDueForReview() {
  const today = await todayForUser();
  const projects = await prisma.project.findMany({
    where: { reviewIntervalDays: { not: null }, deletedAt: null },
    include: {
      tasks: {
        where: { deletedAt: null },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      },
    },
  });
  return projects
    .filter((p) => isReviewDue(p, today))
    .sort((a, b) => {
      // Never-reviewed first (null sorts before any date), then oldest review.
      const at = a.lastReviewedAt?.getTime() ?? -Infinity;
      const bt = b.lastReviewedAt?.getTime() ?? -Infinity;
      return at - bt;
    });
}

// ---------------------------------------------------------------------------
// Capture (WP2). The parser is pure and needs a little context: today in the
// user's zone (dates are dates — invariant 10), the names that already exist
// (so the echo can say "(new)"), the default-estimate setting, and the shift
// windows the R15 caption checks a due time against.
// ---------------------------------------------------------------------------

function hhmmToMinutes(hhmm: string | null | undefined): number | null {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

/**
 * Build the parser's context from live data. Shifts come from the shift table
 * once WP11 populates it; until then the app runs on the single implicit "Day"
 * shift across the user's waking hours (R13/R14) — read from the user row, not
 * hard-coded (invariant 12).
 */
export async function buildCaptureContext(): Promise<ParseContext> {
  const [user, projects, persons, shifts] = await Promise.all([
    prisma.user.findFirst(),
    prisma.project.findMany({ select: { name: true } }),
    prisma.person.findMany({ select: { name: true } }),
    prisma.shift.findMany(),
  ]);

  const timezone = user?.timezone ?? "UTC";
  const today = todayInZone(timezone);

  const settings = (user?.settings ?? {}) as {
    defaultEstimate?: { enabled?: boolean };
  };

  let shiftWindows: ShiftWindow[] = shifts.flatMap((sh) => {
    const start = hhmmToMinutes(sh.startTime);
    const end = hhmmToMinutes(sh.endTime);
    if (start == null || end == null) return [];
    return [{ name: sh.name, startMinutes: start, endMinutes: end, weekdays: sh.weekdays }];
  });

  // Fall back to the implicit Day shift when none are configured yet: it stands
  // in for shifts so R15 has something to check against (R29). Waking hours
  // default to the whole day (00:00–00:00), and a full-day window keeps R15
  // silent until real shifts exist. The waking-hours setting is edited in
  // Settings — that UI is not WP2; it belongs with the Settings screen (R19),
  // alongside the shift editor R13 puts there.
  if (shiftWindows.length === 0) {
    const start = hhmmToMinutes(user?.wakingStart) ?? 0;
    const end = hhmmToMinutes(user?.wakingEnd) ?? 0;
    shiftWindows = [
      { name: "Day", startMinutes: start, endMinutes: end, weekdays: [true, true, true, true, true, true, true] },
    ];
  }

  return {
    today,
    todayWeekday: weekdayOf(today),
    knownProjects: projects.map((p) => p.name),
    knownPersons: persons.map((p) => p.name),
    defaultEstimateEnabled: settings.defaultEstimate?.enabled ?? true,
    shifts: shiftWindows,
  };
}

/** Resolve a project path to ids, noting which levels need creating. */
export async function resolveProjectPath(path: string[]): Promise<
  { name: string; id: string; existing: boolean; parentId: string | null }[]
> {
  const out: { name: string; id: string; existing: boolean; parentId: string | null }[] = [];
  let parentId: string | null = null;
  for (const name of path) {
    const found: { id: string } | null = await prisma.project.findFirst({
      where: { name: { equals: name, mode: "insensitive" }, parentId, deletedAt: null },
      select: { id: true },
    });
    if (found) {
      out.push({ name, id: found.id, existing: true, parentId });
      parentId = found.id;
    } else {
      const id = crypto.randomUUID();
      out.push({ name, id, existing: false, parentId });
      parentId = id;
    }
  }
  return out;
}

/** Resolve a person by name, noting whether they need creating. */
export async function resolvePerson(name: string): Promise<{ id: string; existing: boolean }> {
  const found: { id: string } | null = await prisma.person.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
    select: { id: true },
  });
  if (found) return { id: found.id, existing: true };
  return { id: crypto.randomUUID(), existing: false };
}
