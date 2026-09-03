import { prisma } from "./prisma";
import { todayInZone, weekdayOf, type ParseContext, type ShiftWindow } from "./parse";
import {
  routeTasks,
  shiftLoad,
  dayTotalMinutes,
  isOnboarded,
  readWakingHours,
  weekdaysLabel,
  type RoutableShift,
  type RoutableTask,
  type ShiftLoad,
} from "./shifts";
import { isAvailable } from "./availability";
import { isReviewDue } from "./review";
import { collectProjectSubtree } from "./projects";
import type { BoardTask, ColumnId, GroupKey, Sort } from "./board";
import type { TaskPageData } from "./task-page";
import { reminderLabel, formatFireTime } from "./reminders";
import { orderChain, type ChainInput } from "./clock";
import { selectToday, humanDate, shortDate, type TodayTask } from "./today";
import { groupByDay, type ActivityLine, type FilterKind } from "./activity";
import { getHabitHistory } from "./recurrence-service";
import {
  KEEP_VERB,
  UNDO_VERB,
  buildStaleRows,
  isStale,
  readStaleTreatment,
  showSweeps,
  type StaleRow,
  type StaleTreatment,
} from "./stale";

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

/** One reminder row, for the remove action's undo (restore enabled + fire time). */
export function getReminder(id: string) {
  return prisma.reminder.findUnique({ where: { id } });
}

/** One device by its push endpoint, for the subscribe action's undo. */
export function getDeviceByEndpoint(endpoint: string) {
  return prisma.device.findUnique({ where: { endpoint } });
}

/** The live reminders you SET on a task — for rescheduling when the due date/time
 *  moves, and for the fields their undo needs. The start reminder is excluded: its
 *  fire instant is the safe start off due_at_utc, not an offset in the user's zone
 *  (WP13), so it is recomputed on its own path, never through this reschedule. */
export function getEnabledReminders(taskId: string) {
  return prisma.reminder.findMany({
    where: { taskId, enabled: true, isStartReminder: false },
    select: { id: true, offsetMinutes: true, absoluteAt: true, nextFireAtUtc: true },
  });
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

// ---------------------------------------------------------------------------
// WP6 · the task page. One task read whole for the sidebar: the five sections'
// fields, the person-and-role pairs, the notes, the reminders (WP7 lists them;
// their add flow and the estimate-derived line are WP7's), and the task's own
// activity history — the rows WP1's write spine has been writing all along, read
// here collapsed with a count. Shaped into TaskPageData (strings, not Date
// objects) so the client sidebar receives a plain, serialisable payload.
// ---------------------------------------------------------------------------

export async function getTaskPageData(id: string): Promise<TaskPageData | null> {
  const [t, user] = await Promise.all([
    prisma.task.findFirst({
      where: { id, deletedAt: null },
      include: {
        project: { select: { name: true } },
        taskPeople: {
          include: {
            person: { select: { id: true, name: true, timezone: true, dayStart: true, dayEnd: true } },
          },
        },
        notes: { orderBy: { createdAt: "desc" } },
        // Only live reminders: removing one disables it (invariant 2 — no
        // destructive delete), so a removed reminder is enabled:false and gone
        // from the list, and undo re-enables it. The start reminder sits at the
        // top of the list (reminders.md · "on a commitment the start reminder
        // sits at the top of the same list").
        reminders: {
          where: { enabled: true },
          orderBy: [{ isStartReminder: "desc" }, { createdAt: "asc" }],
        },
      },
    }),
    prisma.user.findFirst({ select: { timezone: true } }),
  ]);
  if (!t) return null;
  const timeZone = user?.timezone ?? "UTC";

  // History is last and collapsed (R6): the most recent entries plus a total
  // count. It reads the activity log, adding no store of its own.
  const [history, historyCount] = await Promise.all([
    prisma.activity.findMany({ where: { taskId: id }, orderBy: { at: "desc" }, take: 20 }),
    prisma.activity.count({ where: { taskId: id } }),
  ]);

  // WP8 · a habit on a rule shows completion history only (R18), counted across
  // every occurrence of its series.
  const habitHistory =
    t.kind === "habit" && t.recurrenceRuleId ? await getHabitHistory(t.recurrenceRuleId) : null;

  return {
    id: t.id,
    title: t.title,
    boardTask: toBoardTask(t),
    dueDate: ymd(t.dueDate),
    dueTime: t.dueTime,
    doDate: ymd(t.doDate),
    deferUntil: ymd(t.deferUntil),
    estimateMinutes: t.estimateMinutes,
    splittable: t.splittable,
    minChunkMinutes: t.minChunkMinutes,
    actualMinutes: t.actualMinutes,
    people: t.taskPeople.map((tp) => ({
      personId: tp.person.id,
      name: tp.person.name,
      timezone: tp.person.timezone,
      dayStart: tp.person.dayStart,
      dayEnd: tp.person.dayEnd,
      role: tp.role,
    })),
    reminders: t.reminders.map((r) => ({
      id: r.id,
      label: reminderLabel(r),
      when: formatFireTime(r.nextFireAtUtc, timeZone),
      isStart: r.isStartReminder,
    })),
    notes: t.notes.map((n) => ({ id: n.id, body: n.body })),
    history: history.map((a) => ({
      id: a.id,
      at: a.at.toISOString(),
      actor: a.actor,
      summary: a.summary,
    })),
    historyCount,
    habitHistory,
  };
}

export interface ArmedReminder {
  id: string;
  taskId: string;
  taskTitle: string;
  label: string;
  when: string;
}

/**
 * Every reminder that is armed and will fire, in time order (reminders.md ·
 * "Seeing what will fire"): enabled, with a fire time still set, on a live active
 * task. This answers the first question anyone asks a reminder feature — did that
 * actually save, and what is going to wake me. Reminders that already fired have
 * next_fire cleared, so they drop off this list.
 */
export async function getArmedReminders(): Promise<ArmedReminder[]> {
  const [reminders, user] = await Promise.all([
    prisma.reminder.findMany({
      where: { enabled: true, nextFireAtUtc: { not: null }, task: { deletedAt: null, status: "active" } },
      orderBy: { nextFireAtUtc: "asc" },
      include: { task: { select: { id: true, title: true } } },
    }),
    prisma.user.findFirst({ select: { timezone: true } }),
  ]);
  const timeZone = user?.timezone ?? "UTC";
  return reminders.map((r) => ({
    id: r.id,
    taskId: r.task.id,
    taskTitle: r.task.title,
    label: reminderLabel(r),
    when: formatFireTime(r.nextFireAtUtc, timeZone),
  }));
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
      keepCount: true,
    },
  });
}

