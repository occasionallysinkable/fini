"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useActionState,
  startTransition,
} from "react";
import {
  COLUMNS,
  DEFAULT_COLUMNS,
  DEFAULT_GROUPING,
  DEFAULT_SORT,
  arrangeBoard,
  flattenGroups,
  deriveHidden,
  filterCounts,
  matchesChips,
  searchEverything,
  captureSnapshot,
  applySnapshot,
  type BoardGroup,
  type BoardTask,
  type ColumnId,
  type GroupKey,
  type Sort,
  type SortField,
  type ViewSnapshot,
} from "@/lib/board";
import type { BoardData, SavedViewRow, StaleData } from "@/lib/queries";
import { staleView } from "@/lib/stale";
import {
  bulkAction,
  quickAddTask,
  createSavedView,
  editTaskField,
  setStaleTreatment,
  type BulkResult,
} from "./actions";
import { undoActivity } from "../actions";

/*
  WP4 · the interactive board. All the state a spreadsheet-like sheet needs lives
  here: which columns show, how rows are grouped and sorted, what is selected,
  and whether search has taken over. The rows themselves come from props and are
  never copied into state, so a server revalidation after any write flows
  straight back in.

  Keyboard (invariant 9 — every action has a key). Why each one:
    /            enter search from anywhere (R19: search is the slash key).
    Esc          leave search and restore the exact prior view; otherwise close
                 the open popover/panel, else clear the selection.
    Tab          while searching, turn the typed term into a filter chip.
    ↑ / ↓        move the row focus (a sheet is navigated by row).
    x  or  Space toggle selection of the focused row (x is the quick reach; Space
                 is the natural "tick this" and mirrors a checkbox).
    1 – 5        run the numbered action on the bar (screens that ask number 1–n).
    c            open / close the config panel (its one initial).
    u            undo the last board action (the ledger's key, matching R4).
*/

// The action bar's options, numbered 1..n in this order. Kill sits last because
// it is the one that removes rows; the rest reshape them. "keep" is not on the
// bar — it is a stale-block action (WP5) — but it rides the same bulkAction path
// so the block's writes undo like the bar's.
type BulkKey = "kind" | "project" | "estimate" | "push" | "kill";
type StaleKey = "keep" | "push" | "kill";
const ACTION_ORDER: BulkKey[] = ["kind", "project", "estimate", "push", "kill"];

const KIND_OPTIONS = ["commitment", "own", "habit", "unassigned"];

function fmtMinutes(m: number): string {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h && mm) return `${h}h ${mm}m`;
  if (h) return `${h}h`;
  return `${mm}m`;
}

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

