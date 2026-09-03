"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { stateWords } from "@/lib/board";
import {
  buildSections,
  groupPeopleByRole,
  clampSidebarWidth,
  fmtMinutes,
  shapeText,
  ROLE_CHOICES,
  type TaskPageData,
  type SectionId,
} from "@/lib/task-page";
import type { Role } from "@/lib/parse";
import {
  loadTaskPage,
  editTaskPageField,
  addTaskPerson,
  editPersonZone,
  addTaskNote,
  addReminder,
  removeReminder,
  setSidebarWidth,
  type EditField,
} from "./actions";
import type { TaskPagePerson } from "@/lib/task-page";

/*
  WP6 · the task page, drawn as a sidebar over whatever is behind it (R6, R19).
  It opens with a task id, loads that task through a server action, and renders
  five sections in a fixed order — when, how long, who, reminders, notes — with
  history last and collapsed. Every value edits in place; there is no save button
  because every write undoes from the activity page (R6, invariant 2). A field
  that is empty is never drawn as an empty field: it collapses to one plain-word
  control ("add a date", "add a person"), and pressing that word turns it into
  the field.

  It disturbs nothing behind it. Closing (Escape or the scrim) just unmounts the
  overlay; the board's grouping, columns, scroll and selection are its own state
  and are never touched — so no snapshot is needed here, unlike the board's
  search takeover which had to restore a view it had flattened (WP4).
*/

// ---------------------------------------------------------------------------
// Small date/label helpers (kept local; formatting only).
// ---------------------------------------------------------------------------

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-08-07" → "Thu 7 Aug". Read in UTC so a date-only value never shifts a
 *  day across the viewer's zone (invariant 10: dates are dates). */
function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// EditableValue — the one control that does double duty (R6):
//   • a present value: shows it, click to edit in place;
//   • an absent value: shows the plain-word control, click turns it into a field.
// There is no edit mode toggle and no save button — commit on Enter or blur,
// cancel on Escape. Escape is stopped here so it cancels the field rather than
// closing the sidebar.
// ---------------------------------------------------------------------------

function EditableValue({
  value,
  display,
  addWord,
  type,
  pending,
  onCommit,
}: {
  value: string | null;
  display: string;
  addWord: string;
  type: "text" | "date" | "time" | "number";
  pending: boolean;
  onCommit: (raw: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  if (!editing) {
    const empty = value == null || value === "";
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        disabled={pending}
        className={empty ? "text-accent hover:underline" : "text-left hover:text-accent"}
      >
        {empty ? addWord : display}
      </button>
    );
  }

  const commit = (raw: string) => {
    setEditing(false);
    if (raw !== (value ?? "")) onCommit(raw);
  };

  return (
    <input
      ref={inputRef}
      type={type}
      defaultValue={value ?? ""}
      onBlur={(e) => commit(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit(e.currentTarget.value);
        } else if (e.key === "Escape") {
          // Cancel the field, and keep the sidebar open (do not let Escape bubble).
          e.preventDefault();
          e.stopPropagation();
          setEditing(false);
        }
      }}
      className="rounded border border-accent bg-surface px-1.5 py-0.5 text-sm outline-none"
    />
  );
}

/** A section heading + trailing control, drawn only when the section has content
 *  (R6). One row label + value is the `Field` helper below. */
function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-6 text-xs font-semibold uppercase tracking-wide text-muted">{children}</h3>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-2">
      <div className="text-xs text-muted">{label}</div>
      <div className="text-sm">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The sidebar.
// ---------------------------------------------------------------------------

