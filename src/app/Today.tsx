"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  dueLine,
  tomorrow,
  furthestWeekday,
  addDays,
  weekdayOf,
  shortDate,
  OVERRIDE_REASONS,
  type OverrideReasonCode,
} from "@/lib/today";
import type { TodayData, TodayItem, TodaySearchItem } from "@/lib/queries";
import { TaskSidebar } from "./task/TaskSidebar";
import {
  completeTaskToday,
  notTodayMove,
  notTodayWaiting,
  editBlockerExpectedBy,
  removeBlocker,
  chooseSomethingElse,
  setOverrideReason,
  undoActivity,
  type TodayAnswer,
} from "./actions";

/*
  WP9 · the plain today (R21) with all three answers and every branch (R1/R2/R3),
  and the one ledger line with undo (R4).

  One thing, large: the screen commits to a single task and reads its due date
  flatly — no ranking, no reason sentence (that is stage 3, WP17). Everything
  else drops to a list you can read but not fiddle with (decisions 104). Three
  answers, three keys: Done (D), Not today (L), Something else (N); U undoes the
  last answer. The keyboard reaches everything (invariant 9), and no action has a
  confirmation dialog because every one undoes (invariant 2).
*/

type Mode = "idle" | "notToday" | "waitingDate" | "pickDay" | "choosing";

interface Ledger {
  activityId: string;
  summary: string;
}

// A task resolved for the frame. Today tasks carry their full line; a task
// pulled forward off the board by the search (R2) is framed with a plain line.
interface Framed {
  id: string;
  title: string;
  projectName: string | null;
  line: string;
  blocked: boolean;
  blockerId: string | null;
  expectedBy: string | null;
  onToday: boolean;
}