export function Board({
  data,
  stale,
  activity,
}: {
  data: BoardData;
  stale: StaleData;
  activity: { id: string; actor: string; summary: string; undoable: boolean }[];
}) {
  // ---- view state -------------------------------------------------------
  const [grouping, setGrouping] = useState<GroupKey[]>(DEFAULT_GROUPING);
  const [columns, setColumns] = useState<ColumnId[]>(DEFAULT_COLUMNS);
  const [sort, setSort] = useState<Sort>(DEFAULT_SORT);
  const [wrap, setWrap] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  // "Go through all" (a sweep) expands the stale block from three rows to every
  // stale row. Reset whenever the server hands back a fresh stale set.
  const [staleExpanded, setStaleExpanded] = useState(false);

  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [focusIdx, setFocusIdx] = useState(-1);

  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [chips, setChips] = useState<string[]>([]);
  const [appliedView, setAppliedView] = useState<string | null>(null);

  const [hidden, setHidden] = useState<{ left: ColumnId[]; right: ColumnId[] }>({
    left: [],
    right: [],
  });
  const [hiddenListOpen, setHiddenListOpen] = useState(false);
  const [editingCell, setEditingCell] = useState<{ id: string; field: string } | null>(null);

  const [bulkState, runBulk] = useActionState<BulkResult, FormData>(bulkAction, {});

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const headerRefs = useRef<Map<ColumnId, HTMLElement>>(new Map());
  const searchRef = useRef<HTMLInputElement | null>(null);
  const snapshotRef = useRef<ViewSnapshot | null>(null);
  const restoreScrollRef = useRef<{ left: number; top: number } | null>(null);
  const undoFormRef = useRef<HTMLFormElement | null>(null);

  const today = useMemo(() => todayLocal(), []);
  // The stale ids, as a set, for the "marked in place" treatment (a state word
  // in the row) and to know which rows the block covers.
  const staleSet = useMemo(() => new Set(stale.staleIds), [stale.staleIds]);
  const markStaleInPlace = stale.treatment === "inPlace";
  // Collapse the "go through all" expansion whenever the stale set changes (a
  // keep/push/kill revalidated the board), so it never re-opens stale.
  useEffect(() => {
    setStaleExpanded(false);
  }, [stale.staleIds]);

  // ---- derived view -----------------------------------------------------
  const visibleColumns = useMemo(
    () => COLUMNS.filter((c) => c.id === "title" || columns.includes(c.id)),
    [columns]
  );
  const nonTitle = useMemo(() => visibleColumns.filter((c) => c.id !== "title"), [visibleColumns]);
  const gridTemplateColumns = useMemo(
    () => ["minmax(220px,1.4fr)", ...nonTitle.map(() => "160px")].join(" "),
    [nonTitle]
  );

  const filteredActive = useMemo(
    () => (chips.length ? data.active.filter((t) => matchesChips(t, chips)) : data.active),
    [data.active, chips]
  );
  const groups = useMemo(
    () => arrangeBoard(filteredActive, grouping, sort),
    [filteredActive, grouping, sort]
  );
  const flatIds = useMemo(() => flattenGroups(groups).map((t) => t.id), [groups]);
  const dataById = useMemo(() => new Map(data.active.map((t) => [t.id, t])), [data.active]);

  // Header counts under an active filter: "matched of total" (decisions 65).
  const counts = useMemo(() => {
    if (!chips.length) return null;
    const map = new Map<string, { matched: number; total: number }>();
    for (const c of filterCounts(data.active, grouping[0] ?? null, chips)) {
      map.set(c.key, { matched: c.matched, total: c.total });
    }
    return map;
  }, [data.active, grouping, chips]);

  const searchGroups = useMemo(
    () =>
      searchEverything(query, {
        activeTasks: data.active,
        completedTasks: data.completed,
        notes: data.notes,
        projects: data.projects,
      }),
    [query, data]
  );

  // Prune any selected ids that no longer exist (deleted by a bulk action).
  useEffect(() => {
    const live = new Set(data.active.map((t) => t.id));
    setSelection((sel) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of sel) {
        if (live.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : sel;
    });
  }, [data.active]);

  // ---- measuring which columns are scrolled out of view -----------------
  const measure = useCallback(() => {
    const c = scrollRef.current;
    if (!c) return;
    const titleEl = headerRefs.current.get("title");
    const frozenWidth = titleEl?.getBoundingClientRect().width ?? 0;
    const cRect = c.getBoundingClientRect();
    const boxes = nonTitle
      .map((col) => {
        const el = headerRefs.current.get(col.id);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { id: col.id, offsetLeft: r.left - cRect.left + c.scrollLeft, width: r.width };
      })
      .filter((b): b is NonNullable<typeof b> => b !== null);
    setHidden(deriveHidden(boxes, frozenWidth, c.scrollLeft, c.clientWidth));
  }, [nonTitle]);

  useLayoutEffect(() => {
    measure();
  }, [measure, visibleColumns, groups, searching]);

  useEffect(() => {
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  // Restore the exact scroll position when leaving search (decisions 63), then
  // re-derive the hidden-column counts for that position — the sheet re-mounted
  // scrolled to 0, so without this the ◂ N · M ▸ count would lag the scroll.
  useLayoutEffect(() => {
    if (!searching && restoreScrollRef.current && scrollRef.current) {
      scrollRef.current.scrollLeft = restoreScrollRef.current.left;
      scrollRef.current.scrollTop = restoreScrollRef.current.top;
      restoreScrollRef.current = null;
      measure();
    }
  }, [searching, measure]);

  // ---- search enter / exit ---------------------------------------------
  const enterSearch = useCallback(() => {
    const c = scrollRef.current;
    snapshotRef.current = captureSnapshot({
      grouping,
      columns,
      sort,
      scrollLeft: c?.scrollLeft ?? 0,
      scrollTop: c?.scrollTop ?? 0,
      selection: [...selection],
    });
    setSearching(true);
    requestAnimationFrame(() => searchRef.current?.focus());
  }, [grouping, columns, sort, selection]);

  const exitSearchRestore = useCallback(() => {
    const s = snapshotRef.current;
    setSearching(false);
    setQuery("");
    searchRef.current?.blur();
    if (s) {
      const v = applySnapshot(s);
      setGrouping(v.grouping);
      setColumns(v.columns);
      setSort(v.sort);
      setSelection(new Set(v.selection));
      restoreScrollRef.current = { left: v.scrollLeft, top: v.scrollTop };
    }
  }, []);

  const convertToChip = useCallback(() => {
    const term = query.trim();
    if (!term) return;
    setChips((cs) => (cs.includes(term) ? cs : [...cs, term]));
    setAppliedView(null);
    setSearching(false);
    setQuery("");
    searchRef.current?.blur();
  }, [query]);

  // ---- selection & bulk -------------------------------------------------
  const toggleSelect = useCallback((id: string) => {
    setSelection((sel) => {
      const next = new Set(sel);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const doBulk = useCallback(
    (action: BulkKey, value?: string) => {
      if (selection.size === 0) return;
      const fd = new FormData();
      fd.set("ids", JSON.stringify([...selection]));
      fd.set("action", action);
      if (value != null) fd.set("value", value);
      // The useActionState dispatch must run inside a transition (React 19).
      startTransition(() => runBulk(fd));
      setSelection(new Set());
    },
    [selection, runBulk]
  );

  // Stale-block actions ride the same bulkAction path as the selection bar, so
  // their result and undo land on the same ledger line (invariant 8, R4) and the
  // push count stays one number. keep/push/kill take the ids they act on: one
  // task for a row's buttons, every stale id for a sweep.
  const staleDispatch = useCallback(
    (action: StaleKey, ids: string[]) => {
      if (ids.length === 0) return;
      const fd = new FormData();
      fd.set("ids", JSON.stringify(ids));
      fd.set("action", action);
      startTransition(() => runBulk(fd));
    },
    [runBulk]
  );

  // Values the valued actions carry when triggered by their number key.
  const [kindValue, setKindValue] = useState("commitment");
  const [projectValue, setProjectValue] = useState("");
  const [estimateValue, setEstimateValue] = useState("30");

  const triggerAction = useCallback(
    (action: BulkKey) => {
      if (action === "kind") doBulk("kind", kindValue);
      else if (action === "project") doBulk("project", projectValue);
      else if (action === "estimate") doBulk("estimate", estimateValue);
      else doBulk(action);
    },
    [doBulk, kindValue, projectValue, estimateValue]
  );

  const scrollColumnIntoView = useCallback((colId: ColumnId) => {
    const c = scrollRef.current;
    const el = headerRefs.current.get(colId);
    const titleEl = headerRefs.current.get("title");
    if (!c || !el) return;
    const cRect = c.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const offsetLeft = r.left - cRect.left + c.scrollLeft;
    const frozen = titleEl?.getBoundingClientRect().width ?? 0;
    // Land it just clear of the frozen title.
    c.scrollLeft = offsetLeft - frozen - 8;
    setHiddenListOpen(false);
  }, []);

  // ---- keyboard ---------------------------------------------------------
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      const typing =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement;

      if (e.key === "/" && !typing && !searching) {
        e.preventDefault();
        enterSearch();
        return;
      }
      if (searching) {
        if (e.key === "Escape") {
          e.preventDefault();
          exitSearchRestore();
        } else if (e.key === "Tab" && query.trim()) {
          e.preventDefault();
          convertToChip();
        }
        return;
      }
      if (typing) return;

      if (e.key === "Escape") {
        if (hiddenListOpen) setHiddenListOpen(false);
        else if (panelOpen) setPanelOpen(false);
        else if (selection.size) setSelection(new Set());
        return;
      }
      if (e.key === "c") {
        setPanelOpen((o) => !o);
        return;
      }
      if (e.key === "u") {
        undoFormRef.current?.requestSubmit();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusIdx((i) => Math.min(flatIds.length - 1, (i < 0 ? -1 : i) + 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusIdx((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === "x" || e.key === " ") {
        if (focusIdx >= 0 && flatIds[focusIdx]) {
          e.preventDefault();
          toggleSelect(flatIds[focusIdx]);
        }
        return;
      }
      if (selection.size && /^[1-5]$/.test(e.key)) {
        const act = ACTION_ORDER[Number(e.key) - 1];
        if (act) {
          e.preventDefault();
          triggerAction(act);
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [
    searching,
    query,
    panelOpen,
    hiddenListOpen,
    selection,
    focusIdx,
    flatIds,
    enterSearch,
    exitSearchRestore,
    convertToChip,
    toggleSelect,
    triggerAction,
  ]);

  // ---- view helpers -----------------------------------------------------
  function toggleColumn(id: ColumnId) {
    if (id === "title") return; // the title column cannot be switched off.
    setColumns((cols) =>
      cols.includes(id) ? cols.filter((c) => c !== id) : [...cols, id]
    );
    setAppliedView(null);
  }

  function clickSortHeader(field: SortField) {
    setSort((s) => (s.field === field ? { field, dir: s.dir === "asc" ? "desc" : "asc" } : { field, dir: "asc" }));
    setAppliedView(null);
  }

  function applyView(v: SavedViewRow) {
    setGrouping(v.grouping.length ? v.grouping : []);
    setColumns(v.columns.length ? v.columns : DEFAULT_COLUMNS);
    setSort(v.sort);
    setChips(v.filter);
    setAppliedView(v.id);
    setSearching(false);
  }

  const sortableOf: Partial<Record<ColumnId, SortField>> = {
    title: "title",
    due: "due",
    estimate: "estimate",
    created: "created",
  };

  function cellValue(task: BoardTask, colId: ColumnId): string {
    switch (colId) {
      case "project":
        return task.projectName ?? "—";
      case "due":
        return task.dueDate ? `${task.dueDate}${task.dueTime ? ` ${task.dueTime}` : ""}` : "—";
      case "estimate":
        return task.estimateMinutes != null ? fmtMinutes(task.estimateMinutes) : "—";
      case "kind":
        return task.kind;
      case "do":
        return task.doDate ?? "—";
      case "defer":
        return task.deferUntil ?? "—";
      case "status":
        return task.status;
      case "created":
        return task.createdAt.slice(0, 10);
      default:
        return "";
    }
  }

  // State reads as words, never colour alone (invariant 7). Under the "marked in
  // place" stale treatment, a stale task carries the word here instead of the
  // block interrupting at the top (decisions line 87).
  function stateWords(task: BoardTask): string[] {
    const w: string[] = [];
    if (task.recurring) w.push("recurring");
    if (task.kind === "unassigned") w.push("kind not set");
    if (task.deferUntil && task.deferUntil > today) w.push("deferred");
    if (markStaleInPlace && staleSet.has(task.id)) w.push("stale");
    return w;
  }

  const perGroupAdd = grouping.length === 1 && grouping[0] === "project";
  const projectOptions = data.projects;

  // How each column edits in place, or null for the read-only ones. do_date is
  // read-only here: its owners are the calendar, queue and not-today branch
  // (invariant 6), not the board. `created` is automatic.
  type EditKind = "text" | "number" | "date" | "select";
  interface EditSpec {
    field: string;
    editKind: EditKind;
    options?: { value: string; label: string }[];
    raw: (t: BoardTask) => string;
  }
  function editableFor(colId: ColumnId): EditSpec | null {
    switch (colId) {
      case "project":
        return {
          field: "project",
          editKind: "select",
          options: [{ value: "", label: "No project" }, ...projectOptions.map((p) => ({ value: p.id, label: p.name }))],
          raw: (t) => t.projectId ?? "",
        };
      case "due":
        return { field: "dueDate", editKind: "date", raw: (t) => t.dueDate ?? "" };
      case "estimate":
        return { field: "estimate", editKind: "number", raw: (t) => (t.estimateMinutes != null ? String(t.estimateMinutes) : "") };
      case "kind":
        return { field: "kind", editKind: "select", options: KIND_OPTIONS.map((k) => ({ value: k, label: k })), raw: (t) => t.kind };
      case "status":
        return {
          field: "status",
          editKind: "select",
          options: ["active", "done", "cancelled", "someday"].map((s) => ({ value: s, label: s })),
          raw: (t) => t.status,
        };
      case "defer":
        return { field: "deferUntil", editKind: "date", raw: (t) => t.deferUntil ?? "" };
      default:
        return null; // title handled separately; do / created are read-only.
    }
  }

  // One editable cell: click to edit in place (decisions 75). Commits through
  // editTaskField (mutate → undoable); Escape cancels. A plain <form action=…>
  // so the write runs in a transition and the sheet refreshes from new props.
  function EditableCell({
    taskId,
    spec,
    editing,
    onOpen,
    onClose,
    children,
  }: {
    taskId: string;
    spec: EditSpec;
    editing: boolean;
    onOpen: () => void;
    onClose: () => void;
    children: React.ReactNode;
  }) {
    const formRef = useRef<HTMLFormElement | null>(null);
    if (!editing) {
      return (
        <button
          type="button"
          onClick={onOpen}
          className={`w-full text-left hover:text-accent ${wrap ? "" : "truncate"}`}
        >
          {children}
        </button>
      );
    }
    const rawValue = spec.raw(dataById.get(taskId) ?? ({} as BoardTask));
    return (
      <form ref={formRef} action={editTaskField} onSubmit={onClose} className="w-full">
        <input type="hidden" name="taskId" value={taskId} />
        <input type="hidden" name="field" value={spec.field} />
        {spec.editKind === "select" ? (
          <select
            name="value"
            defaultValue={rawValue}
            autoFocus
            onChange={() => formRef.current?.requestSubmit()}
            onBlur={onClose}
            className="w-full rounded border border-accent bg-surface px-1 py-0.5 text-sm"
          >
            {spec.options!.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            name="value"
            type={spec.editKind === "number" ? "number" : spec.editKind === "date" ? "date" : "text"}
            defaultValue={rawValue}
            autoFocus
            onBlur={() => formRef.current?.requestSubmit()}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                onClose();
              }
            }}
            className="w-full rounded border border-accent bg-surface px-1 py-0.5 text-sm"
          />
        )}
      </form>
    );
  }

  // ---- render: one task's cells ----------------------------------------
  function renderRow(task: BoardTask) {
    const selected = selection.has(task.id);
    const focused = focusIdx >= 0 && flatIds[focusIdx] === task.id;
    const words = stateWords(task);
    const titleSpec: EditSpec = { field: "title", editKind: "text", raw: (t) => t.title };
    return (
      <div key={task.id} className="contents">
        <div
          className={`sticky left-0 z-[1] flex items-start gap-2 border-b border-line bg-bg px-3 py-2 shadow-[6px_0_6px_-6px_rgba(0,0,0,0.6)] ${
            focused ? "outline outline-1 outline-accent" : ""
          }`}
        >
          <input
            type="checkbox"
            checked={selected}
            onChange={() => toggleSelect(task.id)}
            aria-label={`select ${task.title}`}
            className="mt-1"
          />
          <span className="min-w-0 flex-1">
            <EditableCell
              taskId={task.id}
              spec={titleSpec}
              editing={editingCell?.id === task.id && editingCell.field === "title"}
              onOpen={() => setEditingCell({ id: task.id, field: "title" })}
              onClose={() => setEditingCell(null)}
            >
              {task.title}
              {words.length > 0 && <span className="text-muted"> · {words.join(" · ")}</span>}
            </EditableCell>
          </span>
        </div>
        {nonTitle.map((col) => {
          const spec = editableFor(col.id);
          return (
            <div key={col.id} className="border-b border-line px-3 py-2 text-sm text-muted">
              {spec ? (
                <EditableCell
                  taskId={task.id}
                  spec={spec}
                  editing={editingCell?.id === task.id && editingCell.field === col.id}
                  onOpen={() => setEditingCell({ id: task.id, field: col.id })}
                  onClose={() => setEditingCell(null)}
                >
                  {cellValue(task, col.id)}
                </EditableCell>
              ) : (
                <span className="truncate">{cellValue(task, col.id)}</span>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  function AddRow({ projectId }: { projectId: string }) {
    return (
      <form action={quickAddTask} className="contents">
        <div className="sticky left-0 z-[1] border-b border-line bg-bg px-3 py-1.5 shadow-[6px_0_6px_-6px_rgba(0,0,0,0.6)]">
          <input type="hidden" name="projectId" value={projectId} />
          <input
            name="title"
            placeholder="add a task…"
            autoComplete="off"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted focus:text-accent"
          />
        </div>
        {nonTitle.map((col) => (
          <div key={col.id} className="border-b border-line px-3 py-1.5" />
        ))}
      </form>
    );
  }

  function renderGroups(list: BoardGroup[], depth = 0): React.ReactNode {
    return list.map((g) => {
      const count = counts?.get(g.key);
      const header =
        g.label == null ? null : (
          <div
            key={`h-${g.key}`}
            style={{ gridColumn: "1 / -1" }}
            className="border-b border-line bg-surface/60"
          >
            <span
              className="sticky left-0 inline-block px-3 py-1.5 text-sm font-medium"
              style={{ paddingLeft: 12 + depth * 16 }}
            >
              {g.label}{" "}
              <span className="text-muted">
                · {count ? `${count.matched} of ${count.total}` : g.count}
              </span>
            </span>
          </div>
        );
      return (
        <div key={g.key} className="contents">
          {header}
          {g.groups.length > 0
            ? renderGroups(g.groups, depth + 1)
            : g.tasks.map((t) => renderRow(t))}
          {perGroupAdd && depth === 0 && (
            <AddRow projectId={g.key === "none" ? "" : g.key} />
          )}
        </div>
      );
    });
  }

  // ---- the stale block (WP5) --------------------------------------------
  // A block at the top of the board, ruled in magenta, demanding a decision
  // (decisions line 87). It is NOT a column and takes no part in grouping or
  // sort — it is rendered here, outside the sheet grid, from the server's
  // derived stale set, so it survives every column configuration including
  // title-only (decisions line 95). Absent entirely when nothing is stale, with
  // nothing in its place (decisions line 94).
  function renderStaleBlock() {
    if (stale.treatment !== "block" || stale.rows.length === 0) return null;
    const { shown, remainderCount, remainderOldestAgeDays } = staleView(stale.rows, staleExpanded);
    return (
      <section className="mt-3 rounded border border-line border-l-4 border-l-deadline bg-surface/40 p-4">
        <div className="text-sm">
          <span className="font-medium text-deadline">Stale</span>{" "}
          <span className="text-muted">
            — nobody has touched {stale.totalCount === 1 ? "this" : "these"} in 14 days
          </span>
        </div>

        <ul className="mt-3 flex flex-col divide-y divide-line">
          {shown.map((r) => {
            const meta = [r.keptLabel, `${r.ageDays}d`].filter(Boolean).join(" · ");
            return (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0">
                  <span className={wrap ? "" : "block truncate"}>
                    {r.title}
                    {r.projectName && <span className="text-muted"> · {r.projectName}</span>}
                  </span>
                  <span className="text-xs text-muted">{meta}</span>
                </span>
                {/* Three actions each, and no more (decisions line 89). Each runs
                    through mutate() and undoes (invariant 2). */}
                <span className="flex shrink-0 items-center gap-3 text-sm">
                  <button
                    onClick={() => staleDispatch("keep", [r.id])}
                    className="text-accent hover:underline"
                  >
                    keep
                  </button>
                  <button
                    onClick={() => staleDispatch("push", [r.id])}
                    className="text-accent hover:underline"
                  >
                    push
                  </button>
                  <button
                    onClick={() => staleDispatch("kill", [r.id])}
                    className="text-accent hover:underline"
                  >
                    kill
                  </button>
                </span>
              </li>
            );
          })}
        </ul>

        {/* Whatever is not shown is counted, and the oldest of it is named
            (decisions line 88). */}
        {remainderCount > 0 && (
          <div className="mt-2 text-xs text-muted">
            {remainderCount} more · oldest {remainderOldestAgeDays}d
          </div>
        )}

        {/* Sweeps appear past a handful (decisions line 93, SWEEP_THRESHOLD).
            "Go through all" expands to every stale row; "kill all" ends the pile
            in one reversible write. */}
        {stale.showSweeps && (
          <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
            {staleExpanded ? (
              <button
                onClick={() => setStaleExpanded(false)}
                className="text-muted hover:text-text"
              >
                show three
              </button>
            ) : (
              <button
                onClick={() => setStaleExpanded(true)}
                className="text-accent hover:underline"
              >
                go through all {stale.totalCount}
              </button>
            )}
            <button
              onClick={() => staleDispatch("kill", stale.staleIds)}
              className="text-accent hover:underline"
            >
              kill all {stale.totalCount}
            </button>
          </div>
        )}
      </section>
    );
  }

  const totalHidden = hidden.left.length + hidden.right.length;
  const anyActive = data.active.length > 0;
  const displayedCount = filteredActive.length;

  return (
    <div className="mt-4">
      {/* Saved views — plain words above the sheet, the current one underlined
          (decisions 66). Created only from a filtered state, below. */}
      {(data.savedViews.length > 0 || chips.length > 0) && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <button
            onClick={() => {
              setGrouping(DEFAULT_GROUPING);
              setColumns(DEFAULT_COLUMNS);
              setSort(DEFAULT_SORT);
              setChips([]);
              setAppliedView(null);
            }}
            className={appliedView === null && chips.length === 0 ? "underline" : "text-muted hover:text-text"}
          >
            all tasks
          </button>
          {data.savedViews.map((v) => (
            <button
              key={v.id}
              onClick={() => applyView(v)}
              className={appliedView === v.id ? "underline" : "text-muted hover:text-text"}
            >
              {v.name}
            </button>
          ))}
        </div>
      )}

      {/* The search bar over the sheet. Focusing it (or pressing /) takes over. */}
      <div className="mt-3 flex items-center gap-3">
        <input
          ref={searchRef}
          value={query}
          onChange={(e) => {
            // Typing enters the takeover if a click did not already (e.g. the
            // box kept focus after a previous Escape).
            if (!searching) enterSearch();
            setQuery(e.target.value);
          }}
          onFocus={() => {
            if (!searching) enterSearch();
          }}
          placeholder="Search everything… ( / )"
          autoComplete="off"
          className="flex-1 rounded border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <button
          onClick={() => setPanelOpen((o) => !o)}
          className="rounded border border-line px-3 py-2 text-sm text-muted hover:border-accent hover:text-text"
        >
          configure · c
        </button>
      </div>

      {/* Filter chips + save-view control (the only route to a saved view). */}
      {chips.length > 0 && !searching && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          {chips.map((c) => (
            <span key={c} className="flex items-center gap-1 rounded border border-line bg-surface px-2 py-0.5">
              {c}
              <button
                onClick={() => setChips((cs) => cs.filter((x) => x !== c))}
                className="text-muted hover:text-text"
                aria-label={`remove filter ${c}`}
              >
                ×
              </button>
            </span>
          ))}
          <form
            action={createSavedView}
            className="flex items-center gap-1"
            onSubmit={() => setAppliedView(null)}
          >
            <input
              type="hidden"
              name="config"
              value={JSON.stringify({ columns, grouping, sort, filter: chips })}
            />
            <input
              name="name"
              placeholder="save this view as…"
              autoComplete="off"
              className="w-40 border-b border-line bg-transparent text-sm outline-none focus:text-accent"
            />
            <button className="text-accent hover:underline">save</button>
          </form>
        </div>
      )}

      {/* The config panel — every board setting in one place (decisions 60).
          The stale treatment belongs here too, but the stale block is WP5. */}
      {panelOpen && (
        <div className="mt-3 rounded border border-line bg-surface/50 p-4 text-sm">
          <div className="flex flex-wrap gap-6">
            <div>
              <div className="mb-1 text-muted">Columns</div>
              {COLUMNS.map((c) => (
                <label key={c.id} className="mr-3 inline-flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={c.id === "title" || columns.includes(c.id)}
                    disabled={c.id === "title"}
                    onChange={() => toggleColumn(c.id)}
                  />
                  {c.label}
                </label>
              ))}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-6">
            <label className="flex items-center gap-2">
              <span className="text-muted">Group by</span>
              <select
                value={grouping[0] ?? "none"}
                onChange={(e) => {
                  const v = e.target.value;
                  setGrouping(v === "none" ? [] : [v as GroupKey, ...grouping.slice(1)]);
                  setAppliedView(null);
                }}
                className="rounded border border-line bg-surface px-2 py-1"
              >
                <option value="none">nothing</option>
                <option value="project">project</option>
                <option value="kind">kind</option>
                <option value="status">status</option>
              </select>
            </label>
            <label className="flex items-center gap-2">
              <span className="text-muted">then by</span>
              <select
                value={grouping[1] ?? "none"}
                disabled={grouping.length === 0}
                onChange={(e) => {
                  const v = e.target.value;
                  setGrouping((g) => (v === "none" ? g.slice(0, 1) : [g[0], v as GroupKey]));
                  setAppliedView(null);
                }}
                className="rounded border border-line bg-surface px-2 py-1"
              >
                <option value="none">nothing</option>
                <option value="project">project</option>
                <option value="kind">kind</option>
                <option value="status">status</option>
              </select>
            </label>
            <label className="flex items-center gap-2">
              <span className="text-muted">Sort</span>
              <select
                value={sort.field}
                onChange={(e) => setSort((s) => ({ ...s, field: e.target.value as SortField }))}
                className="rounded border border-line bg-surface px-2 py-1"
              >
                <option value="due">due</option>
                <option value="title">title</option>
                <option value="estimate">estimate</option>
                <option value="created">added</option>
              </select>
              <button
                onClick={() => setSort((s) => ({ ...s, dir: s.dir === "asc" ? "desc" : "asc" }))}
                className="rounded border border-line px-2 py-1 text-muted hover:text-text"
              >
                {sort.dir === "asc" ? "ascending" : "descending"}
              </button>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={wrap} onChange={() => setWrap((w) => !w)} />
              <span className="text-muted">wrap long titles</span>
            </label>
            {/* The stale treatment — its home is here, never Settings (decisions
                line 60). One control, three positions: the block at the top, the
                quieter marked-in-place, or off (decisions lines 87, 96). It
                persists through mutate() and undoes. */}
            <label className="flex items-center gap-2">
              <span className="text-muted">Stale work</span>
              <form action={setStaleTreatment}>
                <select
                  name="value"
                  defaultValue={stale.treatment}
                  onChange={(e) => e.currentTarget.form?.requestSubmit()}
                  className="rounded border border-line bg-surface px-2 py-1"
                >
                  <option value="block">a block at the top</option>
                  <option value="inPlace">marked in place</option>
                  <option value="off">off</option>
                </select>
              </form>
            </label>
          </div>
        </div>
      )}

      {/* Action bar — only while something is selected (decisions 76). Numbered
          1–n; each runs through mutate() and undoes. */}
      {selection.size > 0 && !searching && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded border border-accent/50 bg-surface px-3 py-2 text-sm">
          <span className="text-muted">{selection.size} selected</span>
          <span className="flex items-center gap-1">
            <button onClick={() => triggerAction("kind")} className="text-accent hover:underline">
              1 · set kind
            </button>
            <select
              value={kindValue}
              onChange={(e) => setKindValue(e.target.value)}
              className="rounded border border-line bg-surface px-1 py-0.5"
            >
              {KIND_OPTIONS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </span>
          <span className="flex items-center gap-1">
            <button onClick={() => triggerAction("project")} className="text-accent hover:underline">
              2 · move to
            </button>
            <select
              value={projectValue}
              onChange={(e) => setProjectValue(e.target.value)}
              className="rounded border border-line bg-surface px-1 py-0.5"
            >
              <option value="">No project</option>
              {projectOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </span>
          <span className="flex items-center gap-1">
            <button onClick={() => triggerAction("estimate")} className="text-accent hover:underline">
              3 · estimate
            </button>
            <input
              value={estimateValue}
              onChange={(e) => setEstimateValue(e.target.value)}
              className="w-14 rounded border border-line bg-surface px-1 py-0.5"
            />
            <span className="text-muted">min</span>
          </span>
          <button onClick={() => triggerAction("push")} className="text-accent hover:underline">
            4 · push
          </button>
          <button onClick={() => triggerAction("kill")} className="text-accent hover:underline">
            5 · kill
          </button>
          <button
            onClick={() => setSelection(new Set())}
            className="ml-auto text-muted hover:text-text"
          >
            clear
          </button>
        </div>
      )}

      {/* The result of the last board action, printed where it happened
          (invariant 8), with its undo (R4). `u` submits this form. */}
      {(bulkState.summary || bulkState.error) && !searching && (
        <div className="mt-2 text-sm">
          {bulkState.error ? (
            <span className="text-deadline">{bulkState.error}</span>
          ) : (
            <span className="text-muted">
              {bulkState.summary}
              {bulkState.activityId && (
                <>
                  {" · "}
                  <form ref={undoFormRef} action={undoActivity} className="inline">
                    <input type="hidden" name="id" value={bulkState.activityId} />
                    <button className="text-accent hover:underline">undo · u</button>
                  </form>
                </>
              )}
            </span>
          )}
        </div>
      )}

      {/* SEARCH TAKEOVER, or the SHEET. */}
      {searching ? (
        <div className="mt-3 rounded border border-line">
          <div className="flex items-center justify-between border-b border-line px-3 py-2 text-sm text-muted">
            <span>
              {query.trim()
                ? "Tab turns this into a filter · Esc returns you exactly where you were"
                : "Type to search tasks, completed work, notes and projects · Esc to leave"}
            </span>
          </div>
          {query.trim() && searchGroups.length === 0 && (
            <div className="px-3 py-3 text-sm text-muted">Nothing matches “{query.trim()}”.</div>
          )}
          {searchGroups.map((g) => (
            <div key={g.kind} className="border-b border-line last:border-0">
              <div className="px-3 py-1.5 text-xs uppercase tracking-wide text-muted">
                {g.label} · {g.items.length}
              </div>
              <ul>
                {g.items.map((it) => (
                  <li key={`${it.kind}-${it.id}`} className="px-3 py-1.5 text-sm">
                    {it.primary}
                    {it.secondary && <span className="text-muted"> · {it.secondary}</span>}
                    {it.kind === "completed" && <span className="text-muted"> · completed</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <>
          {/* The stale block sits at the top of the board, above the sheet. It is
              not part of the sheet, so it holds through every column layout. */}
          {renderStaleBlock()}

          {/* Hidden-count control (◂ N · M ▸), derived from what is scrolled out
              of view — not a count of switched-off columns. Clicking lists them. */}
          <div className="relative mt-3 flex items-center justify-between">
            <div className="text-xs text-muted">
              {displayedCount} {displayedCount === 1 ? "task" : "tasks"}
              {chips.length > 0 && " (filtered)"}
            </div>
            {totalHidden > 0 && (
              <div className="relative">
                <button
                  onClick={() => setHiddenListOpen((o) => !o)}
                  className="rounded border border-line px-2 py-0.5 text-xs text-muted hover:text-text"
                  title="columns scrolled out of view"
                >
                  ◂ {hidden.left.length} · {hidden.right.length} ▸
                </button>
                {hiddenListOpen && (
                  <div className="absolute right-0 top-full z-10 mt-1 w-48 rounded border border-line bg-surface p-2 text-xs shadow-lg">
                    <div className="mb-1 text-muted">Hidden columns — click to reveal</div>
                    {[...hidden.left, ...hidden.right].map((id) => {
                      const def = COLUMNS.find((c) => c.id === id);
                      return (
                        <button
                          key={id}
                          onClick={() => scrollColumnIntoView(id)}
                          className="block w-full py-0.5 text-left text-accent hover:underline"
                        >
                          {def?.label ?? id}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {!anyActive ? (
            <div className="mt-3 rounded border border-line p-6">
              <p className="text-muted">All tasks completed and hidden - Nothing on the board.</p>
              <form action={quickAddTask} className="mt-3 flex items-center gap-2">
                <input type="hidden" name="projectId" value="" />
                <input
                  name="title"
                  placeholder="add a task…"
                  autoFocus
                  autoComplete="off"
                  className="flex-1 border-b border-line bg-transparent py-1 text-sm outline-none focus:text-accent"
                />
                <button className="text-accent hover:underline">add</button>
              </form>
            </div>
          ) : (
            <div className="mt-2 rounded border border-line">
              <div ref={scrollRef} onScroll={measure} className="overflow-x-auto">
                <div style={{ display: "grid", gridTemplateColumns }}>
                  {/* header row */}
                  <div
                    ref={(el) => {
                      if (el) headerRefs.current.set("title", el);
                    }}
                    className="sticky left-0 z-[2] flex items-center gap-2 border-b border-line bg-bg px-3 py-2 text-sm font-medium shadow-[6px_0_6px_-6px_rgba(0,0,0,0.6)]"
                  >
                    <input
                      type="checkbox"
                      aria-label="select all shown"
                      checked={displayedCount > 0 && selection.size >= displayedCount}
                      onChange={(e) =>
                        setSelection(e.target.checked ? new Set(flatIds) : new Set())
                      }
                    />
                    <button onClick={() => clickSortHeader("title")} className="hover:text-accent">
                      Title{sort.field === "title" ? (sort.dir === "asc" ? " ↑" : " ↓") : ""}
                    </button>
                  </div>
                  {nonTitle.map((col) => {
                    const sf = sortableOf[col.id];
                    return (
                      <div
                        key={col.id}
                        ref={(el) => {
                          if (el) headerRefs.current.set(col.id, el);
                        }}
                        className="border-b border-line bg-bg px-3 py-2 text-sm font-medium"
                      >
                        {sf ? (
                          <button onClick={() => clickSortHeader(sf)} className="hover:text-accent">
                            {col.label}
                            {sort.field === sf ? (sort.dir === "asc" ? " ↑" : " ↓") : ""}
                          </button>
                        ) : (
                          <span>{col.label}</span>
                        )}
                      </div>
                    );
                  })}

                  {/* body */}
                  {renderGroups(groups)}

                  {/* the single pinned add row, when not adding per project group */}
                  {!perGroupAdd && (
                    <form action={quickAddTask} className="contents">
                      <div className="sticky left-0 z-[1] flex items-center gap-2 border-b border-line bg-bg px-3 py-1.5 shadow-[6px_0_6px_-6px_rgba(0,0,0,0.6)]">
                        <input
                          name="title"
                          placeholder="add a task…"
                          autoComplete="off"
                          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted focus:text-accent"
                        />
                        <select
                          name="projectId"
                          className="rounded border border-line bg-surface px-1 py-0.5 text-xs"
                        >
                          <option value="">No project</option>
                          {projectOptions.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      {nonTitle.map((col) => (
                        <div key={col.id} className="border-b border-line px-3 py-1.5" />
                      ))}
                    </form>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* The write path — recent activity, each still-undoable line offering undo
          (invariant 1, R4). This is the same ledger the other screens show. */}
      <section className="mt-8">
        <h2 className="text-muted text-sm">Activity — the write path</h2>
        <ul className="mt-2 flex flex-col gap-1 text-sm">
          {activity.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 py-1">
              <span>
                <span className="text-muted">{a.actor}</span> · {a.summary}
              </span>
              {a.undoable && (
                <form action={undoActivity}>
                  <input type="hidden" name="id" value={a.id} />
                  <button className="text-accent hover:underline">undo</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
