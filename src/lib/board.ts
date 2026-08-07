/*
  WP4 · the board — the pure logic behind the sheet.

  Everything here is a pure function of its inputs, so it unit-tests without a
  database or a browser. The client component (Board.tsx) measures the live DOM
  and calls these; the server component (board/page.tsx) shapes the rows. Four
  jobs live here:

    1. arrangeBoard   — group and sort the rows (decisions line 58).
    2. deriveHidden   — which columns are scrolled out of view, from geometry
                        (the ◂ 2 · 4 ▸ count is derived, never a disabled tally).
    3. filtering      — chips narrow the board and group counts read "2 of 18".
    4. searchEverything — one flattened, kind-grouped search (decisions line 64).

  The board rows are carried as strings, not Date objects, so the whole shape
  crosses the server → client boundary without a serializer.
*/

// ---------------------------------------------------------------------------
// The row, and the knobs.
// ---------------------------------------------------------------------------

/** One task as the board sees it. Dates are "YYYY-MM-DD"; timestamps are ISO. */
export interface BoardTask {
  id: string;
  title: string;
  projectId: string | null;
  projectName: string | null;
  kind: string; // TaskKind
  status: string; // TaskStatus
  dueDate: string | null;
  dueTime: string | null; // "HH:MM"
  doDate: string | null;
  deferUntil: string | null;
  estimateMinutes: number | null;
  recurring: boolean;
  createdAt: string; // ISO instant
}

/** The columns the board can show. `title` is frozen and never switchable. */
export type ColumnId =
  | "title"
  | "project"
  | "due"
  | "estimate"
  | "kind"
  | "do"
  | "defer"
  | "status"
  | "created";

export interface ColumnDef {
  id: ColumnId;
  label: string;
}

/** Every column, in their natural left-to-right order. `title` leads and is frozen. */
export const COLUMNS: ColumnDef[] = [
  { id: "title", label: "Title" },
  { id: "project", label: "Project" },
  { id: "due", label: "Due" },
  { id: "estimate", label: "Estimate" },
  { id: "kind", label: "Kind" },
  { id: "do", label: "Do date" },
  { id: "defer", label: "Defer until" },
  { id: "status", label: "Status" },
  { id: "created", label: "Added" },
];

/** The four default columns (decisions line 58). */
export const DEFAULT_COLUMNS: ColumnId[] = ["title", "project", "due", "estimate"];

/** What a task may be grouped by. Structured as a list so a second grouping is
 *  the same code path, not a special case (decisions line 60 lists both). */
export type GroupKey = "project" | "kind" | "status";
export type SortField = "due" | "title" | "estimate" | "created";
export type SortDir = "asc" | "desc";
export interface Sort {
  field: SortField;
  dir: SortDir;
}

export const DEFAULT_SORT: Sort = { field: "due", dir: "asc" };
export const DEFAULT_GROUPING: GroupKey[] = ["project"];

// ---------------------------------------------------------------------------
// 1 · Grouping and sorting.
// ---------------------------------------------------------------------------

/** A node in the arranged board. Leaf nodes carry `tasks`; branches carry
 *  `groups`. `count` is the total number of tasks anywhere beneath it. */
export interface BoardGroup {
  /** Stable identity of the group value: a projectId, a kind, "none", or "all". */
  key: string;
  /** What the header prints, or null for the single ungrouped bucket. */
  label: string | null;
  tasks: BoardTask[];
  groups: BoardGroup[];
  count: number;
}

/** Compare two values that may be null; null always sorts last, whatever `dir`. */
function nullableCompare<T>(
  av: T | null,
  bv: T | null,
  inner: (a: T, b: T) => number,
  dir: SortDir
): number {
  if (av == null && bv == null) return 0;
  if (av == null) return 1;
  if (bv == null) return -1;
  const r = inner(av, bv);
  return dir === "desc" ? -r : r;
}

