"use client";

import { useEffect, useRef } from "react";
import { recordOpen } from "./actions";

/*
  WP10 · the "open" engagement beacon. A render-free client component that fires
  recordOpen() once when today mounts. It lives on the client on purpose: the
  server render of today also runs on prefetch and on every revalidate, and firing
  from there would count opens the user never made. A mount is a real visit. The
  server side still dedupes a rapid remount into one visit, so this is belt and
  braces, not the only guard.
*/

export function EngagementBeacon() {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    void recordOpen();
  }, []);
  return null;
}
