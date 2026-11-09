import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useStats, series } from "../hooks/useStats";
import { useGlass } from "../hooks/useGlass";
import { diagnose } from "../diagnose";
import { useEventLog, EventLogView } from "../components/EventLog";
import { fmtPct, fmtMem, fmtBps, fmtUptime, tempColor, type Stats } from "../types";
import MetricCard from "../components/MetricCard";
import CoreBars from "../components/CoreBars";
import Ring from "../components/Ring";

const win = getCurrentWebviewWindow();
type CpuScale = "single" | "total";
type Range = 300 | 1800;

export default function Dashboard() {
  const { latest, history } = useStats();
  const glass = useGlass();
  const events = useEventLog(history);
  const [sampleMs, setSampleMs] = useState(1000);
  const [scale, setScale] = useState<CpuScale>("single");
  const [range, setRange] = useState<Range>(300);
  const [copied, setCopied] = useState(false);

  const diag = useMemo(() => diagnose(history), [history]);
  const cpuData = useMemo(
    () => series(history, (s) => (scale === "single" ? s.cpu_single_pct : s.cpu_total_pct), range),
    [history, scale, range]
  );
  const coreData = useMemo(() => series(history, (s) => s.busiest_core_pct, range), [history, range]);
  const memData = useMemo(() => series(history, (s) => s.mem_mb, range), [history, range]);
  const memMax = useMemo(() => Math.max(1024, ...memData.map((v) => v * 1.15)), [memData]);
  const gpuData = useMemo(() => series(history, (s) => s.gpu_pct, range), [history, range]);
  const availData = useMemo(() => series(history, (s) => s.sys_mem_avail_mb, range), [history, range]);
  const availMax = useMemo(() => Math.max(4096, ...availData.map((v) => v * 1.2)), [availData]);

  const stats5 = (data: number[]) => {
    const w = data.slice(-300);
    if (!w.length) return { peak: 0, avg: 0 };
    return { peak: Math.max(...w), avg: w.reduce((a, b) => a + b, 0) / w.length };
  };
  const cpu5 = stats5(cpuData);
  const mem5 = stats5(memData);
  const gpu5 = stats5(gpuData);

  if (!latest) {
    return (
      <div className={glass ? "glass" : ""}>
        <div className="dash-root grid-bg">
          <div className="waiting">
            <span className="label">CAD PULSE 启动中…</span>
          </div>
        </div>
      </div>
    );
  }

  const mem = fmtMem(latest.mem_mb);
  const gpuMissing = latest.gpu_pct == null;

  const copySummary = async () => {
    const text = buildSummary(latest, { cpu5, mem5, gpu5 }, diag);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className={glass ? "glass" : ""}>
      <div className="dash-root">
        {/* ---- title bar (frameless, self-drawn) ---- */}
        <div className="dash-titlebar" data-tauri-drag-region>
          <span className="hud-logo">⬢</span>
          <span className="dash-title">CAD Pulse</span>
          <span className="pill">
            <span className={`dot ${latest.running ? diag.tone : "muted"}`} />
            {latest.running ? `acad.exe · PID ${latest.pid}` : "AutoCAD 未运行"}
            {latest.demo && <span className="badge-demo" style={{ marginLeft: 6 }}>演示</span>}
          </span>
          <div className="dash-toolbar" data-tauri-drag-region>
            <div className="segment" title="曲线时间范围">
              <button className={range === 300 ? "active" : ""} onClick={() => setRange(300)}>
                5min
              </button>
              <button className={range === 1800 ? "active" : ""} onClick={() => setRange(1800)}>
                30min
              </button>
            </div>
            <select
              className="pill"
              value={sampleMs}
              onChange={(e) => {
                const ms = Number(e.target.value);
                setSampleMs(ms);
                invoke("set_sample_interval", { ms }).catch(() => {});
              }}
              title="采样间隔"
            >
              <option value={500}>0.5s</option>
              <option value={1000}>1s</option>
              <option value={2000}>2s</option>
            </select>
            <div className="segment" title="CPU 口径：单核 = 100% 为一核满载；总量 = 任务管理器口径">
              <button className={scale === "single" ? "active" : ""} onClick={() => setScale("single")}>
                单核口径
              </button>
              <button className={scale === "total" ? "active" : ""} onClick={() => setScale("total")}>
                总量口径
              </button>
            </div>
            <button
              className={`pill-btn ${latest.demo ? "primary" : ""}`}
              title="无 AutoCAD 时用模拟数据体验界面"
              onClick={() => invoke("set_demo", { on: !latest.demo })}
            >
              {latest.demo ? "演示中 ✓" : "演示模式"}
            </button>
            <button className="pill-btn primary" onClick={copySummary}>
              {copied ? "已复制 ✓" : "复制摘要"}
            </button>
            <button className="icon-btn" title="最小化" onClick={() => win.minimize()}>
              ─
            </button>
            <button className="icon-btn" title="关闭（后台继续监控）" onClick={() => win.hide()}>
              ✕
            </button>
          </div>
        </div>

        {/* ---- body ---- */}
        <div className="dash-body grid-bg">
          <div className="dash-grid">
            <MetricCard
              label="CPU"
              value={fmtPct(scale === "single" ? latest.cpu_single_pct : latest.cpu_total_pct)}
              animValue={scale === "single" ? latest.cpu_single_pct : latest.cpu_total_pct}
              format={(v) => fmtPct(v)}
              unit="%"
              color="var(--cpu)"
              data={cpuData}
              max={scale === "single" ? Math.max(100, ...cpuData) : 100}
              big
              index={0}
              sub={scale === "single" ? "100% = 单核满载" : "任务管理器口径"}
              secondary={scale === "single" ? { data: coreData, max: 100 } : undefined}
              footer={
                <div className="card-stats">
                  <span>{scale === "single" ? "总量" : "单核"} <span className="num">{fmtPct(scale === "single" ? latest.cpu_total_pct : latest.cpu_single_pct)}%</span></span>
                  <span>峰值 <span className="num">{fmtPct(cpu5.peak)}%</span></span>
                  <span>均值 <span className="num">{fmtPct(cpu5.avg)}%</span></span>
                  <span>频率 <span className="num">{(latest.cpu_freq_mhz / 1000).toFixed(2)} GHz</span></span>
                </div>
              }
            />
            <MetricCard
              label="内存"
              value={mem.value}
              animValue={latest.mem_mb}
              format={(v) => (v >= 1024 ? (v / 1024).toFixed(1) : v.toFixed(0))}
              unit={latest.mem_mb >= 1024 ? "GB" : "MB"}
              color="var(--mem)"
              data={memData}
              max={memMax}
              big
              index={1}
              sub={`系统可用 ${fmtMem(latest.sys_mem_avail_mb).value} GB`}
              secondary={{ data: availData, max: availMax }}
              footer={
                <div className="card-stats">
                  <span>峰值 <span className="num">{fmtMem(mem5.peak).value} {fmtMem(mem5.peak).unit}</span></span>
                  <span>均值 <span className="num">{fmtMem(mem5.avg).value} {fmtMem(mem5.avg).unit}</span></span>
                </div>
              }
            />
            <MetricCard
              label={gpuMissing ? "GPU · 不可用" : "GPU"}
              value={gpuMissing ? "—" : fmtPct(latest.gpu_pct ?? 0)}
              animValue={gpuMissing ? undefined : (latest.gpu_pct ?? 0)}
              format={(v) => fmtPct(v)}
              unit={gpuMissing ? undefined : "%"}
              color="var(--gpu)"
              data={gpuData.length ? gpuData : [0, 0]}
              max={100}
              big
              index={2}
              sub={
                gpuMissing ? (
                  "未检测到 NVIDIA"
                ) : (
                  <span>
                    <span style={{ color: tempColor(latest.gpu_temp_c ?? 0) }}>
                      {latest.gpu_temp_c ?? "?"}°C
                    </span>{" "}
                    · {(latest.gpu_clock_mhz ?? 0)} MHz
                  </span>
                )
              }
              footer={
                !gpuMissing ? (
                  <div className="card-stats">
                    <span>峰值 <span className="num">{fmtPct(gpu5.peak)}%</span></span>
                    <span>均值 <span className="num">{fmtPct(gpu5.avg)}%</span></span>
                    <span>显存 <span className="num">{((latest.gpu_mem_mb ?? 0) / 1024).toFixed(1)} GB</span></span>
                  </div>
                ) : undefined
              }
            />
          </div>

          {/* per-core live load */}
          <div className="dash-card cores-card" style={{ "--card-index": 3 } as React.CSSProperties}>
            <div className="cores-main">
              <div className="metric-head">
                <span className="label" style={{ color: "var(--text-dim)" }}>
                  每核实时负载 · {latest.cores.length} 逻辑核
                </span>
                <span className="metric-sub">单核满载而其余空闲 = AutoCAD 单线程特征</span>
              </div>
              <CoreBars cores={latest.cores} height={64} gap={4} showNumbers />
            </div>
            <div className="cores-side">
              <div className="side-stat">
                <span className="num" style={{ color: "var(--cpu)" }}>{fmtPct(latest.busiest_core_pct)}%</span>
                <span className="label">最忙核</span>
              </div>
              <div className="side-stat">
                <span className="num" style={{ color: "var(--mem)" }}>{fmtPct(latest.sys_cpu_pct)}%</span>
                <span className="label">系统 CPU</span>
              </div>
              <div className="side-stat">
                <span
                  className="num"
                  style={{ color: latest.gpu_temp_c != null ? tempColor(latest.gpu_temp_c) : "var(--text-faint)" }}
                >
                  {latest.gpu_temp_c != null ? `${latest.gpu_temp_c}°C` : "—"}
                </span>
                <span className="label">GPU 温度</span>
              </div>
            </div>
          </div>

          <div className="dash-bottom">
            <div className="diag-card-wrap">
              <div className={`diag-card ${diag.tone}`} style={{ "--card-index": 4 } as React.CSSProperties}>
                <div className="diag-head">
                  <span className={`dot ${diag.tone}`} />
                  <span className="diag-title">诊断 · {latest.running ? diag.title : "等待 AutoCAD…"}</span>
                  {latest.running && (
                    <span className="metric-sub" style={{ marginLeft: "auto" }}>
                      IO <span className="num">↓{fmtBps(latest.io_read_bps)}</span>{" "}
                      <span className="num">↑{fmtBps(latest.io_write_bps)}</span> · ⏱{" "}
                      <span className="num">{fmtUptime(latest.uptime_sec)}</span>
                    </span>
                  )}
                </div>
                {diag.advice.length > 0 && (
                  <ul className="diag-advice">
                    {diag.advice.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="cheat-card" style={{ marginTop: 12, "--card-index": 5 } as React.CSSProperties}>
                <span className="label">图纸卡顿速查</span>
                <div className="cheat-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginTop: 8 }}>
                  <CheatItem cmd="-PURGE" desc="选 R 清 Regapps" />
                  <CheatItem cmd="SCALELISTEDIT" desc="重置注释比例" />
                  <CheatItem cmd="AUDIT" desc="修复图纸错误" />
                  <CheatItem cmd="GFXDX12=0" desc="DX11 回退" />
                  <CheatItem cmd="LAYOUTREGENCTL=1" desc="切布局不重生成" />
                  <CheatItem cmd="天正·图形导出" desc="拍平代理对象" />
                </div>
              </div>
            </div>

            <div className="diag-card" style={{ "--card-index": 6 } as React.CSSProperties}>
              <div className="diag-head">
                <span className="label">事件日志</span>
                <Ring
                  pct={events.length ? 100 : 8}
                  size={14}
                  width={2}
                  color={events.length ? "var(--brand)" : "#8b8ab0"}
                />
              </div>
              <EventLogView events={events} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CheatItem({ cmd, desc }: { cmd: string; desc: string }) {
  return (
    <div className="cheat-item">
      <span className="cheat-cmd">{cmd}</span>
      <span className="cheat-desc">{desc}</span>
    </div>
  );
}

function buildSummary(
  s: Stats,
  peaks: { cpu5: { peak: number; avg: number }; mem5: { peak: number; avg: number }; gpu5: { peak: number; avg: number } },
  diag: ReturnType<typeof diagnose>,
): string {
  const t = new Date().toLocaleString("zh-CN");
  const gpu = s.gpu_pct != null
    ? `${fmtPct(s.gpu_pct)}% (${s.gpu_temp_c ?? "?"}°C, 显存 ${((s.gpu_mem_mb ?? 0) / 1024).toFixed(1)}GB)`
    : "不可用";
  return [
    `CAD Pulse 摘要 @ ${t}`,
    s.running
      ? `进程: acad.exe (PID ${s.pid}) 已运行 ${fmtUptime(s.uptime_sec)}`
      : "进程: AutoCAD 未运行",
    `CPU: ${fmtPct(s.cpu_single_pct)}%（单核口径）/ ${fmtPct(s.cpu_total_pct)}%（总量口径）· 最忙核 ${fmtPct(s.busiest_core_pct)}% · ${(s.cpu_freq_mhz / 1000).toFixed(2)} GHz`,
    `     近5min 峰值 ${fmtPct(peaks.cpu5.peak)}% · 均值 ${fmtPct(peaks.cpu5.avg)}%`,
    `内存: ${fmtMem(s.mem_mb).value} ${fmtMem(s.mem_mb).unit} · 峰值 ${fmtMem(peaks.mem5.peak).value} ${fmtMem(peaks.mem5.peak).unit} · 系统可用 ${fmtMem(s.sys_mem_avail_mb).value} GB`,
    `GPU: ${gpu}`,
    `系统: CPU ${fmtPct(s.sys_cpu_pct)}% · IO ↓${fmtBps(s.io_read_bps)} ↑${fmtBps(s.io_write_bps)}`,
    `诊断: ${diag.title}`,
    ...diag.advice.map((a) => `  · ${a}`),
  ].join("\n");
}