// ---------------------------------------------------------------------------
// WP5 · the stale block. Staleness is derived here from the activity log, never
// stored: a task is stale when no activity row has touched it in fourteen days
// and its status is active (handoff line 99). The kept count is counted from the
// same log — keep rows that have not been undone — rather than trusted to a
// stored counter. Nothing about this reads a muted_until field, because there is
// none: keeping writes an activity row and the same fourteen-day rule re-surfaces
// the task, so the mute and the definition are one mechanism.
// ---------------------------------------------------------------------------

export interface StaleData {
  treatment: StaleTreatment;
  /** Every stale task, oldest first. The block shows three; sweeps show all. */
  rows: StaleRow[];
  totalCount: number;
  showSweeps: boolean;
  /** All stale task ids — for the in-place marks and for the sweep actions. */
  staleIds: string[];
}

const EMPTY_STALE = (treatment: StaleTreatment): StaleData => ({
  treatment,
  rows: [],
  totalCount: 0,
  showSweeps: false,
  staleIds: [],
});

/** The user's stored settings row (id + settings JSON), read for the board's
 *  stale-treatment control. One user row (invariant 12's single life). */
export function getUserSettingsRow() {
  return prisma.user.findFirst({ select: { id: true, settings: true } });
}

export async function getStaleData(): Promise<StaleData> {
  const user = await getUserSettingsRow();
  const treatment = readStaleTreatment(user?.settings);
  // Off means the whole mechanism is silent — no block, no marks, nothing
  // computed (decisions line 96).
  if (treatment === "off") return EMPTY_STALE(treatment);

  const now = new Date();
  const tasks = await prisma.task.findMany({
    where: { deletedAt: null, status: "active" },
    select: { id: true, title: true, createdAt: true, project: { select: { name: true } } },
  });
  if (tasks.length === 0) return EMPTY_STALE(treatment);

  const ids = tasks.map((t) => t.id);
  const [lastActivity, keeps] = await Promise.all([
    // The most recent *touching* activity row per task — the fourteen-day clock
    // reads this. The where clause mirrors isTouch() in @/lib/stale: an undo row
    // is not a touch (it records a reversal), and neither is a row that was
    // itself undone (undo() nulls its undoExpiresAt). Excluding both is what lets
    // pressing undo on a keep or push return the task to the block, instead of
    // its own reversal keeping it muted for fourteen days.
    prisma.activity.groupBy({
      by: ["taskId"],
      where: { taskId: { in: ids }, verb: { not: UNDO_VERB }, undoExpiresAt: { not: null } },
      _max: { at: true },
    }),
    // Keep rows not undone: a keep sets undoExpiresAt, and undo() nulls it, so
    // "undoExpiresAt is not null" counts exactly the keeps still in effect. This
    // is the kept count the block prints — counted from the log (handoff line 99).
    prisma.activity.groupBy({
      by: ["taskId"],
      where: { taskId: { in: ids }, verb: KEEP_VERB, undoExpiresAt: { not: null } },
      _count: { _all: true },
    }),
  ]);

  const lastById = new Map<string, Date | null>();
  for (const g of lastActivity) if (g.taskId) lastById.set(g.taskId, g._max.at);
  const keepById = new Map<string, number>();
  for (const g of keeps) if (g.taskId) keepById.set(g.taskId, g._count._all);

  const staleInputs = tasks
    .filter((t) =>
      isStale(
        { status: "active", lastActivityAt: lastById.get(t.id) ?? null, createdAt: t.createdAt },
        now
      )
    )
    .map((t) => ({
      id: t.id,
      title: t.title,
      projectName: t.project?.name ?? null,
      createdAt: t.createdAt,
      keptCount: keepById.get(t.id) ?? 0,
    }));

  const rows = buildStaleRows(staleInputs, now);
  return {
    treatment,
    rows,
    totalCount: rows.length,
    showSweeps: showSweeps(rows.length),
    staleIds: rows.map((r) => r.id),
  };
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

/** Active tasks with their project and notes, for the home management list.
 *  Only status = active: a completed or cancelled task leaves this list (it is
 *  still on the board's completed filter), so ticking a task off — from the app
 *  or from a reminder's Done — visibly clears it here too. */
export function getActiveTasksWithDetail() {
  return prisma.task.findMany({
    where: { deletedAt: null, status: "active" },
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

/** The timezones of a set of people, by id — for the capture path's invariant-11
 *  clock (an asked-by person's zone governs the due instant). Read through the
 *  lib layer so the server action never imports Prisma. */
export async function getPersonTimezones(ids: string[]): Promise<Map<string, string | null>> {
  if (ids.length === 0) return new Map();
  const rows = await prisma.person.findMany({
    where: { id: { in: ids } },
    select: { id: true, timezone: true },
  });
  return new Map(rows.map((r) => [r.id, r.timezone]));
}

/** One person, for the task-page zone/working-hours editor's undo payload. */
export function getPerson(id: string) {
  return prisma.person.findUnique({ where: { id } });
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

// ---------------------------------------------------------------------------
// WP9 · the plain today (R21) and the activity page (R9/R10). Reads only; the
// ordering, the flat line, the filters and the grouping are the pure functions
// in @/lib/today and @/lib/activity, called here so the routes get a plain,
// serialisable payload.
// ---------------------------------------------------------------------------

async function getUserTimezone(): Promise<string> {
  const user = await prisma.user.findFirst({ select: { timezone: true } });
  return user?.timezone ?? "UTC";
}

/** One task as the today screen sees it: the pure TodayTask fields, plus the
 *  blocker id and expected-by that the not-today "already blocked" branch edits
 *  (R3), and the reason it carries for the ledger. */
export interface TodayItem extends TodayTask {
  blockerId: string | null;
  expectedBy: string | null; // YYYY-MM-DD
}

/** A task the something-else search can pull forward off the board (R2). */
export interface TodaySearchItem {
  id: string;
  title: string;
  projectName: string | null;
}

/** One row of the chain (Computed table): a today deadline with the last moment
 *  it can still be started. Read-only — the screen renders it, never edits it. */
export interface ChainRow {
  id: string;
  title: string;
  /** The latest safe start, formatted in the user's zone — or null when the task
   *  has no estimate, so the app cannot say when to start, only when it is due. */
  safeStartLabel: string | null;
  /** The deadline instant, formatted in the user's zone. Carries the word
   *  "deadline" beside it on screen (R26 — no colour-only signal). */
  dueLabel: string;
}

export interface TodayData {
  today: string; // YYYY-MM-DD in the user's zone
  tasks: TodayItem[]; // the today set, ordered (R21)
  searchable: TodaySearchItem[]; // every active task, for the N search field
  ledger: { activityId: string; summary: string } | null;
  /** WP12 · the chain: today's deadline-bearing tasks ordered by safe start,
   *  read-only. Empty when nothing with a deadline is due today. */
  chain: ChainRow[];
}

/** Build the blocker line for a demoted task (R3): "waiting on Ravi, expected
 *  4 Aug", or the event text when there is no person, or a plain "waiting on
 *  someone" when neither is recorded. */
function blockerLabel(
  personName: string | null,
  eventText: string | null,
  expectedByIso: string | null,
  late: boolean
): string {
  const who = personName ?? eventText ?? "someone";
  const parts = [`waiting on ${who}`];
  if (expectedByIso) parts.push(`expected ${shortDate(expectedByIso)}`);
  if (late) parts.push("late");
  return parts.join(", ");
}

export async function getTodayData(): Promise<TodayData> {
  const today = await todayForUser();

  // Reuse the availability-filtered set (invariant 4 — one isAvailable, views
  // call it) rather than re-deriving which tasks are live.
  const available = await getAvailableTasks();
  const ids = available.map((t) => t.id);

  // The unresolved blocker per task, most recent first, with its person's name.
  // A waiting/late blocker demotes the task and gives it the "waiting on…" line.
  const blockers =
    ids.length > 0
      ? await prisma.blocker.findMany({
          where: { taskId: { in: ids }, state: { in: ["waiting", "late"] } },
          include: { person: { select: { name: true } } },
          orderBy: { createdAt: "desc" },
        })
      : [];
  const blockerByTask = new Map<string, (typeof blockers)[number]>();
  for (const b of blockers) if (!blockerByTask.has(b.taskId)) blockerByTask.set(b.taskId, b);

  const items: TodayItem[] = available.map((t) => {
    const b = blockerByTask.get(t.id);
    const expectedBy = b?.expectedBy ? ymd(b.expectedBy) : null;
    return {
      id: t.id,
      title: t.title,
      projectName: t.project?.name ?? null,
      dueDate: ymd(t.dueDate),
      dueTime: t.dueTime,
      doDate: ymd(t.doDate),
      blocked: b != null,
      blockerLabel: b
        ? blockerLabel(b.person?.name ?? null, b.eventText, expectedBy, b.state === "late")
        : null,
      blockerId: b?.id ?? null,
      expectedBy,
    };
  });

  const tasks = selectToday(items, today);

  // WP12 · the chain (Computed, never stored): today's deadline-bearing tasks —
  // available, not blocked, with a deadline date of today and a computed instant —
  // ordered by latest safe start. A blocked task cannot be started, so it is not in
  // the chain; an available one with a due date today but a null instant only
  // arises for a row the backfill has not reached yet (it fills within a tick).
  const timeZone = await getUserTimezone();
  const chainInputs: ChainInput[] = available
    .filter(
      (t) => ymd(t.dueDate) === today && t.dueAtUtc != null && !blockerByTask.has(t.id)
    )
    .map((t) => ({
      id: t.id,
      title: t.title,
      dueAtUtc: t.dueAtUtc as Date,
      estimateMinutes: t.estimateMinutes,
    }));
  const chain: ChainRow[] = orderChain(chainInputs).map((c) => ({
    id: c.id,
    title: c.title,
    safeStartLabel: c.safeStart ? formatFireTime(c.safeStart, timeZone) : null,
    dueLabel: formatFireTime(c.dueAtUtc, timeZone),
  }));

  const searchableRows = await prisma.task.findMany({
    where: { deletedAt: null, status: "active" },
    select: { id: true, title: true, project: { select: { name: true } } },
    orderBy: { title: "asc" },
  });
  const searchable: TodaySearchItem[] = searchableRows.map((t) => ({
    id: t.id,
    title: t.title,
    projectName: t.project?.name ?? null,
  }));

  // The ledger seed (R4): the most recent of today's own answers that is still
  // inside its undo window. It holds until the next answer replaces it; the
  // client owns it from there. Older answers live on the activity page.
  const last = await prisma.activity.findFirst({
    where: { verb: { startsWith: "today." }, undoExpiresAt: { not: null } },
    orderBy: { at: "desc" },
    select: { id: true, summary: true, undoExpiresAt: true },
  });
  const ledger =
    last && last.undoExpiresAt && last.undoExpiresAt.getTime() > Date.now()
      ? { activityId: last.id, summary: last.summary }
      : null;

  return { today, tasks, searchable, ledger, chain };
}

/** A blocker on a task, for the not-today branch's undo and re-seed. */
export function getBlocker(id: string) {
  return prisma.blocker.findUnique({ where: { id } });
}

/** An override row, for attaching a reason after the pick (its prior reason
 *  fields are the undo). */
export function getOverride(id: string) {
  return prisma.override.findUnique({ where: { id } });
}

// ---------------------------------------------------------------------------
// The activity stream (R9/R10). Reverse chronological, filterable by kind, and
// paginated — more loads as you scroll. Each row is formatted in the user's zone
// here (server side) so the client renders plain strings and the grouping needs
// no zone maths of its own.
// ---------------------------------------------------------------------------

export interface ActivityStreamLine extends ActivityLine {
  dayIso: string;
  heading: string;
}

export interface ActivityStreamPage {
  lines: ActivityStreamLine[];
  nextCursor: string | null;
}

/** Format a UTC instant into the user's-zone {time, dayIso} pair. */
function formatInZone(at: Date, timeZone: string): { time: string; dayIso: string } {
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(at);
  const dayIso = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
  return { time, dayIso };
}

const ACTIVITY_PAGE_SIZE = 40;

export async function getActivityStream(
  kind: FilterKind | null,
  cursorId: string | null = null
): Promise<ActivityStreamPage> {
  const timeZone = await getUserTimezone();
  const rows = await prisma.activity.findMany({
    where: kind ? { filterKind: kind } : {},
    orderBy: [{ at: "desc" }, { id: "desc" }],
    take: ACTIVITY_PAGE_SIZE + 1, // one extra tells us whether more remains
    ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    include: { actorPerson: { select: { name: true } } },
  });

  const hasMore = rows.length > ACTIVITY_PAGE_SIZE;
  const page = hasMore ? rows.slice(0, ACTIVITY_PAGE_SIZE) : rows;
  const now = Date.now();

  const lines: ActivityStreamLine[] = page.map((a) => {
    const { time, dayIso } = formatInZone(a.at, timeZone);
    const who =
      a.actor === "user" ? "You" : a.actor === "app" ? "App" : a.actorPerson?.name ?? "Someone";
    return {
      id: a.id,
      at: a.at.toISOString(),
      time,
      who,
      summary: a.summary,
      undoable: !!a.undoExpiresAt && a.undoExpiresAt.getTime() > now,
      isDeletion: a.filterKind === "deletions",
      dayIso,
      heading: humanDate(dayIso),
    };
  });

  return { lines, nextCursor: hasMore ? page[page.length - 1].id : null };
}

/** The first page of the activity stream, grouped by day, for the initial
 *  server render. The client takes over paging from `nextCursor`. */
export async function getActivityFirstPage(
  kind: FilterKind | null
): Promise<{ days: ReturnType<typeof groupByDay>; nextCursor: string | null; lines: ActivityStreamLine[] }> {
  const page = await getActivityStream(kind, null);
  return { days: groupByDay(page.lines), nextCursor: page.nextCursor, lines: page.lines };
}

// ---------------------------------------------------------------------------
// WP11 · shifts, capacity, and the scheduled total. The shift table becomes
// real here: onboarding writes the Day shift (R13), Settings adds more, and the
// scheduled total / remaining / unestimated / day total are queries computed
// from the tasks every time (invariant 3 — never stored). The arithmetic lives
// in @/lib/shifts; these functions only fetch and shape.
// ---------------------------------------------------------------------------

/** The user row plus its shift count — enough to know whether onboarding is
 *  still owed (R13/R14). One user row (invariant 12's single life). */
export async function getOnboardingState(): Promise<{
  needed: boolean;
  userId: string | null;
}> {
  const [user, shiftCount] = await Promise.all([
    prisma.user.findFirst({ select: { id: true, settings: true } }),
    prisma.shift.count(),
  ]);
  if (!user) return { needed: false, userId: null };
  return { needed: !isOnboarded(user.settings, shiftCount), userId: user.id };
}

export interface ShiftRow {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  weekdays: boolean[];
  weekdaysLabel: string;
  capacityMinutes: number | null;
  capacityFromWindow: boolean;
  /** Whether the shift runs on today's weekday — an off-today shift holds no
   *  work today, and its figures are shown as such rather than as an empty day. */
  activeToday: boolean;
  /** Category names this shift admits; empty means it takes everything (12). */
  categoryNames: string[];
  /** Today's load on this shift, computed (invariant 3). */
  load: ShiftLoad;
}

export interface ShiftEditorData {
  today: string; // YYYY-MM-DD in the user's zone
  shifts: ShiftRow[];
  /** Every category, for the add-a-shift form's picker (user-defined, 12). */
  categories: { id: string; name: string }[];
  /** The day total (Computed table): the sum of the day's shifts' scheduled
   *  minutes. Displayed, refuses nothing. */
  dayTotalMinutes: number;
  waking: { start: string; end: string };
}

/**
 * Everything the Settings shift editor renders: the shift rows with today's
 * computed figures, the categories a new shift can be restricted to, the day
 * total, and the waking-hours window (R29). Reads only — the scheduled total is
 * derived here from the untimed tasks do-dated today, never read from a column.
 */
export async function getShiftEditorData(): Promise<ShiftEditorData> {
  const user = await prisma.user.findFirst({
    select: { timezone: true, wakingStart: true, wakingEnd: true },
  });
  const timezone = user?.timezone ?? "UTC";
  const today = todayInZone(timezone);
  const weekday = weekdayOf(today);
  const todayDate = new Date(`${today}T00:00:00.000Z`);

  const [shifts, categories, tasks] = await Promise.all([
    prisma.shift.findMany({
      orderBy: [{ startTime: "asc" }, { createdAt: "asc" }],
      include: { shiftCategories: { include: { category: { select: { id: true, name: true } } } } },
    }),
    prisma.category.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    // The untimed tasks placed on today: active, do-dated today, and NOT blocked
    // out to a specific time (a block is charged by window overlap in WP14, not
    // counted here). This is the whole of the scheduled total in stage 1.
    prisma.task.findMany({
      where: {
        deletedAt: null,
        status: "active",
        doDate: todayDate,
        blockStart: null,
      },
      select: { id: true, categoryId: true, estimateMinutes: true },
    }),
  ]);

  const routableShifts: RoutableShift[] = shifts.map((sh) => ({
    id: sh.id,
    startMinutes: hhmmToMinutes(sh.startTime) ?? 0,
    endMinutes: hhmmToMinutes(sh.endTime) ?? 0,
    weekdays: sh.weekdays,
    admittedCategoryIds: sh.shiftCategories.map((sc) => sc.categoryId),
  }));
  const routableTasks: RoutableTask[] = tasks.map((t) => ({
    id: t.id,
    categoryId: t.categoryId,
    estimateMinutes: t.estimateMinutes,
  }));

  const { byShift } = routeTasks(routableShifts, routableTasks, weekday);

  const rows: ShiftRow[] = shifts.map((sh) => {
    const load = shiftLoad(byShift.get(sh.id) ?? [], sh.capacityMinutes);
    return {
      id: sh.id,
      name: sh.name,
      startTime: sh.startTime,
      endTime: sh.endTime,
      weekdays: sh.weekdays,
      weekdaysLabel: weekdaysLabel(sh.weekdays),
      capacityMinutes: sh.capacityMinutes,
      capacityFromWindow: sh.capacityFromWindow,
      activeToday: sh.weekdays[weekday],
      categoryNames: sh.shiftCategories.map((sc) => sc.category.name),
      load,
    };
  });

  // The day total counts only shifts active today (a shift off today holds no
  // work today), matching how the scheduled totals were routed.
  const activeToday = rows.filter((r) => r.weekdays[weekday]);
  const dayTotal = dayTotalMinutes(activeToday.map((r) => r.load));

  return {
    today,
    shifts: rows,
    categories,
    dayTotalMinutes: dayTotal,
    waking: readWakingHours({
      wakingStart: user?.wakingStart ?? null,
      wakingEnd: user?.wakingEnd ?? null,
    }),
  };
}

/** One shift row, for an edit action's undo payload. */
export function getShift(id: string) {
  return prisma.shift.findUnique({
    where: { id },
    include: { shiftCategories: true },
  });
}

/** The user row a shift write needs: id, settings (for the onboarding flag) and
 *  the waking window (R29, the Day shift's window). Read through the lib layer so
 *  the write actions never import Prisma (the ESLint + runtime boundary). */
export function getUserForShiftWrite() {
  return prisma.user.findFirst({
    select: { id: true, settings: true, wakingStart: true, wakingEnd: true },
  });
}
