/*
  WP6 · the task page — its pure logic, so the shape of the page unit-tests
  without a database or a browser.

  Three jobs live here:
    1. buildSections   — the five sections in their fixed order (R6), each marked
                         populated or not, so an empty section collapses to just
                         its plain-word control ("no empty fields" — R6).
    2. groupPeopleByRole — person-and-role pairs drawn as role headings, only the
                         roles that have someone, in a fixed order (R7).
    3. settings        — the two keys WP6 writes into user.settings: the sidebar's
                         remembered width and the row-click behaviour. WP10 reads
                         the SAME keys when it builds the chooser and the other
                         two routes, so they are named here once.

  Nothing here reads Prisma or React. The query (getTaskPageData) shapes the row
  into TaskPageData; the sidebar renders it; this module decides the structure.
*/

import type { BoardTask } from "./board";
import type { Role } from "./parse";

// ---------------------------------------------------------------------------
// The data the page is built from (serialisable — dates are strings).
// ---------------------------------------------------------------------------

export interface TaskPagePerson {
  personId: string;
  name: string;
  timezone: string | null;
  role: Role;
}

/** A reminder as the page lists it. WP7 owns adding and removing; the start
 *  reminder's estimate-derived line is WP13. `when` is the computed fire time in
 *  the user's zone, or a plain reason it cannot fire yet. */
export interface TaskPageReminder {
  id: string;
  label: string;
  when: string | null;
  isStart: boolean;
}

export interface TaskPageNote {
  id: string;
  body: string;
}

export interface TaskPageHistoryEntry {
  id: string;
  at: string; // ISO instant
  actor: string;
  summary: string;
}

export interface TaskPageData {
  id: string;
  title: string;
  /** The same row the board carries, so the state line uses the shared function
   *  and prints identical words (R6). */
  boardTask: BoardTask;

  // When
  dueDate: string | null;
  dueTime: string | null;
  /** Read-only here: do_date's owners are the calendar, the queue and the
   *  not-today branch (invariant 6), never the task page. Shown, not edited. */
  doDate: string | null;
  deferUntil: string | null;

  // How long
  estimateMinutes: number | null;
  splittable: boolean;
  minChunkMinutes: number | null;
  /** Read-only: recorded at close of day (the queue), not typed here. */
  actualMinutes: number | null;

  // Who
  people: TaskPagePerson[];

  // Reminders — WP7 shell (list only, no add flow, no suspension line)
  reminders: TaskPageReminder[];

  // Notes
  notes: TaskPageNote[];

  // History — collapsed, with a count (reads the activity rows WP1 writes)
  history: TaskPageHistoryEntry[];
  historyCount: number;
}

// ---------------------------------------------------------------------------
// 1 · The five sections, in order, with empty ones collapsed to their control.
// ---------------------------------------------------------------------------

export type SectionId = "when" | "howLong" | "who" | "reminders" | "notes";

/** Headings and the one plain-word control each section ends in (R6). The order
 *  of this list IS the order the page draws — when, how long, who, reminders,
 *  notes — and nothing may reorder it.
 *
 *  WP7 gives reminders its own add flow, so it now carries a control like every
 *  other section — "add a reminder" — and the section always offers it (R6). */
export const SECTION_META: { id: SectionId; heading: string; control: string | null }[] = [
  { id: "when", heading: "When", control: "add a date" },
  { id: "howLong", heading: "How long", control: "add an estimate" },
  { id: "who", heading: "Who", control: "add a person" },
  { id: "reminders", heading: "Reminders", control: "add a reminder" },
  { id: "notes", heading: "Notes", control: "add a note" },
];

export interface TaskSection {
  id: SectionId;
  heading: string;
  /** The plain-word control, or null for a section with no add flow in WP6
   *  (reminders — WP7 adds its control). */
  control: string | null;
  /** True when the section has at least one thing in it. When false the page
   *  draws only the control — no heading, no dashed empty rows (R6). A section
   *  with a null control and no content (reminders, empty) is absent entirely. */
  populated: boolean;
}

/** Whether each section has content. An empty section is not "drawn as an empty
 *  field" (R6); the page shows just its control so you can add to it. `actual`
 *  and `doDate` are read-only facts, but they still count as content: a task
 *  with a recorded actual and nothing else legitimately shows the How-long
 *  section. */
