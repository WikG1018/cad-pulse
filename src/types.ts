export type CoreType = "P" | "E";

export interface Stats {
  running: boolean;
  demo: boolean;
  pid: number;
  cpu_single_pct: number;
  cpu_total_pct: number;
  busiest_core_pct: number;
  busiest_thread_pct: number | null;
  busiest_thread_id: number | null;
  thread_count: number;
  cores: number[];
  core_types: CoreType[];
  cpu_model: string;
  cpu_freq_mhz: number;
  mem_mb: number;
  gpu_model: string | null;
  gpu_pct: number | null;
  gpu_mem_mb: number | null;
  gpu_temp_c: number | null;
  gpu_clock_mhz: number | null;
  sys_cpu_pct: number;
  sys_mem_avail_mb: number;
  io_read_bps: number;
  io_write_bps: number;
  uptime_sec: number;
  ts: number;
}

export function coreColor(pct: number, kind: CoreType = "P"): string {
  if (pct >= 85) return "#f08b82";
  if (pct >= 50) return "#efbd72";
  return kind === "E" ? "#6fd3c7" : "#82a9ff";
}

export function gpuLoadColor(pct: number): string {
  if (pct >= 85) return "#f08b82";
  if (pct >= 50) return "#efbd72";
  return "#6fd3c7";
}

export function memoryColor(availableMb: number): string {
  if (availableMb < 2048) return "#f08b82";
  if (availableMb < 4096) return "#efbd72";
  return "#b7a5f8";
}

export function fmtFreq(mhz: number, digits = 2): string {
  return mhz > 0 ? `${(mhz / 1000).toFixed(digits)} GHz` : "—";
}

/** GPU temperature scale: green below 60, amber to 75, red above. */
export function tempColor(c: number): string {
  if (c >= 75) return "#f08b82";
  if (c >= 60) return "#efbd72";
  return "#72c6a5";
}

export function fmtPct(v: number): string {
  return Math.round(v).toString();
}

export function fmtMem(mb: number): { value: string; unit: string } {
  if (mb >= 1024) return { value: (mb / 1024).toFixed(1), unit: "GB" };
  return { value: Math.round(mb).toString(), unit: "MB" };
}

export function fmtBps(bps: number): string {
  if (bps >= 1024 * 1024) return `${(bps / 1048576).toFixed(1)} MB/s`;
  if (bps >= 1024) return `${(bps / 1024).toFixed(0)} KB/s`;
  return `${bps.toFixed(0)} B/s`;
}

export function fmtUptime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}
