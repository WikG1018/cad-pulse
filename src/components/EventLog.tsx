import { useEffect, useRef, useState } from "react";
import type { Stats } from "../types";

export type EventKind = "start" | "stop" | "cpu" | "gpu" | "mem" | "demo";
export interface LogEvent {
  ts: number;
  kind: EventKind;
  text: string;
}

const KEY = "cadpulse-events";
const MAX = 80;
/** Same-kind events are suppressed for this long. */
const COOLDOWN_MS: Record<EventKind, number> = {
  start: 0,
  stop: 0,
  cpu: 60_000,
  gpu: 60_000,
  mem: 120_000,
  demo: 0,
};

function load(): LogEvent[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

function save(events: LogEvent[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(events.slice(-MAX)));
  } catch {
    /* ignore */
  }
}

const TONE: Record<EventKind, string> = {
  start: "ok",
  stop: "muted",
  cpu: "danger",
  gpu: "warn",
  mem: "warn",
  demo: "muted",
};

const time = (ts: number) =>
  new Date(ts * 1000).toLocaleTimeString("zh-CN", { hour12: false });

/**
 * Watches the stats stream and records notable transitions:
 * AutoCAD start/stop, sustained CPU peaks, GPU busy, memory pressure.
 */
export function useEventLog(history: Stats[]): LogEvent[] {
  const [events, setEvents] = useState<LogEvent[]>(load);
  const lastByKind = useRef<Partial<Record<EventKind, number>>>({});
  const prevRunning = useRef<boolean | null>(null);
  const highStreak = useRef(0);

  useEffect(() => {
    const s = history[history.length - 1];
    if (!s) return;

    const push = (kind: EventKind, text: string, cooldownKey?: EventKind) => {
      const key = cooldownKey ?? kind;
      const cd = COOLDOWN_MS[key];
      const last = lastByKind.current[key] ?? 0;
      if (cd > 0 && s.ts - last < cd / 1000) return;
      lastByKind.current[key] = s.ts;
      setEvents((prev) => {
        const next = [...prev, { ts: s.ts, kind, text }];
        const trimmed = next.slice(-MAX);
        save(trimmed);
        return trimmed;
      });
    };

    // process lifecycle — demo payloads carry a fake pid, skip them
    if (!s.demo) {
      if (prevRunning.current !== null && prevRunning.current !== s.running) {
        if (s.running) push("start", `AutoCAD 启动 · PID ${s.pid}`);
        else push("stop", "AutoCAD 已关闭");
      }
      prevRunning.current = s.running;
    } else {
      prevRunning.current = null; // re-arm so real launches after demo are logged
    }

    if (!s.running || s.demo) return;

    // sustained single-core saturation (3+ samples above 85%)
    if (s.cpu_single_pct >= 85) {
      highStreak.current += 1;
      if (highStreak.current === 3) {
        push("cpu", `CPU 单核持续满载 ${Math.round(s.cpu_single_pct)}% — 疑似图纸数据过重`);
      }
    } else {
      highStreak.current = 0;
    }

    if ((s.gpu_pct ?? 0) >= 60) {
      push("gpu", `GPU 负载 ${Math.round(s.gpu_pct ?? 0)}% — 渲染管线繁忙`);
    }
    if (s.sys_mem_avail_mb < 2048) {
      push("mem", `系统可用内存仅 ${(s.sys_mem_avail_mb / 1024).toFixed(1)} GB`);
    }
  }, [history]);

  return events;
}

export function EventLogView({ events }: { events: LogEvent[] }) {
  const recent = [...events].reverse().slice(0, 40);
  return (
    <div className="event-log">
      {recent.length === 0 && (
        <div className="event-empty">暂无事件 — 启动 AutoCAD 或触发负载后自动记录</div>
      )}
      {recent.map((e, i) => (
        <div className="event-row" key={`${e.ts}-${i}`}>
          <span className="num event-time">{time(e.ts)}</span>
          <span className={`dot ${TONE[e.kind]}`} style={{ width: 6, height: 6 }} />
          <span className="event-text">{e.text}</span>
        </div>
      ))}
    </div>
  );
}
