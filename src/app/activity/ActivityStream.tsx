"use client";

import { useMemo, useState, useTransition } from "react";
import { groupByDay, type ActivityLine } from "@/lib/activity";
import type { ActivityStreamLine } from "@/lib/queries";
import { undoActivity } from "../actions";
import { loadMoreActivity } from "./actions";

/*
  WP9 · the activity stream (R9/R10), rendered from lines the server already
  formatted in the user's zone. The client only accumulates pages and groups
  them by day for display; the grouping is the pure @/lib/activity function, so
  a day split across two fetched pages still renders under one heading.

  Read-only with two exceptions (R10): an event still inside its undo window
  carries "undo", and a deletion still inside its thirty days carries "restore".
  Both go through the same undo() on the write spine — a deletion's undo is the
  restore. Every other line is a record.
*/

export function ActivityStream({
  initialLines,
  initialCursor,
  filterKey,
}: {
  initialLines: ActivityStreamLine[];
  initialCursor: string | null;
  filterKey: string;
}) {
  const [lines, setLines] = useState<ActivityStreamLine[]>(initialLines);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [pending, startTransition] = useTransition();

  const days = useMemo(() => groupByDay(lines), [lines]);

  const loadMore = () => {
    if (!cursor) return;
    startTransition(async () => {
      const page = await loadMoreActivity(filterKey, cursor);
      setLines((cur) => [...cur, ...page.lines]);
      setCursor(page.nextCursor);
    });
  };

  if (lines.length === 0) {
    return <p className="mt-6 text-muted">Nothing here yet.</p>;
  }

  return (
    <div className="mt-6">
      {days.map((day) => (
        <div key={day.dayIso} className="mb-6">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">{day.heading}</h2>
          <ul className="mt-2 flex flex-col">
            {day.lines.map((line) => (
              <Row key={line.id} line={line} />
            ))}
          </ul>
        </div>
      ))}

      {cursor ? (
        <button
          type="button"
          onClick={loadMore}
          disabled={pending}
          className="text-sm text-accent hover:underline disabled:opacity-40"
        >
          {pending ? "loading…" : "load more"}
        </button>
      ) : (
        <p className="text-xs text-muted">That is as far back as it goes.</p>
      )}
    </div>
  );
}

function Row({ line }: { line: ActivityLine }) {
  return (
    <li className="flex items-baseline gap-3 border-b border-line py-2 text-sm">
      <span className="shrink-0 text-xs tabular-nums text-muted">{line.time}</span>
      <span className="shrink-0 text-xs text-muted">{line.who}</span>
      <span className="flex-1">{line.summary}</span>
      {line.undoable && (
        // A deletion's inline control reads "restore"; every other undoable row
        // reads "undo" (R10). Both are the same reversal on the write spine.
        <form action={undoActivity} className="shrink-0">
          <input type="hidden" name="id" value={line.id} />
          <button className="text-xs text-accent hover:underline">
            {line.isDeletion ? "restore" : "undo"}
          </button>
        </form>
      )}
    </li>
  );
}
