import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { useStats, series } from "../hooks/useStats";
import { useGlass } from "../hooks/useGlass";
import { diagnose } from "../diagnose";
import { fmtPct, fmtMem, fmtUptime, type Stats } from "../types";
import MetricCard from "../components/MetricCard";
import CoreBars from "../components/CoreBars";
import Ring from "../components/Ring";

const win = getCurrentWebviewWindow();
const EXPANDED = { w: 310, h: 318 };
const COLLAPSED = { w: 150, h: 46 };
const SEEN_KEY = "cadpulse-seen-dashboard";

export default function Hud() {
  const { latest, history } = useStats();
  const glass = useGlass();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const { w, h } = collapsed ? COLLAPSED : EXPANDED;
    win.setSize(new LogicalSize(w, h)).catch(() => {});
  }, [collapsed]);

  // First launch ever: open the dashboard once so the full feature set is
  // discoverable (the HUD alone undersells it).
  useEffect(() => {
    try {
      if (!localStorage.getItem(SEEN_KEY)) {
        localStorage.setItem(SEEN_KEY, "1");
        invoke("open_dashboard").catch(() => {});
      }
    } catch {
      /* storage unavailable */
    }
  }, []);

  const diag = useMemo(() => diagnose(history), [history]);
  const cpuData = useMemo(() => series(history, (s) => s.cpu_single_pct, 60), [history]);
  const memData = useMemo(() => series(history, (s) => s.mem_mb, 60), [history]);
  const memMax = useMemo(() => Math.max(1024, ...memData.map((v) => v * 1.15)), [memData]);
  const cpuPeak = useMemo(
    () => (cpuData.length ? Math.max(...cpuData.slice(-30)) : 0),
    [cpuData]
  );

  const cls = `hud-content ${glass ? "glass" : ""}`;

  if (!latest) {
    return (
      <div className={cls}>
        <div className="hud-root grid-bg">
          <div className="waiting">
            <span className="ring-idle" style={{ display: "inline-block" }}>
              <Ring pct={25} size={30} color="#8b5cf6" />
            </span>
            <span className="label">CAD PULSE 启动中…</span>
          </div>
        </div>
      </div>
    );
  }

  // ---- collapsed mini bar ------------------------------------------------
  if (collapsed) {
    return (
      <div className={cls}>
        <div className="hud-mini grid-bg" data-tauri-drag-region>
          <Ring
            pct={latest.running ? latest.cpu_single_pct : 0}
            size={26}
            width={3.5}
            color={ringColor(latest, diag.tone)}
          />
          <span className="num">{latest.running ? `${fmtPct(latest.cpu_single_pct)}%` : "—"}</span>
          <span className={`dot ${diag.tone}`} style={{ marginLeft: "auto" }} />
          <button className="icon-btn" title="展开" onClick={() => setCollapsed(false)}>
            ▤
          </button>
        </div>
      </div>
    );
  }

  // ---- expanded ----------------------------------------------------------
  const mem = fmtMem(latest.mem_mb);
  return (
    <div className={cls}>
      <div className="hud-root grid-bg">
        <div className="hud-titlebar" data-tauri-drag-region>
          <span className="hud-logo">⬢</span>
          <span className="hud-title">CAD Pulse</span>
          {latest.demo && <span className="badge-demo">演示</span>}
          <div style={{ marginLeft: "auto" }} data-tauri-drag-region>
            <button
              className="icon-btn"
              title="打开详情面板（托盘左键同效）"
              onClick={() => invoke("open_dashboard")}
            >
              ▣
            </button>
            <button className="icon-btn" title="折叠" onClick={() => setCollapsed(true)}>
              ─
            </button>
            <button className="icon-btn" title="隐藏悬浮窗（托盘可找回）" onClick={() => win.hide()}>
              ✕
            </button>
          </div>
        </div>

        <div className="status-line" onClick={() => invoke("open_dashboard")} title="点击打开详情面板">
          <span className={`dot ${diag.tone}`} />
          <span className="status-text">{latest.running ? diag.title : "等待 AutoCAD…"}</span>
          <span className="status-arrow">›</span>
        </div>

        {latest.running ? (
          <>
            <div className="hud-cards">
              <MetricCard
                label="CPU 单核"
                value={fmtPct(latest.cpu_single_pct)}
                animValue={latest.cpu_single_pct}
                format={(v) => fmtPct(v)}
                unit="%"
                color="var(--cpu)"
                data={cpuData}
                max={100}
                sub={`总量 ${fmtPct(latest.cpu_total_pct)}% · 峰 ${fmtPct(cpuPeak)}%`}
                autoSpark
              />
              <MetricCard
                label="MEM"
                value={mem.value}
                animValue={latest.mem_mb}
                format={(v) => (v >= 1024 ? (v / 1024).toFixed(1) : v.toFixed(0))}
                unit={latest.mem_mb >= 1024 ? "GB" : "MB"}
                color="var(--mem)"
                data={memData}
                max={memMax}
                sub={`可用 ${fmtMem(latest.sys_mem_avail_mb).value}G`}
                autoSpark
              />
            </div>

            <div className="cores-strip">
              <span className="label" style={{ flex: "none" }}>{latest.cores.length} 核</span>
              <CoreBars cores={latest.cores} height={30} gap={2} />
            </div>

            <div className="hud-strip">
              <span className="strip-item">
                GPU
                {latest.gpu_pct != null ? (
                  <>
                    <Ring pct={latest.gpu_pct} size={14} width={2} color="var(--gpu)" />
                    <span className="num">{fmtPct(latest.gpu_pct)}%</span>
                  </>
                ) : (
                  <span>—</span>
                )}
              </span>
              {latest.gpu_temp_c != null && (
                <span className="strip-item">
                  <span className="num">{latest.gpu_temp_c}°</span>
                </span>
              )}
              <span className="strip-item freq-pill" title="最高核实时频率（睿频）">
                <span className="num">{(latest.cpu_freq_mhz / 1000).toFixed(1)}</span>
                <span className="unit">GHz</span>
              </span>
              <span className="strip-item">
                SYS
                <span className="num">{fmtPct(latest.sys_cpu_pct)}%</span>
              </span>
              <span className="strip-item" style={{ marginLeft: "auto" }}>
                ⏱ <span className="num">{fmtUptime(latest.uptime_sec)}</span>
              </span>
            </div>
          </>
        ) : (
          <div className="waiting" style={{ flex: 1 }}>
            <span className="ring-idle" style={{ display: "inline-block" }}>
              <Ring pct={12} size={34} color="#8b5cf6" />
            </span>
            <span className="label">等待 AutoCAD 启动…</span>
            <span style={{ fontSize: 11, color: "var(--text-faint)" }}>
              系统 CPU {fmtPct(latest.sys_cpu_pct)}% · 可用内存 {fmtMem(latest.sys_mem_avail_mb).value} GB
            </span>
            <CoreBars cores={latest.cores} height={30} gap={2} />
            {!latest.demo && (
              <button
                className="pill-btn"
                style={{ marginTop: 6 }}
                onClick={() => invoke("set_demo", { on: true })}
              >
                ▶ 试试演示模式
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ringColor(s: Stats, tone: string): string {
  if (!s.running) return "#8b8ab0";
  if (tone === "danger") return "var(--danger)";
  if (tone === "warn") return "var(--warn)";
  if (s.cpu_single_pct < 50) return "#8b5cf6";
  return "var(--warn)";
}
