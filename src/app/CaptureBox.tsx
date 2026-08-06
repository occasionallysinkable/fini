"use client";

import { useActionState, useMemo, useState } from "react";
import {
  parse,
  describeKind,
  todayInZone,
  weekdayOf,
  type ParseContext,
  type Role,
} from "@/lib/parse";
import { captureTask, type CaptureState } from "./actions";

/*
  WP2 · the capture line and its echo (wireframe 01).

  The echo under the line is prose, not chips: it names the field it filled and
  the value it filled it with, so a wrong parse is caught while the line is
  still on screen (invariant 8 — the consequence prints where the action is).
  The same pure parser runs here for the live echo and on the server for the
  authoritative write, so what you see is what gets stored.

  A person with no role gets a numbered inline question (R16 "asks once"; the
  keyboard reaches everything — invariant 9). The chosen roles ride along with
  the submit.
*/

const ROLE_OPTIONS: { key: Role; label: string }[] = [
  { key: "asked_by", label: "asked by" },
  { key: "waiting_on", label: "waiting on" },
  { key: "delegated_to", label: "delegated to" },
  { key: "assignee", label: "assignee" },
];

export function CaptureBox({ context }: { context: ParseContext }) {
  const [raw, setRaw] = useState("");
  const [roles, setRoles] = useState<Record<string, Role>>({});
  const [state, formAction, pending] = useActionState<CaptureState, FormData>(
    captureTask,
    { ok: false }
  );

  // "Today" resolves in this browser's zone (invariant 10), so the echo shows
  // the day the user is actually living even when the server runs in UTC. The
  // same zone rides along on submit so the stored date matches.
  const local = useMemo(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const today = todayInZone(tz);
    return { tz, today, weekday: weekdayOf(today) };
  }, []);
  const effectiveContext: ParseContext = useMemo(
    () => ({ ...context, today: local.today, todayWeekday: local.weekday }),
    [context, local]
  );

  const parsed = useMemo(() => parse(raw, effectiveContext), [raw, effectiveContext]);

  // People needing a role, after the user's inline answers are applied.
  const peopleResolved = parsed.people.map((p) => ({
    ...p,
    role: p.role ?? roles[p.name] ?? null,
  }));

  // One kind line, computed from the resolved roles so it updates as the user
  // answers the inline role question. Same words the parser's echo would print.
  const kindText = describeKind(
    peopleResolved,
    parsed.recurrence != null,
    parsed.kindExplicit ? parsed.kind : null
  );

  const needRole = peopleResolved.filter((p) => p.role === null);
  const showEcho = raw.trim().length > 0;

  return (
    <div>
      <form
        action={(fd) => {
          fd.set("raw", raw);
          fd.set("roles", JSON.stringify(roles));
          fd.set("tz", local.tz);
          formAction(fd);
          setRaw("");
          setRoles({});
        }}
      >
        <input
          name="raw"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="Add a task — try  Send Priya the figures by Thursday 5pm ~90m @priya:asked"
          autoFocus
          autoComplete="off"
          className="w-full rounded border border-line bg-surface px-3 py-2 outline-none focus:border-accent"
        />

        {showEcho && (
          <div className="mt-3 rounded border border-line bg-surface/50 px-3 py-2 text-sm">
            <div className="text-muted">
              Title — <span className="text-text">{parsed.title || "…"}</span>
            </div>

            {/* Kind is rendered once, below, from the resolved roles — so it is
                filtered out of the parser's echo here to avoid a second line. */}
            {parsed.echo
              .filter((line) => line.field !== "Kind")
              .map((line, idx) => (
                <div key={idx} className="text-muted">
                  {line.field} — <span className="text-text">{line.text}</span>
                </div>
              ))}

            {/* R15: one caption when a due time is outside every shift. */}
            {parsed.caption && (
              <div className="mt-1 text-deadline">{parsed.caption}</div>
            )}

            {/* Warnings, e.g. a reminder with no due date (invariant 13/8). */}
            {parsed.warnings.map((w, idx) => (
              <div key={idx} className="mt-1 text-deadline">
                {w}
              </div>
            ))}

            {/* R16: a person with no role is asked, once, inline. */}
            {needRole.map((p) => (
              <div key={p.name} className="mt-1 text-muted">
                {p.name} — role?{" "}
                {ROLE_OPTIONS.map((opt, i) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setRoles((r) => ({ ...r, [p.name]: opt.key }))}
                    className="mr-2 text-accent hover:underline"
                  >
                    {i + 1} {opt.label}
                  </button>
                ))}
              </div>
            ))}

            {/* R17: the kind inference, printed once, live, with its cause. */}
            <div className="mt-1 text-muted">
              Kind — <span className="text-text">{kindText}</span>
            </div>
          </div>
        )}

        <div className="mt-2 flex items-center gap-3">
          <button
            disabled={pending || !parsed.title}
            className="rounded border border-line bg-surface px-3 py-2 hover:border-accent disabled:opacity-40"
          >
            Add · return
          </button>
          {state.error && <span className="text-deadline text-sm">{state.error}</span>}
          {state.ok && state.summary && (
            <span className="text-muted text-sm">{state.summary}</span>
          )}
        </div>
      </form>
    </div>
  );
}