/** The active sort as a comparator, with title as the stable tiebreak. */
export function compareTasks(a: BoardTask, b: BoardTask, sort: Sort): number {
  const { field, dir } = sort;
  let r = 0;
  switch (field) {
    case "due":
      // Due date, then due time — both nullable and both nulls-last. A dated
      // task always precedes an undated one; "soonest due first" (decisions 58).
      r = nullableCompare(a.dueDate, b.dueDate, (x, y) => x.localeCompare(y), dir);
      if (r === 0) {
        r = nullableCompare(a.dueTime, b.dueTime, (x, y) => x.localeCompare(y), dir);
      }
      break;
    case "estimate":
      r = nullableCompare(a.estimateMinutes, b.estimateMinutes, (x, y) => x - y, dir);
      break;
    case "created":
      r = a.createdAt.localeCompare(b.createdAt);
      if (dir === "desc") r = -r;
      break;
    case "title":
      r = a.title.localeCompare(b.title);
      if (dir === "desc") r = -r;
      break;
  }
  if (r === 0) r = a.title.localeCompare(b.title);
  return r;
}

function groupValue(task: BoardTask, key: GroupKey): { key: string; label: string } {
  switch (key) {
    case "project":
      return { key: task.projectId ?? "none", label: task.projectName ?? "No project" };
    case "kind":
      return { key: task.kind, label: task.kind };
    case "status":
      return { key: task.status, label: task.status };
  }
}

/**
 * Group and sort the rows. `grouping` is applied outer-to-inner (0, 1 or 2
 * keys); within the deepest level the tasks are sorted by `sort`. Group order
 * follows the same sort — a group is ordered by its first (lead) task, so
 * "soonest due first" holds at the group level too, and a group whose earliest
 * task has no due date falls to the end just as an undated row does.
 */
export function arrangeBoard(
  tasks: BoardTask[],
  grouping: GroupKey[],
  sort: Sort
): BoardGroup[] {
  const sorted = [...tasks].sort((a, b) => compareTasks(a, b, sort));

  if (grouping.length === 0) {
    return [{ key: "all", label: null, tasks: sorted, groups: [], count: sorted.length }];
  }

  const [head, ...rest] = grouping;
  // Preserve first-seen order (already the sorted order) so group order follows
  // the sort — the first task placed into a bucket is its lead task.
  const buckets = new Map<string, { label: string; tasks: BoardTask[] }>();
  for (const task of sorted) {
    const { key, label } = groupValue(task, head);
    const bucket = buckets.get(key);
    if (bucket) bucket.tasks.push(task);
    else buckets.set(key, { label, tasks: [task] });
  }

  return [...buckets.entries()].map(([key, { label, tasks: bucketTasks }]) => {
    if (rest.length === 0) {
      return { key, label, tasks: bucketTasks, groups: [], count: bucketTasks.length };
    }
    return {
      key,
      label,
      tasks: [],
      groups: arrangeBoard(bucketTasks, rest, sort),
      count: bucketTasks.length,
    };
  });
}