export function sectionPopulated(data: TaskPageData): Record<SectionId, boolean> {
  return {
    when: !!(data.dueDate || data.dueTime || data.doDate || data.deferUntil),
    howLong:
      data.estimateMinutes != null ||
      data.actualMinutes != null ||
      data.minChunkMinutes != null,
    who: data.people.length > 0,
    reminders: data.reminders.length > 0,
    notes: data.notes.length > 0,
  };
}

/** The five sections in their fixed order, each marked populated or not. The
 *  page renders a populated section as heading + fields + control, and an empty
 *  one as just its control. */
export function buildSections(data: TaskPageData): TaskSection[] {
  const populated = sectionPopulated(data);
  return SECTION_META.map((m) => ({
    id: m.id,
    heading: m.heading,
    control: m.control,
    populated: populated[m.id],
  }));
}

// ---------------------------------------------------------------------------
// 2 · People — grouped pairs, not slots (R7).
// ---------------------------------------------------------------------------

/** Roles in the order the four words are offered and the page stacks them. */
export const ROLE_ORDER: Role[] = ["asked_by", "waiting_on", "delegated_to", "assignee"];

export const ROLE_LABEL: Record<Role, string> = {
  asked_by: "Asked by",
  waiting_on: "Waiting on",
  delegated_to: "Delegated to",
  assignee: "Assignee",
};

export interface RoleGroup {
  role: Role;
  heading: string;
  people: TaskPagePerson[];
}

/**
 * Group person-and-role pairs into role headings — only the roles that have
 * someone in them, in ROLE_ORDER (R7: "Draw only the roles that have someone in
 * them"). Order within a role follows the order given (the human order). A task
 * with nobody attached returns [], and the page then shows only "add a person".
 */
export function groupPeopleByRole(people: TaskPagePerson[]): RoleGroup[] {
  return ROLE_ORDER.flatMap((role) => {
    const inRole = people.filter((p) => p.role === role);
    return inRole.length ? [{ role, heading: ROLE_LABEL[role], people: inRole }] : [];
  });
}

/** The four role words, in order, for the add-a-person flow (R7: human first,
 *  then pick a role). Excludes none — every role is offerable here, unlike the
 *  not-today waiting-on branch where the role is already known. */
export const ROLE_CHOICES: { role: Role; word: string }[] = ROLE_ORDER.map((role) => ({
  role,
  word: ROLE_LABEL[role].toLowerCase(),
}));

// ---------------------------------------------------------------------------
// 3 · Settings — the one key WP6 writes.
//
// WP6 persists the sidebar's remembered width and nothing else. The row-click
// behaviour (which of the three routes a click takes) is WP10's chooser: WP6
// ships only the sidebar, so it opens the sidebar unconditionally and reads no
// such setting. The seed already reserves a "rowClick" key for WP10 to own; this
// module deliberately does not touch it.
// ---------------------------------------------------------------------------

/** The sidebar's remembered width, in user.settings. Named here so WP10 reads
 *  the same key rather than guessing at another. */
export const SIDEBAR_WIDTH_KEY = "sidebarWidth";

export const MIN_SIDEBAR_WIDTH = 320;
export const MAX_SIDEBAR_WIDTH = 760;
export const DEFAULT_SIDEBAR_WIDTH = 420;

/** Keep a width inside sane bounds and integral. A dragged width that came back
 *  as NaN or a wild number never persists a broken sidebar. */
export function clampSidebarWidth(px: number): number {
  if (!Number.isFinite(px)) return DEFAULT_SIDEBAR_WIDTH;
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(px)));
}

export function readSidebarWidth(settings: unknown): number {
  const s = (settings ?? {}) as Record<string, unknown>;
  const raw = s[SIDEBAR_WIDTH_KEY];
  return typeof raw === "number" ? clampSidebarWidth(raw) : DEFAULT_SIDEBAR_WIDTH;
}

// ---------------------------------------------------------------------------
// Formatting used by the sidebar (kept pure so it is testable and shared).
// ---------------------------------------------------------------------------

/** Minutes as "1h 30m" / "45m" / "2h". */
export function fmtMinutes(m: number): string {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h && mm) return `${h}h ${mm}m`;
  if (h) return `${h}h`;
  return `${mm}m`;
}

/** The How-long "Shape" line: splittable with a minimum, or one run. Null when
 *  there is nothing to say yet (unsplittable with no estimate reads as one run
 *  only once a length exists). */
export function shapeText(splittable: boolean, minChunkMinutes: number | null): string {
  if (splittable) {
    return minChunkMinutes != null ? `splittable · ${fmtMinutes(minChunkMinutes)} at least` : "splittable";
  }
  return "one run";
}