export function Today({
  data,
  initialSidebarWidth,
}: {
  data: TodayData;
  initialSidebarWidth: number;
}) {
  const { today, tasks, searchable } = data;

  const [framedId, setFramedId] = useState<string | null>(tasks[0]?.id ?? null);
  const [mode, setMode] = useState<Mode>("idle");
  const [ledger, setLedger] = useState<Ledger | null>(data.ledger);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  // Something-else picks a chosen task off today; keep its identity so the frame
  // can show it even though it is not in `tasks`.
  const [pulled, setPulled] = useState<TodaySearchItem | null>(null);
  // The override awaiting an optional reason (R1): the five-word row under the
  // ledger. Cleared by choosing a reason, or simply ignored (a complete answer).
  const [reasonFor, setReasonFor] = useState<{ overrideId: string; chosen: string; rejected: string } | null>(
    null
  );

  // A signature that changes when the set changes OR when a task's blocked state
  // flips — so blocking the framed task (waiting-on) reframes it away, not just
  // its leaving the set does.
  const setSig = tasks.map((t) => `${t.id}${t.blocked ? "!" : ""}`).join(",");

  // Keep the frame on a valid lead. When the today set changes under us (an
  // answer moved, completed, or blocked a task), reframe on the new first task —
  // selectToday already demotes blocked work, so tasks[0] is the lead. A task
  // that is still present and not blocked stays framed (so an N-pick of an
  // on-today task holds). Skipped while mid-something-else on a pulled task.
  useEffect(() => {
    if (pulled) return;
    setFramedId((cur) => {
      const t = cur ? tasks.find((x) => x.id === cur) : null;
      if (t && !t.blocked) return cur;
      return tasks[0]?.id ?? null;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setSig]);

  const framed: Framed | null = useMemo(() => {
    if (pulled) {
      const onList = tasks.find((t) => t.id === pulled.id);
      if (onList) {
        return {
          id: onList.id,
          title: onList.title,
          projectName: onList.projectName,
          line: dueLine(onList, today),
          blocked: onList.blocked,
          blockerId: onList.blockerId,
          expectedBy: onList.expectedBy,
          onToday: true,
        };
      }
      return {
        id: pulled.id,
        title: pulled.title,
        projectName: pulled.projectName,
        line: "pulled forward off the board",
        blocked: false,
        blockerId: null,
        expectedBy: null,
        onToday: false,
      };
    }
    const t = tasks.find((x) => x.id === framedId) ?? tasks[0] ?? null;
    if (!t) return null;
    return {
      id: t.id,
      title: t.title,
      projectName: t.projectName,
      line: dueLine(t, today),
      blocked: t.blocked,
      blockerId: t.blockerId,
      expectedBy: t.expectedBy,
      onToday: true,
    };
  }, [pulled, tasks, framedId, today]);

  // The rest of today — everything but the framed task, in order (decisions 104).
  const rest = useMemo(
    () => tasks.filter((t) => t.id !== framed?.id),
    [tasks, framed?.id]
  );

  const run = useCallback(
    (fn: () => Promise<TodayAnswer>, after?: (r: TodayAnswer) => void) => {
      setError(null);
      startTransition(async () => {
        const r = await fn();
        if (r.error) {
          setError(r.error);
          return;
        }
        if (r.activityId && r.summary) setLedger({ activityId: r.activityId, summary: r.summary });
        after?.(r);
      });
    },
    []
  );

  const backToIdle = useCallback(() => {
    setMode("idle");
    setPulled(null);
  }, []);

  // --- The three answers -----------------------------------------------------

  const doDone = useCallback(() => {
    if (!framed) return;
    run(() => completeTaskToday(framed.id), () => {
      backToIdle();
      setReasonFor(null);
    });
  }, [framed, run, backToIdle]);

  const doNotTodayDate = useCallback(
    (dateIso: string, label: string) => {
      if (!framed) return;
      run(() => notTodayMove(framed.id, dateIso, label), () => backToIdle());
    },
    [framed, run, backToIdle]
  );

  const doChoose = useCallback(
    (chosen: TodayItem | TodaySearchItem, onToday: boolean) => {
      if (!framed) return;
      const rejectedTitle = framed.title;
      run(
        () => chooseSomethingElse(framed.id, chosen.id),
        (r) => {
          setMode("idle");
          setPulled(onToday ? null : (chosen as TodaySearchItem));
          setFramedId(chosen.id);
          if (r.overrideId) {
            setReasonFor({ overrideId: r.overrideId, chosen: chosen.title, rejected: rejectedTitle });
          }
        }
      );
    },
    [framed, run]
  );

  const doReason = useCallback(
    (code: OverrideReasonCode, freeText?: string) => {
      if (!reasonFor) return;
      run(
        () => setOverrideReason(reasonFor.overrideId, code, freeText),
        () => setReasonFor(null)
      );
    },
    [reasonFor, run]
  );

  const doUndo = useCallback(() => {
    if (!ledger) return;
    const id = ledger.activityId;
    run(
      () => undoActivity2(id),
      () => {
        setLedger(null);
        setReasonFor(null);
      }
    );
  }, [ledger, run]);

  // --- Keyboard (invariant 9) ------------------------------------------------

  const modeRef = useRef(mode);
  modeRef.current = mode;
  const reasonRef = useRef(reasonFor);
  reasonRef.current = reasonFor;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Never steal keys from an open task sidebar or a text field.
      if (openTaskId) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;

      const k = e.key.toLowerCase();
      const m = modeRef.current;

      if (m === "idle") {
        if (k === "d") return e.preventDefault(), doDone();
        if (k === "l") return e.preventDefault(), setMode("notToday");
        if (k === "n") return e.preventDefault(), setMode("choosing");
        if (k === "u" && ledger) return e.preventDefault(), doUndo();
        // The five-word reason row also takes digits when it is showing (R1).
        if (reasonRef.current && /^[1-5]$/.test(e.key)) {
          e.preventDefault();
          const opt = OVERRIDE_REASONS[Number(e.key) - 1];
          if (opt && !opt.freeText) doReason(opt.code);
          return;
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        backToIdle();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [openTaskId, ledger, doDone, doUndo, doReason, backToIdle]);

  // --- Render ----------------------------------------------------------------

  return (
    <div>
      {tasks.length === 0 && !framed ? (
        // Empty state — one sentence, and the capture line above is already the
        // useful input (invariant 14).
        <p className="text-muted">Nothing is due or planned for today.</p>
      ) : framed ? (
        <section className="rounded-lg border border-line bg-surface p-6">
          <div className="text-xs text-muted">{framed.projectName ?? "No project"}</div>
          <h2 className="mt-1 text-2xl font-semibold">
            <button
              type="button"
              onClick={() => setOpenTaskId(framed.id)}
              className="text-left hover:text-accent"
            >
              {framed.title}
            </button>
          </h2>
          <p className="mt-1 text-sm text-muted">{framed.line}</p>

          {mode === "idle" && (
            <div className="mt-5 flex flex-wrap gap-2">
              <AnswerButton onClick={doDone} pending={pending}>
                Done <Key>D</Key>
              </AnswerButton>
              <AnswerButton onClick={() => setMode("notToday")} pending={pending}>
                Not today <Key>L</Key>
              </AnswerButton>
              <AnswerButton onClick={() => setMode("choosing")} pending={pending}>
                Something else <Key>N</Key>
              </AnswerButton>
            </div>
          )}

          {mode === "notToday" && (
            <NotTodayRow
              framed={framed}
              today={today}
              pending={pending}
              onDate={doNotTodayDate}
              onPickDay={() => setMode("pickDay")}
              onWaiting={(name, dateIso) =>
                run(() => notTodayWaiting(framed.id, name, dateIso), () => backToIdle())
              }
              onEditExpected={(dateIso) =>
                framed.blockerId &&
                run(() => editBlockerExpectedBy(framed.id, framed.blockerId!, dateIso), () => backToIdle())
              }
              onRemoveBlocker={() =>
                framed.blockerId &&
                run(() => removeBlocker(framed.id, framed.blockerId!), () => backToIdle())
              }
              onCancel={backToIdle}
            />
          )}

          {mode === "pickDay" && (
            <PickDay
              pending={pending}
              onPick={(iso) => doNotTodayDate(iso, shortDate(iso))}
              onCancel={() => setMode("notToday")}
            />
          )}
        </section>
      ) : null}

      {/* Something-else takes over the frame in place (R1): the rejected task
          struck through at the top, the next four numbered, then a search. */}
      {mode === "choosing" && framed && (
        <ChoosingPanel
          rejected={framed}
          candidates={rest}
          searchable={searchable}
          today={today}
          pending={pending}
          onPickToday={(t) => doChoose(t, true)}
          onPickSearch={(s) => doChoose(s, false)}
          onCancel={backToIdle}
        />
      )}

      {error && <p className="mt-3 text-sm text-deadline">{error}</p>}

      {/* The ledger (R4): one line, held until the next answer replaces it, key
          U to undo. */}
      {ledger && (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">{ledger.summary}</span>
          <button
            type="button"
            onClick={doUndo}
            disabled={pending}
            className="text-accent hover:underline"
          >
            undo <Key>U</Key>
          </button>
        </div>
      )}

      {/* The reason row (R1): asked AFTER the pick, optional; ignoring it is a
          complete answer. */}
      {reasonFor && <ReasonRow pending={pending} onReason={doReason} onDismiss={() => setReasonFor(null)} />}

      {/* The rest of today — a list you can read but not fiddle with. */}
      {mode !== "choosing" && rest.length > 0 && (
        <section className="mt-8">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">The rest of today</h3>
          <ul className="mt-2 flex flex-col">
            {rest.map((t) => (
              <li key={t.id} className="border-b border-line py-2">
                <button
                  type="button"
                  onClick={() => setOpenTaskId(t.id)}
                  className={`text-left text-sm hover:text-accent ${t.blocked ? "text-muted" : ""}`}
                >
                  {t.title}
                </button>
                <div className="text-xs text-muted">
                  {[dueLine(t, today), t.projectName].filter(Boolean).join(" · ")}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <TaskSidebar
        taskId={openTaskId}
        initialWidth={initialSidebarWidth}
        onClose={() => setOpenTaskId(null)}
      />
    </div>
  );
}

// A thin wrapper so undoActivity (a FormData action) is callable as a plain
// function here — it takes FormData, so build one with the id.
async function undoActivity2(id: string): Promise<TodayAnswer> {
  const fd = new FormData();
  fd.set("id", id);
  await undoActivity(fd);
  return { ok: true };
}

function AnswerButton({
  children,
  onClick,
  pending,
}: {
  children: React.ReactNode;
  onClick: () => void;
  pending: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="rounded border border-line px-3 py-1.5 text-sm hover:border-accent hover:text-accent disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="ml-1 rounded border border-line px-1 text-xs text-muted">{children}</kbd>
  );
}

// ---------------------------------------------------------------------------
// Not today (R3). One line of options; when the task already carries a blocker,
// the line is replaced by the expected-by field and "remove blocker".
// ---------------------------------------------------------------------------

function NotTodayRow({
  framed,
  today,
  pending,
  onDate,
  onPickDay,
  onWaiting,
  onEditExpected,
  onRemoveBlocker,
  onCancel,
}: {
  framed: Framed;
  today: string;
  pending: boolean;
  onDate: (iso: string, label: string) => void;
  onPickDay: () => void;
  onWaiting: (name: string, dateIso: string) => void;
  onEditExpected: (iso: string) => void;
  onRemoveBlocker: () => void;
  onCancel: () => void;
}) {
  const weekday = furthestWeekday(today);
  const [waiting, setWaiting] = useState(false);

  // Already blocked: the person is a fact, so only the new expected-by date is
  // offered, plus "remove blocker" (R3, decisions 115).
  if (framed.blocked) {
    return (
      <div className="mt-5">
        <div className="text-sm text-muted">{framed.line}</div>
        <div className="mt-2">
          <ExpectedByField
            today={today}
            pending={pending}
            onCommit={(iso) => onEditExpected(iso)}
            onCancel={onCancel}
          />
        </div>
        <button
          type="button"
          onClick={onRemoveBlocker}
          disabled={pending}
          className="mt-2 text-sm text-accent hover:underline"
        >
          remove blocker
        </button>
      </div>
    );
  }

  if (waiting) {
    return (
      <WaitingOn
        today={today}
        pending={pending}
        onCommit={onWaiting}
        onCancel={() => setWaiting(false)}
      />
    );
  }

  const opts = [
    { label: "tomorrow", onClick: () => onDate(tomorrow(today), "tomorrow") },
    { label: weekday.label, onClick: () => onDate(weekday.date, weekday.label) },
    { label: "pick a day", onClick: onPickDay },
    { label: "no date", onClick: () => onDate("", "no date") },
    { label: "waiting on someone", onClick: () => setWaiting(true) },
  ];

  return (
    <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
      <span className="text-muted">Not today:</span>
      {opts.map((o, i) => (
        <button
          key={o.label}
          type="button"
          onClick={o.onClick}
          disabled={pending}
          className="text-accent hover:underline disabled:opacity-40"
        >
          <span className="text-muted">{i + 1}</span> {o.label}
        </button>
      ))}
      <button type="button" onClick={onCancel} className="text-xs text-muted hover:text-text">
        cancel · esc
      </button>
    </div>
  );
}

// The waiting-on branch asks its two fields in sequence (R3): the person first
// (an unknown name is created as you type — on the server), then the expected-by
// date with shortcuts.
function WaitingOn({
  today,
  pending,
  onCommit,
  onCancel,
}: {
  today: string;
  pending: boolean;
  onCommit: (name: string, dateIso: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [named, setNamed] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  if (named == null) {
    return (
      <div className="mt-5 text-sm">
        <span className="text-muted">Waiting on — </span>
        <input
          ref={nameRef}
          value={name}
          placeholder="who?"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim()) {
              e.preventDefault();
              setNamed(name.trim());
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              onCancel();
            }
          }}
          className="rounded border border-accent bg-surface px-1.5 py-0.5 text-sm outline-none"
        />
      </div>
    );
  }

  return (
    <div className="mt-5 text-sm">
      <span className="text-muted">Waiting on {named}, expected — </span>
      <ExpectedByField
        today={today}
        pending={pending}
        onCommit={(iso) => onCommit(named, iso)}
        onCancel={onCancel}
      />
    </div>
  );
}

// The expected-by field with its three shortcuts (R3): tomorrow, this Friday,
// pick a day. Shared by the waiting-on branch and the already-blocked edit.
function ExpectedByField({
  today,
  pending,
  onCommit,
  onCancel,
}: {
  today: string;
  pending: boolean;
  onCommit: (iso: string) => void;
  onCancel: () => void;
}) {
  const [picking, setPicking] = useState(false);
  const [date, setDate] = useState("");

  // "this Friday" — the coming Friday (today if today is Friday).
  const fridayDiff = (5 - weekdayOf(today) + 7) % 7;
  const friday = addDays(today, fridayDiff);

  if (picking) {
    return (
      <span className="inline-flex items-center gap-2">
        <input
          type="date"
          value={date}
          autoFocus
          onChange={(e) => setDate(e.target.value)}
          className="rounded border border-accent bg-surface px-1.5 py-0.5 text-sm outline-none"
        />
        <button
          type="button"
          disabled={pending || !date}
          onClick={() => date && onCommit(date)}
          className="text-accent hover:underline disabled:opacity-40"
        >
          set
        </button>
      </span>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-3">
      <button type="button" disabled={pending} onClick={() => onCommit(tomorrow(today))} className="text-accent hover:underline">
        tomorrow
      </button>
      <button type="button" disabled={pending} onClick={() => onCommit(friday)} className="text-accent hover:underline">
        this Friday
      </button>
      <button type="button" onClick={() => setPicking(true)} className="text-accent hover:underline">
        pick a day
      </button>
      <button type="button" onClick={onCancel} className="text-xs text-muted hover:text-text">
        cancel · esc
      </button>
    </span>
  );
}

function PickDay({
  pending,
  onPick,
  onCancel,
}: {
  pending: boolean;
  onPick: (iso: string) => void;
  onCancel: () => void;
}) {
  const [date, setDate] = useState("");
  return (
    <div className="mt-5 flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted">Not today → </span>
      <input
        type="date"
        value={date}
        autoFocus
        onChange={(e) => setDate(e.target.value)}
        className="rounded border border-accent bg-surface px-1.5 py-0.5 text-sm outline-none"
      />
      <button
        type="button"
        disabled={pending || !date}
        onClick={() => date && onPick(date)}
        className="text-accent hover:underline disabled:opacity-40"
      >
        set
      </button>
      <button type="button" onClick={onCancel} className="text-xs text-muted hover:text-text">
        back
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Something else (R1/R2): the rejected task struck through, the next four
// numbered, then a search that can pull anything forward off the board.
// ---------------------------------------------------------------------------

function ChoosingPanel({
  rejected,
  candidates,
  searchable,
  today,
  pending,
  onPickToday,
  onPickSearch,
  onCancel,
}: {
  rejected: Framed;
  candidates: TodayItem[];
  searchable: TodaySearchItem[];
  today: string;
  pending: boolean;
  onPickToday: (t: TodayItem) => void;
  onPickSearch: (s: TodaySearchItem) => void;
  onCancel: () => void;
}) {
  const four = candidates.slice(0, 4); // R2: the list offers four.
  const [q, setQ] = useState("");

  // Digit keys 1–4 pick from the list (invariant 9).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      if (/^[1-4]$/.test(e.key)) {
        const t = four[Number(e.key) - 1];
        if (t) {
          e.preventDefault();
          onPickToday(t);
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [four, onPickToday]);

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    return searchable
      .filter((s) => s.id !== rejected.id && s.title.toLowerCase().includes(term))
      .slice(0, 6);
  }, [q, searchable, rejected.id]);

  return (
    <section className="mt-4 rounded-lg border border-line bg-surface p-6">
      <div className="text-sm text-muted line-through">{rejected.title}</div>

      {four.length > 0 ? (
        <ul className="mt-3 flex flex-col">
          {four.map((t, i) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => onPickToday(t)}
                disabled={pending}
                className="flex w-full items-baseline gap-2 border-b border-line py-2 text-left hover:text-accent disabled:opacity-40"
              >
                <span className="text-muted">{i + 1}</span>
                <span className="text-sm">{t.title}</span>
                <span className="text-xs text-muted">{dueLine(t, today)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        // None left — the offered task was the last one (R2).
        <p className="mt-3 text-sm text-muted">nothing else is on today.</p>
      )}

      {/* The search is always here: pulling something forward off the board is a
          legitimate answer, and the one the app most wants recorded (R2). */}
      <div className="mt-4">
        <input
          value={q}
          autoFocus
          placeholder="or pull something forward off the board…"
          onChange={(e) => setQ(e.target.value)}
          className="w-full rounded border border-line bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent"
        />
        {results.length > 0 && (
          <ul className="mt-1 flex flex-col">
            {results.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => onPickSearch(s)}
                  disabled={pending}
                  className="flex w-full items-baseline gap-2 py-1 text-left text-sm hover:text-accent disabled:opacity-40"
                >
                  {s.title}
                  {s.projectName && <span className="text-xs text-muted">{s.projectName}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <button type="button" onClick={onCancel} className="mt-4 text-xs text-muted hover:text-text">
        cancel · esc
      </button>
    </section>
  );
}

// ---------------------------------------------------------------------------
// The reason row (R1): five options under the ledger, optional. The fifth opens
// a free-text field; the four canned ones commit on the tap.
// ---------------------------------------------------------------------------

function ReasonRow({
  pending,
  onReason,
  onDismiss,
}: {
  pending: boolean;
  onReason: (code: OverrideReasonCode, freeText?: string) => void;
  onDismiss: () => void;
}) {
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState("");

  if (writing) {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <input
          value={text}
          autoFocus
          placeholder="what beat the ranking?"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && text.trim()) {
              e.preventDefault();
              onReason("free_text", text.trim());
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setWriting(false);
            }
          }}
          className="min-w-64 flex-1 rounded border border-accent bg-surface px-1.5 py-0.5 text-sm outline-none"
        />
        <button
          type="button"
          disabled={pending || !text.trim()}
          onClick={() => onReason("free_text", text.trim())}
          className="text-accent hover:underline disabled:opacity-40"
        >
          save
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <span className="text-muted">why?</span>
      {OVERRIDE_REASONS.map((r, i) => (
        <button
          key={r.code}
          type="button"
          disabled={pending}
          onClick={() => (r.freeText ? setWriting(true) : onReason(r.code))}
          className="text-accent hover:underline disabled:opacity-40"
        >
          <span className="text-muted">{i + 1}</span> {r.word}
        </button>
      ))}
      <button type="button" onClick={onDismiss} className="text-xs text-muted hover:text-text">
        skip
      </button>
    </div>
  );
}
