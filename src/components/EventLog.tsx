import { useEffect, useRef, useState } from "react";
import { useLanguage, type Messages, type Language } from "../i18n";
import type { Stats } from "../types";

export type EventKind = "start" | "stop" | "cpu" | "thread" | "stall" | "gpu" | "mem" | "demo";
export interface LogEvent {
  ts: number;
  kind: EventKind;
  value?: number;
  legacyText?: string;
}

const KEY = "cadpulse-events";
const MAX = 80;
const COOLDOWN_MS: Record<EventKind, number> = {
  start: 0,
  stop: 0,
  cpu: 60_000,
  thread: 60_000,
  stall: 60_000,
  gpu: 60_000,
  mem: 120_000,
  demo: 0,
};
const KINDS: EventKind[] = ["start", "stop", "cpu", "thread", "stall", "gpu", "mem", "demo"];

function firstNumber(text: string): number | undefined {
  const match = text.match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : undefined;
}

/** Migrate v0.2 text-only events into language-neutral kind + value records. */
function migrateEvent(raw: unknown): LogEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Partial<LogEvent> & { text?: string };
  if (typeof item.ts !== "number" || !item.kind || !KINDS.includes(item.kind)) return null;
  const legacyText = typeof item.text === "string" ? item.text : item.legacyText;
  let value = typeof item.value === "number" ? item.value : undefined;
  if (value == null && legacyText && item.kind !== "stop") value = firstNumber(legacyText);
  return { ts: item.ts, kind: item.kind, value, legacyText };
}

function load(): LogEvent[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.map(migrateEvent).filter((e): e is LogEvent => e !== null) : [];
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
  thread: "danger",
  stall: "danger",
  gpu: "warn",
  mem: "warn",
  demo: "muted",
};

function formatEvent(event: LogEvent, t: Messages): string {
  if (event.kind === "start") return event.value != null ? `${t.events.start} · PID ${event.value}` : t.events.start;
  if (event.kind === "stop") return t.events.stop;
  if (event.value == null) return event.legacyText ?? event.kind;
  const templates: Partial<Record<EventKind, string>> = {
    cpu: t.events.cpu,
    thread: t.events.thread,
    stall: t.events.stall,
    gpu: t.events.gpu,
    mem: t.events.mem,
  };
  return (templates[event.kind] ?? "{value}").replace("{value}", String(event.value));
}

const time = (ts: number, lang: Language) =>
  new Date(ts * 1000).toLocaleTimeString(lang, { hour12: false });

/** Watches stats and records notable transitions without translated text. */
export function useEventLog(history: Stats[]): LogEvent[] {
  const [events, setEvents] = useState<LogEvent[]>(load);
  const lastByKind = useRef<Partial<Record<EventKind, number>>>({});
  const prevRunning = useRef<boolean | null>(null);
  const highStreak = useRef(0);
  const threadHighStreak = useRef(0);

  useEffect(() => {
    const s = history[history.length - 1];
    if (!s) return;

    const push = (kind: EventKind, value?: number, cooldownKey?: EventKind) => {
      const key = cooldownKey ?? kind;
      const cd = COOLDOWN_MS[key];
      const last = lastByKind.current[key] ?? 0;
      if (cd > 0 && s.ts - last < cd / 1000) return;
      lastByKind.current[key] = s.ts;
      setEvents((prev) => {
        const next = [...prev, { ts: s.ts, kind, value }];
        const trimmed = next.slice(-MAX);
        save(trimmed);
        return trimmed;
      });
    };

    if (!s.demo) {
      if (prevRunning.current !== null && prevRunning.current !== s.running) {
        if (s.running) push("start", s.pid);
        else push("stop");
      }
      prevRunning.current = s.running;
    } else {
      prevRunning.current = null;
    }

    if (!s.running || s.demo) return;

    // Process-wide core-equivalent CPU, not proof of one saturated core.
    if (s.cpu_single_pct >= 85) {
      highStreak.current += 1;
      if (highStreak.current === 3) push("cpu", Math.round(s.cpu_single_pct));
    } else {
      highStreak.current = 0;
    }

    if ((s.busiest_thread_pct ?? 0) >= 85) {
      threadHighStreak.current += 1;
      if (threadHighStreak.current === 3) push("thread", Math.round(s.busiest_thread_pct ?? 0));
    } else {
      threadHighStreak.current = 0;
    }

    if ((s.gpu_pct ?? 0) >= 60) push("gpu", Math.round(s.gpu_pct ?? 0));
    if (s.sys_mem_avail_mb < 2048) push("mem", Number((s.sys_mem_avail_mb / 1024).toFixed(1)));
    // Only a measured freeze is logged: an unmeasured probe stays silent.
    if (s.ui_stall_sec >= 3) push("stall", s.ui_stall_sec);
  }, [history]);

  return events;
}

export function EventLogView({ events }: { events: LogEvent[] }) {
  const { lang, t } = useLanguage();
  const recent = [...events].reverse().slice(0, 40);
  return (
    <div className="event-log">
      {recent.length === 0 && <div className="event-empty">{t.events.empty}</div>}
      {recent.map((e, i) => (
        <div className="event-row" key={`${e.ts}-${i}`}>
          <span className="num event-time">{time(e.ts, lang)}</span>
          <span className={`dot ${TONE[e.kind]}`} style={{ width: 6, height: 6 }} />
          <span className="event-text">{formatEvent(e, t)}</span>
        </div>
      ))}
    </div>
  );
}
