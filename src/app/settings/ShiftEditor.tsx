"use client";

import { useActionState, useState } from "react";
import type { ShiftEditorData, ShiftRow } from "@/lib/queries";
import { fmtMinutes } from "@/lib/task-page";
import {
  capacityNote,
  remainingLabel,
  unestimatedLabel,
  windowMinutes,
} from "@/lib/shifts";
import {
  addShift,
  editShiftCapacity,
  updateWakingHours,
  type ShiftFormState,
} from "./actions";

/*
  WP11 · the shift editor (R13's Settings table). It does three jobs:
    - shows each shift with what it holds TODAY — scheduled, remaining, and the
      unestimated count beside it (all queries, invariant 3), plus a day total
      that is displayed and refuses nothing;
    - adds a shift: name, window, days, categories, capacity — and the capacity
      pre-fills from the window and says so (R13);
    - edits a shift's capacity and the waking-hours window (R29).
  The calendar (WP14) will draw these as per-day bands across seven days; here in
  stage 1 the figures live on the shift table itself, which is honest and does
  not pretend to be the calendar.
*/

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"]; // index 0 = Sunday
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function hoursOf(minutes: number | null): string {
  if (minutes == null) return "";
  // A tidy hours value for the number field: 480 → "8", 390 → "6.5".
  return String(Math.round((minutes / 60) * 100) / 100);
}

function ShiftLoadLine({ row }: { row: ShiftRow }) {
  if (!row.activeToday) {
    return <span className="text-xs text-muted">off today</span>;
  }
  const { load } = row;
  const unestimated = unestimatedLabel(load.unestimatedCount);
  return (
    <span className="text-xs text-muted">
      {fmtMinutes(load.scheduledMinutes)} scheduled · {remainingLabel(load.remainingMinutes)}
      {unestimated ? ` · ${unestimated}` : ""}
    </span>
  );
}

function CapacityEditor({ row }: { row: ShiftRow }) {
  const [state, run] = useActionState<ShiftFormState, FormData>(editShiftCapacity, {});
  return (
    <form action={run} className="flex items-center gap-2">
      <input type="hidden" name="shiftId" value={row.id} />
      <input
        name="capacityHours"
        type="number"
        step="0.5"
        min="0.5"
        max="24"
        defaultValue={hoursOf(row.capacityMinutes)}
        aria-label={`Capacity for ${row.name} in hours`}
        className="w-16 rounded border border-line bg-transparent px-2 py-1 text-sm"
      />
      <span className="text-xs text-muted">h</span>
      <button
        type="submit"
        className="rounded border border-line px-2 py-1 text-xs hover:bg-surface"
      >
        set
      </button>
      {state.error && <span className="text-xs text-accent">{state.error}</span>}
    </form>
  );
}

function AddShift({ categories }: { categories: { id: string; name: string }[] }) {
  const [state, run] = useActionState<ShiftFormState, FormData>(addShift, {});
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("17:00");
  const [capacity, setCapacity] = useState(hoursOf(windowMinutes("09:00", "17:00")));
  const [touched, setTouched] = useState(false);

  // Capacity pre-fills from the window and says so (R13). While the user has not
  // edited it, it tracks the window; once they type, it is theirs.
  function onWindowChange(nextStart: string, nextEnd: string) {
    setStart(nextStart);
    setEnd(nextEnd);
    if (!touched) setCapacity(hoursOf(windowMinutes(nextStart, nextEnd)));
  }

  return (
    <form action={run} className="mt-4 flex flex-col gap-3 rounded border border-line p-4">
      <p className="text-sm font-medium">Add a shift</p>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted">Name</span>
        <input
          name="name"
          required
          placeholder="e.g. Deep work"
          className="rounded border border-line bg-transparent px-2 py-1"
        />
      </label>

      <div className="flex flex-wrap gap-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Starts</span>
          <input
            name="startTime"
            type="time"
            value={start}
            onChange={(e) => onWindowChange(e.target.value, end)}
            className="rounded border border-line bg-transparent px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Ends</span>
          <input
            name="endTime"
            type="time"
            value={end}
            onChange={(e) => onWindowChange(start, e.target.value)}
            className="rounded border border-line bg-transparent px-2 py-1"
          />
        </label>
      </div>

      <fieldset className="flex flex-col gap-1 text-sm">
        <span className="text-muted">Days</span>
        <div className="flex gap-1">
          {DAY_LABELS.map((label, i) => (
            <label
              key={i}
              title={DAY_NAMES[i]}
              className="flex h-8 w-8 cursor-pointer items-center justify-center rounded border border-line has-[:checked]:bg-surface has-[:checked]:font-semibold"
            >
              <input
                type="checkbox"
                name="weekdays"
                value={i}
                defaultChecked={i >= 1 && i <= 5}
                className="sr-only"
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      {categories.length > 0 && (
        <fieldset className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Categories it takes</span>
          <div className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <label
                key={c.id}
                className="flex cursor-pointer items-center gap-1 rounded border border-line px-2 py-1 has-[:checked]:bg-surface"
              >
                <input type="checkbox" name="categoryIds" value={c.id} />
                {c.name}
              </label>
            ))}
          </div>
          <span className="text-xs text-muted">
            None ticked means it takes every category.
          </span>
        </fieldset>
      )}

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted">Capacity (hours of real work)</span>
        <div className="flex items-center gap-2">
          <input
            name="capacityHours"
            type="number"
            step="0.5"
            min="0.5"
            max="24"
            value={capacity}
            onChange={(e) => {
              setTouched(true);
              setCapacity(e.target.value);
            }}
            className="w-20 rounded border border-line bg-transparent px-2 py-1"
          />
          <span className="text-muted">h</span>
        </div>
        <span className="text-xs text-muted">
          {touched ? "Overridden." : capacityNote(start, end)}
        </span>
      </label>

      <div>
        <button
          type="submit"
          className="rounded border border-line px-3 py-1.5 text-sm hover:bg-surface"
        >
          Add shift
        </button>
      </div>

      {state.error && <p className="text-sm text-accent">{state.error}</p>}
      {state.ok && state.message && <p className="text-sm text-muted">{state.message}</p>}
    </form>
  );
}