export function TaskSidebar({
  taskId,
  initialWidth,
  onClose,
}: {
  taskId: string | null;
  initialWidth: number;
  onClose: () => void;
}) {
  const [data, setData] = useState<TaskPageData | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, startTransition] = useTransition();

  const [width, setWidth] = useState(initialWidth);
  const widthRef = useRef(width);
  widthRef.current = width;

  const panelRef = useRef<HTMLDivElement | null>(null);
  const today = todayLocal();

  // Load the task when opened (or when the id changes). A server action stands in
  // for an API route — one round-trip, plain serialisable data back.
  useEffect(() => {
    if (!taskId) {
      setData(null);
      return;
    }
    let live = true;
    setLoading(true);
    loadTaskPage(taskId).then((d) => {
      if (!live) return;
      setData(d);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [taskId]);

  // Focus the panel on open so keystrokes (Escape) land here, not on the board.
  useEffect(() => {
    if (taskId) panelRef.current?.focus();
  }, [taskId]);

  // Escape closes, from anywhere, when nothing is being edited (editing fields
  // stop their own Escape). The board's shortcuts are already suppressed while a
  // task is open, so this is the only handler that acts.
  useEffect(() => {
    if (!taskId) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [taskId, onClose]);

  // Persist the dragged width on release (R6: the width is remembered). One write
  // per resize, not a stream — the pointer-move only updates local state.
  const onHandleDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    // Track the latest width in a local, not the state ref: on release the last
    // move's setWidth may not have flushed yet, so widthRef would lag by one drag
    // step and persist a stale number.
    let latest = widthRef.current;
    const move = (ev: PointerEvent) => {
      latest = clampSidebarWidth(window.innerWidth - ev.clientX);
      setWidth(latest);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      void setSidebarWidth(latest);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, []);

  if (!taskId) return null;

  const edit = (field: EditField) => (raw: string) => {
    if (!data) return;
    startTransition(async () => {
      const fresh = await editTaskPageField({ id: data.id, field, value: raw });
      setData(fresh);
    });
  };

  const sections = data ? buildSections(data) : [];
  const populated = (id: SectionId) => sections.find((s) => s.id === id)?.populated ?? false;

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-label="Task">
      {/* The scrim over whatever is behind. Clicking it closes; the board beneath
          keeps all its state. */}
      <div className="flex-1 bg-black/40" onClick={onClose} aria-hidden />

      {/* The panel, its width remembered. The handle on its left edge resizes it. */}
      <div
        ref={panelRef}
        tabIndex={-1}
        style={{ width }}
        className="relative flex h-full flex-col overflow-y-auto bg-bg outline-none"
      >
        <div
          onPointerDown={onHandleDown}
          className="absolute left-0 top-0 h-full w-1.5 cursor-col-resize bg-line/40 hover:bg-accent"
          aria-hidden
        />

        <div className="flex-1 px-6 py-5">
          <div className="flex items-baseline justify-between gap-4">
            <div className="min-w-0 text-xs text-muted">
              {data?.boardTask.projectName ?? "No project"}
            </div>
            <button onClick={onClose} className="shrink-0 text-xs text-muted hover:text-text">
              close · esc
            </button>
          </div>

          {loading && !data && <p className="mt-6 text-sm text-muted">Loading…</p>}

          {data && (
            <>
              {/* Title — an editable heading. Always present, so it never shows a
                  control word. */}
              <div className="mt-3 text-lg font-semibold">
                <EditableValue
                  value={data.title}
                  display={data.title}
                  addWord="untitled"
                  type="text"
                  pending={pending}
                  onCommit={edit("title")}
                />
              </div>

              {/* The state line — the same words the board prints, in the same
                  wording (R6), from the one shared function. */}
              <StateLine data={data} today={today} />

              {/* ---- When ---------------------------------------------------- */}
              {populated("when") && <SectionHeading>When</SectionHeading>}
              <WhenSection data={data} pending={pending} edit={edit} />

              {/* ---- How long ------------------------------------------------ */}
              {populated("howLong") && <SectionHeading>How long</SectionHeading>}
              <HowLongSection data={data} pending={pending} edit={edit} />

              {/* ---- Who ----------------------------------------------------- */}
              {populated("who") && <SectionHeading>Who</SectionHeading>}
              <WhoSection data={data} setData={setData} />

              {/* ---- Reminders ----------------------------------------------- */}
              {populated("reminders") && <SectionHeading>Reminders</SectionHeading>}
              <RemindersSection data={data} setData={setData} />

              {/* ---- Notes --------------------------------------------------- */}
              {populated("notes") && <SectionHeading>Notes</SectionHeading>}
              <NotesSection data={data} setData={setData} />

              {/* ---- Habit completion history (R18) -------------------------- */}
              {data.habitHistory && <HabitHistorySection data={data} />}

              {/* ---- History (last, collapsed) ------------------------------- */}
              {data.historyCount > 0 && <HistorySection data={data} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The state line.
// ---------------------------------------------------------------------------

function StateLine({ data, today }: { data: TaskPageData; today: string }) {
  // Exactly the words the board prints in a title line, in the same wording (R6)
  // — the one shared function, no paraphrase and nothing richer. staleInPlace is
  // false: the "marked in place" word is the board's own display treatment, not a
  // fact about the task. When the board would print nothing (e.g. a commitment
  // with a set kind), the state line is likewise absent here.
  const words = stateWords(data.boardTask, { today, staleInPlace: false });
  if (words.length === 0) return null;
  return <div className="mt-1 text-sm text-muted">{words.join(" · ")}</div>;
}

// ---------------------------------------------------------------------------
// When.
// ---------------------------------------------------------------------------

function WhenSection({
  data,
  pending,
  edit,
}: {
  data: TaskPageData;
  pending: boolean;
  edit: (f: EditField) => (raw: string) => void;
}) {
  return (
    <div>
      {/* Due — a date, and (only once there is a date) a time. */}
      <Field label="Due">
        <span className="inline-flex items-center gap-2">
          <EditableValue
            value={data.dueDate}
            display={fmtDate(data.dueDate)}
            addWord="add a date"
            type="date"
            pending={pending}
            onCommit={edit("dueDate")}
          />
          {data.dueDate && (
            <EditableValue
              value={data.dueTime}
              display={data.dueTime ?? ""}
              addWord="add a time"
              type="time"
              pending={pending}
              onCommit={edit("dueTime")}
            />
          )}
        </span>
      </Field>

      {/* Do date — read-only here. Its owners are the calendar, the queue and the
          not-today branch (invariant 6); the task page shows it, never writes it. */}
      {data.doDate && (
        <Field label="Do">
          <span title="Set on the calendar, in the queue, or from not-today">{fmtDate(data.doDate)}</span>
        </Field>
      )}

      {/* Defer — editable. Once a due date exists this is the section's secondary
          control ("add a defer date"), matching the wireframe. */}
      {(data.deferUntil || data.dueDate) && (
        <Field label="Defer until">
          <EditableValue
            value={data.deferUntil}
            display={fmtDate(data.deferUntil)}
            addWord="add a defer date"
            type="date"
            pending={pending}
            onCommit={edit("deferUntil")}
          />
        </Field>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// How long.
// ---------------------------------------------------------------------------

function HowLongSection({
  data,
  pending,
  edit,
}: {
  data: TaskPageData;
  pending: boolean;
  edit: (f: EditField) => (raw: string) => void;
}) {
  const hasEstimate = data.estimateMinutes != null;
  return (
    <div>
      <Field label="Estimate">
        <EditableValue
          value={hasEstimate ? String(data.estimateMinutes) : null}
          display={hasEstimate ? fmtMinutes(data.estimateMinutes as number) : ""}
          addWord="add an estimate"
          type="number"
          pending={pending}
          onCommit={edit("estimate")}
        />
      </Field>

      {/* Shape — splittable and the smallest useful piece. Only meaningful once a
          length exists; before that the section is just "add an estimate". */}
      {hasEstimate && (
        <Field label="Shape">
          <span className="inline-flex items-center gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => edit("splittable")(String(!data.splittable))}
              className="text-left hover:text-accent"
            >
              {shapeText(data.splittable, data.minChunkMinutes)}
            </button>
            {data.splittable && (
              <span className="text-xs text-muted">
                smallest piece{" "}
                <EditableValue
                  value={data.minChunkMinutes != null ? String(data.minChunkMinutes) : null}
                  display={data.minChunkMinutes != null ? fmtMinutes(data.minChunkMinutes) : ""}
                  addWord="add a minimum"
                  type="number"
                  pending={pending}
                  onCommit={edit("minChunk")}
                />
              </span>
            )}
          </span>
        </Field>
      )}

      {/* Actual — read-only. Recorded at close of day (the queue), not typed here. */}
      {data.actualMinutes != null && (
        <Field label="Actual">
          <span>{fmtMinutes(data.actualMinutes)}</span>
        </Field>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Who — grouped pairs, not slots (R7).
// ---------------------------------------------------------------------------

function WhoSection({
  data,
  setData,
}: {
  data: TaskPageData;
  setData: (d: TaskPageData | null) => void;
}) {
  const groups = groupPeopleByRole(data.people);
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [pickingRoleFor, setPickingRoleFor] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (adding) nameRef.current?.focus();
  }, [adding]);

  const reset = () => {
    setAdding(false);
    setName("");
    setPickingRoleFor(null);
  };

  const commit = (role: Role) => {
    const who = (pickingRoleFor ?? name).trim();
    if (!who) return reset();
    startTransition(async () => {
      const fresh = await addTaskPerson({ id: data.id, name: who, role });
      setData(fresh);
      reset();
    });
  };

  return (
    <div>
      {groups.map((g) => (
        <div key={g.role} className="mt-2">
          <div className="text-xs text-muted">{g.heading}</div>
          <ul className="text-sm">
            {g.people.map((p) => (
              <PersonRow key={p.personId} taskId={data.id} person={p} setData={setData} />
            ))}
          </ul>
        </div>
      ))}

      {/* Add a person: the human first (R7). An unknown name is created on commit.
          Once named, the four role words appear and picking one commits the pair. */}
      <div className="mt-2 text-sm">
        {!adding ? (
          <button type="button" onClick={() => setAdding(true)} className="text-accent hover:underline">
            add a person
          </button>
        ) : pickingRoleFor == null ? (
          <input
            ref={nameRef}
            value={name}
            placeholder="who?"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (name.trim()) setPickingRoleFor(name.trim());
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                reset();
              }
            }}
            className="rounded border border-accent bg-surface px-1.5 py-0.5 text-sm outline-none"
          />
        ) : (
          <span className="inline-flex flex-wrap items-center gap-2">
            <span className="text-muted">{pickingRoleFor} —</span>
            {ROLE_CHOICES.map((c) => (
              <button
                key={c.role}
                type="button"
                disabled={pending}
                onClick={() => commit(c.role)}
                className="text-accent hover:underline"
              >
                {c.word}
              </button>
            ))}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// A person row (WP12). Shows the name and, for a commitment person, their zone —
// the clock this task's deadline is read in (invariant 11). "zone" expands an
// inline editor for the zone and working hours; saving recomputes every active
// commitment of theirs, which is why the whole set can shift from one edit. People
// are reached here, from the tasks that reference them (R19), not a people screen.
// ---------------------------------------------------------------------------

function PersonRow({
  taskId,
  person,
  setData,
}: {
  taskId: string;
  person: TaskPagePerson;
  setData: (d: TaskPageData | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [tz, setTz] = useState(person.timezone ?? "");
  const [start, setStart] = useState(person.dayStart ?? "");
  const [end, setEnd] = useState(person.dayEnd ?? "");

  const save = () => {
    startTransition(async () => {
      const fresh = await editPersonZone({
        taskId,
        personId: person.personId,
        timezone: tz,
        dayStart: start,
        dayEnd: end,
      });
      setData(fresh);
      setEditing(false);
    });
  };

  return (
    <li className="py-0.5">
      <span className="inline-flex flex-wrap items-center gap-2">
        <span>{person.name}</span>
        {person.timezone ? (
          <span className="text-muted">· {person.timezone}</span>
        ) : (
          <span className="text-muted">· no zone</span>
        )}
        {person.dayStart && person.dayEnd && (
          <span className="text-muted">
            · {person.dayStart}–{person.dayEnd}
          </span>
        )}
        <button
          type="button"
          onClick={() => setEditing((e) => !e)}
          className="text-xs text-accent hover:underline"
        >
          {editing ? "close" : "zone"}
        </button>
      </span>

      {editing && (
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
          <input
            value={tz}
            placeholder="Area/City (e.g. Europe/Berlin)"
            onChange={(e) => setTz(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                save();
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setEditing(false);
              }
            }}
            className="w-56 rounded border border-accent bg-surface px-1.5 py-0.5 outline-none"
          />
          <span className="text-muted">day</span>
          <input
            type="time"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="rounded border border-line bg-surface px-1 py-0.5 outline-none"
          />
          <span className="text-muted">to</span>
          <input
            type="time"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="rounded border border-line bg-surface px-1 py-0.5 outline-none"
          />
          <button
            type="button"
            disabled={pending}
            onClick={save}
            className="text-accent hover:underline disabled:opacity-40"
          >
            save
          </button>
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Reminders (WP7). Lists the reminders on the task, each with its computed fire
// time and a remove control, and offers the add flow: the four presets when a
// due time exists (they are offsets from it), a Custom absolute reminder always,
// and — when there is no due time — the one quiet caption reminders.md calls for
// in place of the presets. Reminders are opt in: nothing is added unless pressed.
// ---------------------------------------------------------------------------

const REMINDER_PRESETS: { id: string; label: string }[] = [
  { id: "1d", label: "1 day before" },
  { id: "30m", label: "30 min before" },
  { id: "15m", label: "15 min before" },
  { id: "at", label: "at the due time" },
];

function RemindersSection({
  data,
  setData,
}: {
  data: TaskPageData;
  setData: (d: TaskPageData | null) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [custom, setCustom] = useState(false);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  // The start reminder is removable, but removing it names what is given up
  // (reminders.md) — so its "remove" opens an inline warning rather than acting at
  // once. Not a confirmation dialog (invariant 2 bans those): an inline sentence,
  // and the removal itself is reversible from the activity page like every write.
  const [confirmStart, setConfirmStart] = useState<string | null>(null);

  const reset = () => {
    setAdding(false);
    setCustom(false);
    setDate("");
    setTime("");
  };

  const addPreset = (presetId: string) => {
    startTransition(async () => {
      const fresh = await addReminder({ id: data.id, presetId });
      setData(fresh);
      reset();
    });
  };

  const addCustom = () => {
    if (!date || !time) return;
    startTransition(async () => {
      const fresh = await addReminder({ id: data.id, absoluteDate: date, absoluteTime: time });
      setData(fresh);
      reset();
    });
  };

  const remove = (reminderId: string) => {
    startTransition(async () => {
      const fresh = await removeReminder({ id: data.id, reminderId });
      setData(fresh);
      setConfirmStart(null);
    });
  };

  const hasDueTime = !!data.dueTime;

  return (
    <div>
      {data.reminders.map((r) => (
        <Field key={r.id} label={r.label}>
          <span className="inline-flex flex-wrap items-center gap-2">
            <span className="text-muted">
              {r.when ?? (r.isStart ? "computed from the estimate" : "—")}
            </span>
            {/* A reminder you set removes silently. The start reminder names what is
                given up first (reminders.md · WP13): its remove opens an inline
                warning, and only "remove anyway" takes it off. */}
            {!r.isStart ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => remove(r.id)}
                className="text-xs text-muted hover:text-accent"
              >
                remove
              </button>
            ) : confirmStart === r.id ? (
              <span className="inline-flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted">
                  This is the only warning before this commitment is due. Remove it and nothing reminds you to start.
                </span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => remove(r.id)}
                  className="text-xs text-accent hover:underline"
                >
                  remove anyway
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmStart(null)}
                  className="text-xs text-muted hover:text-text"
                >
                  keep
                </button>
              </span>
            ) : (
              <button
                type="button"
                disabled={pending}
                onClick={() => setConfirmStart(r.id)}
                className="text-xs text-muted hover:text-accent"
              >
                remove
              </button>
            )}
          </span>
        </Field>
      ))}

      <div className="mt-2 text-sm">
        {!adding ? (
          <button type="button" onClick={() => setAdding(true)} className="text-accent hover:underline">
            add a reminder
          </button>
        ) : custom ? (
          // Custom takes an absolute date and time and stays where you put it.
          <span className="inline-flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="rounded border border-accent bg-surface px-1.5 py-0.5 text-sm outline-none"
            />
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="rounded border border-accent bg-surface px-1.5 py-0.5 text-sm outline-none"
            />
            <button
              type="button"
              disabled={pending || !date || !time}
              onClick={addCustom}
              className="text-accent hover:underline disabled:opacity-40"
            >
              add
            </button>
            <button type="button" onClick={reset} className="text-xs text-muted hover:text-text">
              cancel
            </button>
          </span>
        ) : (
          <span className="inline-flex flex-wrap items-center gap-3">
            {hasDueTime ? (
              REMINDER_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  disabled={pending}
                  onClick={() => addPreset(p.id)}
                  className="text-accent hover:underline"
                >
                  {p.label}
                </button>
              ))
            ) : (
              // No due time: the presets have nothing to be N minutes before, so a
              // single quiet caption stands in their place (reminders.md / R25).
              <span className="text-xs text-muted">
                {data.dueDate ? "add a due time for presets" : "add a due date for presets"}
              </span>
            )}
            <button
              type="button"
              onClick={() => setCustom(true)}
              className="text-accent hover:underline"
            >
              Custom…
            </button>
            <button type="button" onClick={reset} className="text-xs text-muted hover:text-text">
              cancel
            </button>
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Notes.
// ---------------------------------------------------------------------------

function NotesSection({
  data,
  setData,
}: {
  data: TaskPageData;
  setData: (d: TaskPageData | null) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [body, setBody] = useState("");
  const ref = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (adding) ref.current?.focus();
  }, [adding]);

  const commit = () => {
    const text = body.trim();
    if (!text) {
      setAdding(false);
      setBody("");
      return;
    }
    startTransition(async () => {
      const fresh = await addTaskNote({ id: data.id, body: text });
      setData(fresh);
      setAdding(false);
      setBody("");
    });
  };

  return (
    <div>
      {data.notes.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1 text-sm">
          {data.notes.map((n) => (
            <li key={n.id}>{n.body}</li>
          ))}
        </ul>
      )}
      <div className="mt-2 text-sm">
        {!adding ? (
          <button type="button" onClick={() => setAdding(true)} className="text-accent hover:underline">
            add a note
          </button>
        ) : (
          <input
            ref={ref}
            value={body}
            placeholder="a note…"
            disabled={pending}
            onChange={(e) => setBody(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setAdding(false);
                setBody("");
              }
            }}
            className="w-full rounded border border-accent bg-surface px-1.5 py-0.5 text-sm outline-none"
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Habit completion history (R18) — "done N times · last on <date>", and nothing
// else: no pace, no target, no streak. A habit is a recurring task nobody is
// waiting on, so the honest thing to show is what has happened, not a scoreboard.
// ---------------------------------------------------------------------------

function HabitHistorySection({ data }: { data: TaskPageData }) {
  const h = data.habitHistory!;
  const times = `done ${h.doneCount} time${h.doneCount === 1 ? "" : "s"}`;
  const last = h.lastDoneIso ? ` · last on ${fmtDate(h.lastDoneIso)}` : "";
  return (
    <div className="mt-6">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">Completion history</div>
      <div className="mt-1 text-sm">
        {h.doneCount === 0 ? "not done yet" : `${times}${last}`}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// History — last, collapsed, with a count. Reads the activity rows the write
// spine has been writing all along (R6); no store of its own.
// ---------------------------------------------------------------------------

function HistorySection({ data }: { data: TaskPageData }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-6">
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-xs font-semibold uppercase tracking-wide text-muted hover:text-text"
      >
        History · {data.historyCount} {data.historyCount === 1 ? "entry" : "entries"} {open ? "▾" : "▸"}
      </button>
      {open && (
        <ul className="mt-2 flex flex-col gap-1 text-sm">
          {data.history.map((h) => (
            <li key={h.id} className="flex gap-2">
              <span className="text-muted">{h.at.slice(0, 10)}</span>
              <span className="text-muted">{h.actor}</span>
              <span>{h.summary}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
