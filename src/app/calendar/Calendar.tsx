"use client";

/*
  WP14 · the calendar screen (R8). Client-side because it drives placement — a
  drag from the rail, or the keyboard/DOM form that doubles as the headless
  verification path (every calendar action has a key; drag is the enhancement,
  the form is the guarantee). Every write is a server action through mutate(); the
  consequence it returns — the tablet's aware lines, or the over-capacity popup
  with a queue link — is printed in the same frame (invariant 8, no toast).
*/

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  CalendarData,
  CalendarBlock,
  CalendarRailItem,
} from "@/lib/queries";
import { minutesToHHMM } from "@/lib/calendar";
import type { PlacementConsequence } from "@/lib/calendar";
import { placeBlock, setDoDate, clearDoDate, loadShiftCharge } from "./actions";

const HOUR_PX = 46; // one hour of grid height
const SCALE = HOUR_PX / 60;

type ChargeList = Awaited<ReturnType<typeof loadShiftCharge>>;

export function Calendar({ data }: { data: CalendarData }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [railQuery, setRailQuery] = useState("");
  const [railOpen, setRailOpen] = useState(true);
  const [openForm, setOpenForm] = useState<string | null>(null); // taskId whose form is open
  const [tablet, setTablet] = useState<string[]>([]);
  const [popup, setPopup] = useState<PlacementConsequence["overCapacity"] & { dayIso: string } | null>(null);
  const [popupList, setPopupList] = useState<ChargeList | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  const gridStart = data.gridStartMinutes;
  const gridEnd = data.gridEndMinutes;
  const gridHeight = ((gridEnd - gridStart) / 60) * HOUR_PX;

  const hours = useMemo(() => {
    const out: number[] = [];
    for (let m = gridStart; m <= gridEnd; m += 60) out.push(m);
    return out;
  }, [gridStart, gridEnd]);

  const rail = useMemo(() => {
    const q = railQuery.trim().toLowerCase();
    if (!q) return data.rail;
    return data.rail.filter(
      (r) => r.title.toLowerCase().includes(q) || (r.projectName ?? "").toLowerCase().includes(q)
    );
  }, [data.rail, railQuery]);

  function clearConsequences() {
    setTablet([]);
    setPopup(null);
    setPopupList(null);
    setRefusal(null);
  }

  function afterWrite(result: { ok: boolean; refusal?: string; consequence?: PlacementConsequence }, dayIso: string) {
    clearConsequences();
    if (!result.ok) {
      if (result.refusal) setRefusal(result.refusal);
      return;
    }
    setOpenForm(null);
    if (result.consequence) {
      setTablet(result.consequence.tabletLines);
      if (result.consequence.overCapacity) {
        setPopup({ ...result.consequence.overCapacity, dayIso });
      }
    }
    router.refresh();
  }

  function doPlace(taskId: string, dayIso: string, startHHMM: string, lengthMinutes: number | null) {
    startTransition(async () => {
      const res = await placeBlock({ taskId, dayIso, startHHMM, lengthMinutes });
      afterWrite(res, dayIso);
    });
  }
  function doAllDay(taskId: string, dayIso: string) {
    startTransition(async () => {
      const res = await setDoDate({ taskId, dayIso });
      afterWrite(res, dayIso);
    });
  }
  function doClear(taskId: string) {
    startTransition(async () => {
      const res = await clearDoDate({ taskId });
      afterWrite(res, data.today);
    });
  }
  function openPopupList() {
    if (!popup) return;
    startTransition(async () => {
      const list = await loadShiftCharge({ shiftId: popup.shiftId, dayIso: popup.dayIso });
      setPopupList(list);
    });
  }

  // --- drag from rail / block onto a day grid -----------------------------
  function onDayDrop(e: React.DragEvent, dayIso: string) {
    e.preventDefault();
    const taskId = e.dataTransfer.getData("text/task");
    const lenRaw = e.dataTransfer.getData("text/length");
    if (!taskId) return;
    // The drop Y within the grid → a start minute, snapped to a quarter hour.
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = e.clientY - rect.top;
    const minutes = gridStart + Math.round(y / SCALE / 15) * 15;
    doPlace(taskId, dayIso, minutesToHHMM(Math.max(gridStart, Math.min(minutes, gridEnd - 15))), lenRaw ? Number(lenRaw) : null);
  }
  function onAllDayDrop(e: React.DragEvent, dayIso: string) {
    e.preventDefault();
    const taskId = e.dataTransfer.getData("text/task");
    if (taskId) doAllDay(taskId, dayIso);
  }

  return (
    <div className="flex flex-col gap-3">
      <ViewControl data={data} onChange={(n) => router.push(`/calendar?days=${n}`)} />

      {refusal && (
        <p className="rounded border border-deadline/50 bg-deadline/10 px-3 py-2 text-sm text-text">
          {refusal}
        </p>
      )}

      <div className="flex gap-3">
        {/* The left rail: undated ranked work you drag from, searchable, and it
            collapses to a word (R8). */}
        {railOpen ? (
          <aside className="w-56 shrink-0" aria-label="Undated work">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
                No do date · {data.rail.length}
              </h2>
              <button
                type="button"
                onClick={() => setRailOpen(false)}
                className="text-xs text-muted hover:text-text"
                title="Collapse the rail"
              >
                collapse
              </button>
            </div>
            <input
              type="search"
              value={railQuery}
              onChange={(e) => setRailQuery(e.target.value)}
              placeholder="search"
              aria-label="Search undated work"
              className="mt-2 w-full rounded border border-line bg-surface px-2 py-1 text-sm"
            />
            <ul className="mt-2 flex flex-col gap-1">
              {rail.length === 0 && (
                <li className="text-sm text-muted">Nothing without a do date.</li>
              )}
              {rail.map((r) => (
                <RailRow
                  key={r.id}
                  item={r}
                  days={data.days}
                  open={openForm === r.id}
                  pending={pending}
                  onToggle={() => setOpenForm(openForm === r.id ? null : r.id)}
                  onPlace={(dayIso, hhmm, len) => doPlace(r.id, dayIso, hhmm, len)}
                  onAllDay={(dayIso) => doAllDay(r.id, dayIso)}
                />
              ))}
            </ul>
          </aside>
        ) : (
          <button
            type="button"
            onClick={() => setRailOpen(true)}
            className="h-fit shrink-0 rounded border border-line bg-surface px-2 py-3 text-xs [writing-mode:vertical-rl]"
            title="Show the undated rail"
          >
            undated · {data.rail.length}
          </button>
        )}

        {/* The days. Each is a column: header, all-day strip, hour grid. */}
        <div className="flex-1 overflow-x-auto">
          <div className="flex gap-2" style={{ minWidth: `${data.days.length * 200}px` }}>
            {/* Hour gutter shared down the left of the grid area. */}
            <div className="shrink-0" style={{ width: 40 }}>
              <div style={{ height: 74 }} /> {/* aligns with header + all-day strip */}
              <div className="relative" style={{ height: gridHeight }}>
                {hours.map((m) => (
                  <div
                    key={m}
                    className="absolute right-1 -translate-y-1/2 text-[10px] text-muted"
                    style={{ top: ((m - gridStart) / 60) * HOUR_PX }}
                  >
                    {minutesToHHMM(m % 1440)}
                  </div>
                ))}
              </div>
            </div>

            {data.days.map((dv) => (
              <div key={dv.day.iso} className="flex-1" style={{ minWidth: 160 }}>
                {/* Header (R8): weekday, date, and what the day holds. */}
                <div className="border-b border-line pb-1">
                  <div className="flex items-baseline justify-between">
                    <span className={dv.day.isToday ? "text-sm font-semibold text-text" : "text-sm text-text"}>
                      {dv.day.weekdayShort} {dv.day.dayOfMonth}
                    </span>
                  </div>
                  <div className="text-[11px] text-muted">{dv.header}</div>
                </div>

                {/* All-day strip (sticky-ish), drops set a do date only. */}
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => onAllDayDrop(e, dv.day.iso)}
                  className="min-h-[28px] border-b border-line bg-surface/40 px-1 py-1"
                  aria-label={`All-day ${dv.day.iso}`}
                  data-allday={dv.day.iso}
                >
                  {dv.allDay.map((a) => (
                    <div key={a.id} className="flex items-center gap-1 text-[11px]">
                      {a.deadline && <span className="text-deadline">deadline</span>}
                      <span className="truncate">{a.title}</span>
                      <button
                        type="button"
                        onClick={() => doClear(a.id)}
                        className="ml-auto text-muted hover:text-text"
                        title="Off the calendar"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>

                {/* The hour grid. Shift bands are the only shading; paper where no
                    shift covers. Blocks sit on top. */}
                <div
                  className="relative"
                  style={{ height: gridHeight }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => onDayDrop(e, dv.day.iso)}
                  data-grid={dv.day.iso}
                >
                  {/* hour lines */}
                  {hours.map((m) => (
                    <div
                      key={m}
                      className="absolute inset-x-0 border-t border-line/40"
                      style={{ top: ((m - gridStart) / 60) * HOUR_PX }}
                    />
                  ))}
                  {/* shift bands */}
                  {dv.bands.map((b) => {
                    const top = b.wholeDay ? 0 : Math.max(0, (b.startMinutes - gridStart) * SCALE);
                    const bottom = b.wholeDay ? gridHeight : (b.endMinutes - gridStart) * SCALE;
                    const height = Math.max(18, bottom - top);
                    return (
                      <div
                        key={b.id}
                        className="absolute inset-x-0 bg-accent/5"
                        style={{ top, height }}
                        aria-label={`${b.name} band`}
                      >
                        <div className="px-1 text-[10px] text-muted">
                          {b.name} · {b.remainingLabel}
                          {b.unestimatedLabel ? ` · ${b.unestimatedLabel}` : ""}
                        </div>
                      </div>
                    );
                  })}
                  {dv.bands.length === 0 && (
                    <div className="absolute inset-x-0 top-1 px-1 text-[10px] text-muted">
                      no shifts
                    </div>
                  )}
                  {/* blocks */}
                  {dv.blocks.map((blk) => (
                    <BlockChip
                      key={blk.id}
                      block={blk}
                      gridStart={gridStart}
                      gridEnd={gridEnd}
                      onRemove={() => doClear(blk.id)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* The tablet (invariant 8): keeps you aware, asks nothing. */}
      {tablet.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface px-4 py-3 text-sm">
          <div className="mx-auto flex max-w-3xl items-start justify-between gap-4">
            <ul className="flex flex-col gap-1">
              {tablet.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
            <button type="button" onClick={() => setTablet([])} className="text-muted hover:text-text">
              dismiss
            </button>
          </div>
        </div>
      )}

      {/* The over-capacity popup (above the tablet's level): names the shift and
          carries a link into the queue (WP18 is the full queue; this lists what is
          charged to the shift so you can see what to take off). */}
      {popup && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded border border-line bg-surface p-4">
            <p className="text-sm text-text">{popup.line}</p>
            {!popupList ? (
              <button
                type="button"
                onClick={openPopupList}
                className="mt-3 text-sm text-accent underline"
              >
                See everything charged to {popup.shiftName}
              </button>
            ) : (
              <ul className="mt-3 flex flex-col gap-1 text-sm">
                {popupList?.items.length === 0 && <li className="text-muted">Nothing charged.</li>}
                {popupList?.items.map((it) => (
                  <li key={`${it.kind}-${it.id}`} className="flex justify-between gap-2">
                    <span className="truncate">
                      {it.title} <span className="text-muted">({it.kind})</span>
                    </span>
                    <span className="text-muted">{it.minutesLabel}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setPopup(null);
                  setPopupList(null);
                }}
                className="text-sm text-muted hover:text-text"
              >
                close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function ViewControl({
  data,
  onChange,
}: {
  data: CalendarData;
  onChange: (n: number) => void;
}) {
  const [anyN, setAnyN] = useState(String(data.dayCount));
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-1" role="group" aria-label="View length">
        {[1, 3, 7].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            aria-pressed={data.dayCount === n}
            className={
              data.dayCount === n
                ? "rounded bg-accent px-2 py-1 text-xs font-semibold text-bg"
                : "rounded border border-line px-2 py-1 text-xs text-muted hover:text-text"
            }
          >
            {n} {n === 1 ? "day" : "days"}
          </button>
        ))}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number.parseInt(anyN, 10);
            if (Number.isFinite(n)) onChange(n);
          }}
          className="ml-1 flex items-center gap-1"
        >
          <input
            type="number"
            min={1}
            max={60}
            value={anyN}
            onChange={(e) => setAnyN(e.target.value)}
            aria-label="Any number of days"
            className="w-14 rounded border border-line bg-surface px-1 py-1 text-xs"
          />
          <button type="submit" className="rounded border border-line px-2 py-1 text-xs text-muted hover:text-text">
            go
          </button>
        </form>
      </div>
      <span className="text-sm text-muted">{data.today} →</span>
    </div>
  );
}

function RailRow({
  item,
  days,
  open,
  pending,
  onToggle,
  onPlace,
  onAllDay,
}: {
  item: CalendarRailItem;
  days: CalendarData["days"];
  open: boolean;
  pending: boolean;
  onToggle: () => void;
  onPlace: (dayIso: string, hhmm: string, len: number | null) => void;
  onAllDay: (dayIso: string) => void;
}) {
  const [dayIso, setDayIso] = useState(days[0]?.day.iso ?? "");
  const [time, setTime] = useState("09:00");
  const [length, setLength] = useState(item.estimateMinutes != null ? String(item.estimateMinutes) : "");

  return (
    <li className="rounded border border-line bg-surface px-2 py-1">
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData("text/task", item.id);
          if (item.estimateMinutes != null) e.dataTransfer.setData("text/length", String(item.estimateMinutes));
        }}
        className="flex cursor-grab items-baseline justify-between gap-2"
      >
        <span className="truncate text-sm">{item.title}</span>
        <button type="button" onClick={onToggle} className="text-xs text-muted hover:text-text" aria-expanded={open}>
          place
        </button>
      </div>
      <div className="text-[11px] text-muted">{item.estimateLabel}</div>
      {open && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onPlace(dayIso, time, length.trim() ? Number(length) : null);
          }}
          className="mt-1 flex flex-col gap-1"
          aria-label={`Place ${item.title}`}
        >
          <select
            value={dayIso}
            onChange={(e) => setDayIso(e.target.value)}
            aria-label="Day"
            className="rounded border border-line bg-bg px-1 py-1 text-xs"
          >
            {days.map((d) => (
              <option key={d.day.iso} value={d.day.iso}>
                {d.day.weekdayShort} {d.day.dayOfMonth}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-1">
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              aria-label="Start time"
              className="rounded border border-line bg-bg px-1 py-1 text-xs"
            />
            <input
              type="number"
              min={5}
              step={5}
              value={length}
              onChange={(e) => setLength(e.target.value)}
              placeholder="mins"
              aria-label="Length in minutes"
              className="w-16 rounded border border-line bg-bg px-1 py-1 text-xs"
            />
          </div>
          <div className="flex gap-1">
            <button
              type="submit"
              disabled={pending}
              className="rounded bg-accent px-2 py-1 text-xs font-semibold text-bg disabled:opacity-50"
            >
              place on grid
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => onAllDay(dayIso)}
              className="rounded border border-line px-2 py-1 text-xs text-muted hover:text-text disabled:opacity-50"
            >
              all-day
            </button>
          </div>
        </form>
      )}
    </li>
  );
}

function BlockChip({
  block,
  gridStart,
  gridEnd,
  onRemove,
}: {
  block: CalendarBlock;
  gridStart: number;
  gridEnd: number;
  onRemove: () => void;
}) {
  const top = Math.max(0, (block.startMinutes - gridStart) * SCALE);
  const clampedEnd = Math.min(block.endMinutes, gridEnd);
  const height = Math.max(18, (clampedEnd - block.startMinutes) * SCALE);
  const tall = height >= 40;
  return (
    <div
      className={
        "absolute left-8 right-1 overflow-hidden rounded-sm border-l-2 bg-surface px-1 text-[11px] " +
        (block.deadline ? "border-deadline" : "border-accent")
      }
      style={{ top, height }}
      data-block={block.id}
      data-deadline={block.deadline ? "true" : "false"}
      title={
        block.deadline
          ? "deadline — cannot be dragged; move it on the task page"
          : block.timeLabel
      }
    >
      <div className="flex items-center gap-1">
        {/* R26: the word "deadline" is in the title line where the block is short,
            under the title where it is tall enough for a second line. */}
        {block.deadline && !tall && <span className="font-medium text-deadline">deadline</span>}
        <span className="truncate">{block.title}</span>
        {block.placed && (
          <button
            type="button"
            onClick={onRemove}
            className="ml-auto text-muted hover:text-text"
            title="Off the calendar"
          >
            ✕
          </button>
        )}
      </div>
      {block.deadline && tall && (
        <div className="text-[10px]">
          <span className="font-medium text-deadline">deadline</span> {block.timeLabel}
        </div>
      )}
      {!block.deadline && tall && <div className="text-[10px] text-muted">{block.timeLabel}</div>}
    </div>
  );
}