function WakingHours({ start, end }: { start: string; end: string }) {
  const [state, run] = useActionState<ShiftFormState, FormData>(updateWakingHours, {});
  return (
    <section>
      <h2 className="text-sm font-semibold">Waking hours</h2>
      <p className="mt-1 text-sm text-muted">
        The window your day lives in. It holds a reminder that would otherwise fire while
        you are asleep. The whole day (00:00–00:00) is the default, and it may cross
        midnight.
      </p>
      <form action={run} className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">From</span>
          <input
            name="wakingStart"
            type="time"
            defaultValue={start}
            className="rounded border border-line bg-transparent px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">To</span>
          <input
            name="wakingEnd"
            type="time"
            defaultValue={end}
            className="rounded border border-line bg-transparent px-2 py-1"
          />
        </label>
        <button
          type="submit"
          className="rounded border border-line px-3 py-1.5 text-sm hover:bg-surface"
        >
          Save
        </button>
        {state.error && <span className="text-sm text-accent">{state.error}</span>}
        {state.ok && state.message && <span className="text-sm text-muted">{state.message}</span>}
      </form>
    </section>
  );
}

export function ShiftEditor({ data }: { data: ShiftEditorData }) {
  const activeCount = data.shifts.filter((s) => s.activeToday).length;

  return (
    <div className="flex flex-col gap-10">
      <section>
        <h2 className="text-sm font-semibold">Shifts</h2>
        <p className="mt-1 text-sm text-muted">
          The stretches of real work your day holds. Each one shows what it holds today —
          the calendar draws these across the week.
        </p>

        {/* The day total: displayed, refuses nothing (Computed table). */}
        <p className="mt-3 text-sm">
          Today holds{" "}
          <span className="font-medium">{fmtMinutes(data.dayTotalMinutes)}</span>
          {activeCount > 0 && (
            <>
              {" "}
              across {activeCount} shift{activeCount === 1 ? "" : "s"}
            </>
          )}
          .
        </p>

        <ul className="mt-4 flex flex-col divide-y divide-line border-y border-line">
          {data.shifts.map((row) => (
            <li key={row.id} className="flex flex-col gap-1 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{row.name}</span>
                <ShiftLoadLine row={row} />
              </div>
              <div className="text-xs text-muted">
                {row.startTime}–{row.endTime} · {row.weekdaysLabel} ·{" "}
                {row.categoryNames.length > 0
                  ? row.categoryNames.join(", ")
                  : "accepts every category"}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <span>
                  capacity {fmtMinutes(row.capacityMinutes ?? 0)}
                  {row.capacityFromWindow ? " (from the window)" : ""}
                </span>
                <CapacityEditor row={row} />
              </div>
            </li>
          ))}
          {data.shifts.length === 0 && (
            <li className="py-3 text-sm text-muted">No shifts yet.</li>
          )}
        </ul>

        <AddShift categories={data.categories} />
      </section>

      <WakingHours start={data.waking.start} end={data.waking.end} />
    </div>
  );
}
