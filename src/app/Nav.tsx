"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/*
  WP9 · the navigation (R19). A thin left rail of five words — today · calendar ·
  board · activity · settings — no icons on their own, the current one marked.
  Today and activity are this package's screens and are wired here; board already
  exists. Calendar (WP14) and settings (WP10+) are not routes yet, so they are
  present but quiet — the rail names the whole app so its shape is legible, and
  those two light up when their packages land.

  Search is the slash key (WP4, from the board) and planning is a button on today
  (WP18), so neither is a rail entry — they are a mode you enter, not a place you
  go (R19).
*/

const ENTRIES: { href: string; label: string; wired: boolean }[] = [
  { href: "/", label: "today", wired: true },
  { href: "/calendar", label: "calendar", wired: false },
  { href: "/board", label: "board", wired: true },
  { href: "/activity", label: "activity", wired: true },
  { href: "/settings", label: "settings", wired: false },
];

export function LeftRail() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      className="flex shrink-0 flex-row gap-4 border-b border-line px-6 py-3 text-sm sm:flex-col sm:gap-2 sm:border-b-0 sm:border-r sm:px-4 sm:py-6"
    >
      {ENTRIES.map((e) => {
        const active = e.href === "/" ? pathname === "/" : pathname.startsWith(e.href);
        if (!e.wired) {
          return (
            <span key={e.href} className="text-muted/50" title="Coming in a later package">
              {e.label}
            </span>
          );
        }
        return (
          <Link
            key={e.href}
            href={e.href}
            aria-current={active ? "page" : undefined}
            className={active ? "font-semibold text-text underline" : "text-muted hover:text-text"}
          >
            {e.label}
          </Link>
        );
      })}
    </nav>
  );
}
