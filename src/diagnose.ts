import type { Stats } from "./types";

export type DiagLevel = "idle" | "ok" | "stall" | "thread" | "cpu" | "gpu" | "wait" | "mem";
export type Tone = "ok" | "warn" | "danger" | "muted";

export interface Diagnosis {
  level: DiagLevel;
  tone: Tone;
}

/** Rules decide on the last ~30 samples; presentation text is resolved by i18n. */
export function diagnose(history: Stats[]): Diagnosis {
  const last = history[history.length - 1];
  if (!last || !last.running) return { level: "idle", tone: "muted" };

  const win = history.slice(-30);
  const vals = (f: (s: Stats) => number) => win.map(f);
  const avg = (f: (s: Stats) => number) =>
    vals(f).reduce((a, b) => a + b, 0) / Math.max(win.length, 1);
  const peak = (f: (s: Stats) => number) => Math.max(...vals(f), 0);

  const avgCpu = avg((s) => s.cpu_single_pct);
  const peakCpu = peak((s) => s.cpu_single_pct);
  const avgCore = avg((s) => s.busiest_core_pct);
  const threadSamples = win.map((s) => s.busiest_thread_pct).filter((v): v is number => v != null);
  const avgThread = threadSamples.reduce((a, b) => a + b, 0) / Math.max(threadSamples.length, 1);
  const peakThread = Math.max(...threadSamples, 0);
  const peakGpu = peak((s) => s.gpu_pct ?? 0);
  const minAvail = Math.min(...vals((s) => s.sys_mem_avail_mb));

  // A missed message pump is direct evidence, unlike any load reading, so it
  // outranks every other rule. It is also a live state, not a peak: a freeze
  // that ended twenty seconds ago must stop headlining the verdict, and a
  // demo-to-real switch must not inherit the demo's freezes. `ui_stall_sec`
  // only counts the current uninterrupted run, and clears on the first reply.
  // Requiring two seconds filters single-probe jitter while still catching
  // freezes long before Windows paints "Not responding".
  if (last.ui_stall_sec >= 2) {
    return { level: "stall", tone: last.ui_stall_sec >= 5 ? "danger" : "warn" };
  }

  // A sustained per-thread reading supports a single-thread compute hint, but
  // still does not prove that this is AutoCAD's main thread. Process and system
  // metrics remain separate; the older process/core rule is only a fallback
  // when per-thread samples are unavailable.
  if (threadSamples.length >= 3 && peakThread >= 85 && avgThread >= 60) {
    return { level: "thread", tone: "danger" };
  }
  if (threadSamples.length === 0 && peakCpu >= 85 && avgCpu >= 40 && avgCore >= 80) {
    return { level: "cpu", tone: "danger" };
  }
  if (minAvail < 2048) return { level: "mem", tone: "warn" };
  if (peakGpu >= 60) return { level: "gpu", tone: "warn" };

  // Once the probe has answered, low load plus a live message pump is simply
  // healthy idle: reporting "wait-type lag" there was a guess, not a finding.
  const probed = win.some((s) => s.ui_responsive != null);
  if (!probed && avgCpu < 30 && peakGpu < 40) return { level: "wait", tone: "warn" };
  return { level: "ok", tone: "ok" };
}