/** Flatten an arranged tree back to rows in display order (for roving focus). */
export function flattenGroups(groups: BoardGroup[]): BoardTask[] {
  const out: BoardTask[] = [];
  for (const g of groups) {
    if (g.groups.length) out.push(...flattenGroups(g.groups));
    else out.push(...g.tasks);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2 · Which columns are scrolled out of view.
//
// The hidden-count control (◂ 2 · 4 ▸) is derived from geometry, NOT from a
// count of switched-off columns: a column you turned off is not on the sheet at
// all, whereas a hidden column is present but scrolled under the frozen title
// (left) or off the right edge. The client measures each scrollable column's
// box and hands the numbers here.
// ---------------------------------------------------------------------------

/** One scrollable (non-title) column's geometry, in scroll-content coordinates. */
export interface ColumnBox {
  id: ColumnId;
  /** Distance from the scroll content's left origin to the column's left edge. */
  offsetLeft: number;
  width: number;
}

export interface HiddenColumns {
  /** Columns fully hidden under the frozen title, left-to-right. */
  left: ColumnId[];
  /** Columns fully past the right edge, left-to-right. */
  right: ColumnId[];
}

/**
 * Derive which scrollable columns are out of view.
 *
 * @param boxes       the scrollable columns' geometry, in visual order
 * @param frozenWidth width of the frozen title column: content in
 *                    [scrollLeft, scrollLeft+frozenWidth] is covered by it
 * @param scrollLeft  the container's current horizontal scroll offset
 * @param viewport    the container's visible inner width (clientWidth)
 *
 * A column counts as hidden-left only when its right edge has passed entirely
 * under the title, and hidden-right only when its left edge is at or beyond the
 * viewport's right edge — a partially visible column is not counted, which is
 * what makes the number match what the eye sees.
 */
export function deriveHidden(
  boxes: ColumnBox[],
  frozenWidth: number,
  scrollLeft: number,
  viewport: number
): HiddenColumns {
  const leftEdge = scrollLeft + frozenWidth; // content x the title covers up to
  const rightEdge = scrollLeft + viewport; // content x the right edge sits at
  const left: ColumnId[] = [];
  const right: ColumnId[] = [];
  for (const box of boxes) {
    const boxRight = box.offsetLeft + box.width;
    if (boxRight <= leftEdge) left.push(box.id);
    else if (box.offsetLeft >= rightEdge) right.push(box.id);
  }
  return { left, right };
}

// ---------------------------------------------------------------------------
// 3 · Filter chips (Tab turns a search term into a chip).
//
// A chip is a plain term; multiple chips are ANDed. Grouping comes back, but
// each header reads "matched of total" — "2 of 18" (decisions line 65). Chips
// are structured as plain strings now; a field-scoped chip is a later addition.
// ---------------------------------------------------------------------------

/** True when the task matches every chip (case-insensitive, title or project). */
export function matchesChips(task: BoardTask, chips: string[]): boolean {
  if (chips.length === 0) return true;
  const hay = `${task.title} ${task.projectName ?? ""}`.toLowerCase();
  return chips.every((c) => hay.includes(c.toLowerCase().trim()));
}

/** A group header under an active filter: how many matched, of the group total. */
export interface FilterCount {
  key: string;
  label: string | null;
  matched: number;
  total: number;
}

/**
 * For each group (by the primary grouping key), the matched count and the group
 * total. Groups with no match are dropped, so the board is genuinely narrowed;
 * the surviving headers read "2 of 18".
 */
export function filterCounts(
  tasks: BoardTask[],
  groupKey: GroupKey | null,
  chips: string[]
): FilterCount[] {
  if (groupKey == null) {
    const total = tasks.length;
    const matched = tasks.filter((t) => matchesChips(t, chips)).length;
    return matched > 0 ? [{ key: "all", label: null, matched, total }] : [];
  }
  const counts = new Map<string, FilterCount>();
  for (const task of tasks) {
    const { key, label } = groupValue(task, groupKey);
    const row = counts.get(key) ?? { key, label, matched: 0, total: 0 };
    row.total += 1;
    if (matchesChips(task, chips)) row.matched += 1;
    counts.set(key, row);
  }
  return [...counts.values()].filter((c) => c.matched > 0);
}

// ---------------------------------------------------------------------------
// 4 · Search over everything, grouped by kind.
//
// Search covers active tasks, completed work, notes and projects today; saved
// views and settings do not exist as data yet. The kinds are a list so those
// two are additions here, not a rewrite (decisions line 64).
// ---------------------------------------------------------------------------

export type SearchKind = "task" | "completed" | "note" | "project";

/** One search hit. `taskId` is set where the row can open a task. */
export interface SearchItem {
  id: string;
  kind: SearchKind;
  primary: string;
  secondary?: string;
  taskId?: string;
}

export interface SearchGroup {
  kind: SearchKind;
  label: string;
  items: SearchItem[];
}

/** The everything the board can search. Missing kinds (saved views, settings)
 *  slot in beside these without touching the ranking below. */
export interface SearchSources {
  activeTasks: BoardTask[];
  completedTasks: BoardTask[];
  notes: { id: string; body: string; taskId: string | null }[];
  projects: { id: string; name: string }[];
}

/** The kinds, in the order they are shown. Add a kind here and nowhere else. */
const SEARCH_KIND_ORDER: { kind: SearchKind; label: string }[] = [
  { kind: "task", label: "Tasks" },
  { kind: "completed", label: "Completed" },
  { kind: "note", label: "Notes" },
  { kind: "project", label: "Projects" },
];

/** Match position of `q` in `text`, or -1. Earlier match ranks higher. */
function matchIndex(text: string, q: string): number {
  return text.toLowerCase().indexOf(q);
}

function rank(items: (SearchItem & { _idx: number })[]): SearchItem[] {
  return items
    .sort((a, b) => a._idx - b._idx || a.primary.localeCompare(b.primary))
    .map(({ _idx, ...rest }) => {
      void _idx;
      return rest;
    });
}

/**
 * Flatten the board into ranked results grouped by kind. Returns [] for an
 * empty query. Only kinds with at least one hit appear. Within a kind, an
 * earlier substring match ranks first, ties broken alphabetically — a plain,
 * defensible order until the real ranking function lands (WP17).
 */
export function searchEverything(query: string, sources: SearchSources): SearchGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const byKind: Record<SearchKind, (SearchItem & { _idx: number })[]> = {
    task: [],
    completed: [],
    note: [],
    project: [],
  };

  const pushTask = (t: BoardTask, kind: "task" | "completed") => {
    const idx = matchIndex(t.title, q);
    if (idx >= 0)
      byKind[kind].push({
        id: t.id,
        kind,
        primary: t.title,
        secondary: t.projectName ?? undefined,
        taskId: t.id,
        _idx: idx,
      });
  };
  for (const t of sources.activeTasks) pushTask(t, "task");
  for (const t of sources.completedTasks) pushTask(t, "completed");
  for (const n of sources.notes) {
    const idx = matchIndex(n.body, q);
    if (idx >= 0)
      byKind.note.push({
        id: n.id,
        kind: "note",
        primary: n.body,
        taskId: n.taskId ?? undefined,
        _idx: idx,
      });
  }
  for (const p of sources.projects) {
    const idx = matchIndex(p.name, q);
    if (idx >= 0)
      byKind.project.push({ id: p.id, kind: "project", primary: p.name, _idx: idx });
  }

  return SEARCH_KIND_ORDER.flatMap(({ kind, label }) => {
    const items = rank(byKind[kind]);
    return items.length ? [{ kind, label, items }] : [];
  });
}

// ---------------------------------------------------------------------------
// 5 · The view snapshot for Escape.
//
// Searching takes over the screen; Escape returns you EXACTLY where you were
// (decisions line 63). "Exactly" means grouping, columns, sort, scroll position
// and selection — captured before search takes over, restored on the way out.
// Kept as a plain serialisable shape so the capture/restore is testable and the
// component just stores and re-applies it.
// ---------------------------------------------------------------------------

export interface ViewSnapshot {
  grouping: GroupKey[];
  columns: ColumnId[];
  sort: Sort;
  scrollLeft: number;
  scrollTop: number;
  selection: string[];
}

/** The board fields Escape restores. Same shape as the snapshot by design: if a
 *  field is added here it must be captured too, and the round-trip test breaks
 *  the moment capture forgets one. */
export type RestorableView = ViewSnapshot;

/** Copy the restorable fields into a snapshot, deeply, so later edits to the
 *  live view cannot mutate what was captured before search took over. */
export function captureSnapshot(v: RestorableView): ViewSnapshot {
  return {
    grouping: [...v.grouping],
    columns: [...v.columns],
    sort: { ...v.sort },
    scrollLeft: v.scrollLeft,
    scrollTop: v.scrollTop,
    selection: [...v.selection],
  };
}

/** Read a snapshot back out into the fields to restore, deeply, so applying it
 *  hands the caller its own arrays to own. */
export function applySnapshot(s: ViewSnapshot): RestorableView {
  return captureSnapshot(s);
}
