/*
  WP9 · the activity page — the pure logic behind the stream (R9, R10).

  The activity page is not a feature bolted on; it is the read side of the write
  spine (invariant 1). Every domain write has been writing an activity row all
  along, each with an actor, a one-sentence summary and (where it can be undone)
  an undo payload. This module holds the two pure pieces the page needs — the six
  filters and the group-by-day — so they unit-test without a database or browser.

  One reverse-chronological stream, grouped under a date heading (R9). Six filters
  across the top, the current one underlined (R10): everything · reminders ·
  overrides · dates · people · deletions. Five of them map onto activity.filterKind
  (the sixth, "everything", is the absence of a filter). It is read-only save for
  the two inline controls the page component adds: undo inside the undo window,
  and restore for a deletion inside its thirty days.
*/

/** The activity.filterKind values, the closed set the schema stores. */
export type FilterKind = "reminders" | "overrides" | "dates" | "people" | "deletions";

/** A filter tab. "everything" carries a null kind — it narrows to nothing. */
export interface ActivityFilter {
  key: "everything" | FilterKind;
  label: string;
  kind: FilterKind | null;
}

/** The six filters, in the order R10 prints them. A seventh would be added here
 *  and nowhere else. */
export const ACTIVITY_FILTERS: ActivityFilter[] = [
  { key: "everything", label: "everything", kind: null },
  { key: "reminders", label: "reminders", kind: "reminders" },
  { key: "overrides", label: "overrides", kind: "overrides" },
  { key: "dates", label: "dates", kind: "dates" },
  { key: "people", label: "people", kind: "people" },
  { key: "deletions", label: "deletions", kind: "deletions" },
];

/** Resolve a filter key (e.g. from the URL) to its filter, defaulting to
 *  "everything" for an unknown or absent key. */
export function resolveFilter(key: string | null | undefined): ActivityFilter {
  return ACTIVITY_FILTERS.find((f) => f.key === key) ?? ACTIVITY_FILTERS[0];
}

// ---------------------------------------------------------------------------
// One line of the stream, and grouping it under a day.
// ---------------------------------------------------------------------------

/** One event, shaped for the client: strings only, no Date objects, so the
 *  whole stream crosses the server → client boundary without a serializer. */
export interface ActivityLine {
  id: string;
  /** ISO instant of the event. */
  at: string;
  /** "HH:MM" in the viewer's day — precomputed on the server in the user's zone. */
  time: string;
  /** Who did it: "You", "App", or a person's name (R9 — naming the actor is the
   *  whole reason the page exists). */
  who: string;
  /** The one-sentence summary the write logged. */
  summary: string;
  /** True while the undo window is still open. */
  undoable: boolean;
  /** True when this is a deletion — its inline control reads "restore", not
   *  "undo" (R10), for as long as it is undoable (deletes keep a 30-day window). */
  isDeletion: boolean;
}

export interface ActivityDay {
  /** "YYYY-MM-DD" of the day, in the viewer's zone. */
  dayIso: string;
  /** The heading the day prints, e.g. "Thursday 3 September". */
  heading: string;
  lines: ActivityLine[];
}

/**
 * Group an already-reverse-chronological list of lines under day headings,
 * preserving that order (R9). Each line carries the day it belongs to so the
 * grouping needs no zone maths of its own — the server stamped the local day
 * when it built the line. Lines are assumed newest-first; days come out
 * newest-first, and within a day the lines keep their newest-first order.
 */
export function groupByDay(
  lines: (ActivityLine & { dayIso: string; heading: string })[]
): ActivityDay[] {
  const days: ActivityDay[] = [];
  let current: ActivityDay | null = null;
  for (const line of lines) {
    if (!current || current.dayIso !== line.dayIso) {
      current = { dayIso: line.dayIso, heading: line.heading, lines: [] };
      days.push(current);
    }
    const { dayIso, heading, ...rest } = line;
    void dayIso;
    void heading;
    current.lines.push(rest);
  }
  return days;
}
