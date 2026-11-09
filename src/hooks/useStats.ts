import { useEffect, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Stats } from "../types";

// 3600 covers the 30-minute view even at the fastest 0.5 s sampling.
const MAX_POINTS = 3600;

export function useStats() {
  const [latest, setLatest] = useState<Stats | null>(null);
  const [history, setHistory] = useState<Stats[]>([]);

  useEffect(() => {
    let un: UnlistenFn | undefined;
    let alive = true;
    listen<Stats>("perf-tick", (e) => {
      if (!alive) return;
      setLatest(e.payload);
      setHistory((h) => {
        const next = [...h, e.payload];
        return next.length > MAX_POINTS ? next.slice(next.length - MAX_POINTS) : next;
      });
    }).then((u) => {
      if (alive) un = u;
      else u();
    }).catch(() => {});
    return () => {
      alive = false;
      un?.();
    };
  }, []);

  return { latest, history };
}

/** Extract a field within the trailing time window (seconds), independent of sample rate. */
export function series(history: Stats[], f: (s: Stats) => number | null, seconds: number): number[] {
  const lastTs = history[history.length - 1]?.ts;
  if (lastTs == null) return [];
  return history
    .filter((s) => s.ts >= lastTs - seconds)
    .map(f)
    .filter((v): v is number => v != null);
}
