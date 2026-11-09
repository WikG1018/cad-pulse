import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { useStats, series } from "../hooks/useStats";
import { useGlass } from "../hooks/useGlass";
import { diagnose } from "../diagnose";
import { fmtPct, fmtMem, coreColor, gpuLoadColor, memoryColor } from "../types";
import Sparkline from "../components/Sparkline";
import Ring from "../components/Ring";
import Icon, { BrandMark } from "../components/Icons";

const win = getCurrentWebviewWindow();
const EXPANDED = { w: 320, h: 252 };
const COLLAPSED = { w: 176, h: 48 };
const SEEN_KEY = "cadpulse-seen-dashboard";

export default function Hud() {
  const { latest, history } = useStats();
  const glass = useGlass();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const { w, h } = collapsed ? COLLAPSED : EXPANDED;
    win.setSize(new LogicalSize(w, h)).catch(() => {});
  }, [collapsed]);

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
  const cls = `hud-content ${glass ? "glass" : ""}`;

  if (!latest) {
    return (
      <div className={cls}>
        <div className="hud-root">
          <HudHeader demo={false} onCollapse={() => setCollapsed(true)} />
          <div className="hud-waiting"><BrandMark /><strong>正在启动</strong><p>正在连接性能监测服务…</p></div>
        </div>
      </div>
    );
  }

  if (collapsed) {
    return (
      <div className={cls}>
        <div className="hud-mini" data-tauri-drag-region>
          <Ring pct={latest.running ? latest.cpu_single_pct : 0} size={28} width={3} color={latest.running ? coreColor(latest.cpu_single_pct) : "#657188"} track="#303b4c" />
          <div className="mini-reading"><span className="num">{latest.running ? `${fmtPct(latest.cpu_single_pct)}%` : "—"}</span><span>单核</span></div>
          <span className={`status-dot ${latest.running ? diag.tone : "muted"}`} />
          <button className="icon-btn" title="展开悬浮窗" aria-label="展开悬浮窗" onClick={() => setCollapsed(false)}><Icon name="expand" /></button>
        </div>
      </div>
    );
  }

  const mem = fmtMem(latest.mem_mb);
  const available = fmtMem(latest.sys_mem_avail_mb);
  const cpuColor = coreColor(latest.cpu_single_pct);
  const gpuColor = gpuLoadColor(latest.gpu_pct ?? 0);
  const memColor = memoryColor(latest.sys_mem_avail_mb);
  return (
    <div className={cls}>
      <div className="hud-root">
        <HudHeader demo={latest.demo} onCollapse={() => setCollapsed(true)} />
        <button className="hud-status" onClick={() => invoke("open_dashboard")} title="打开性能详情">
          <span className={`status-dot ${latest.running ? diag.tone : "muted"}`} />
          <span>{latest.running ? diag.title : "等待 AutoCAD 启动"}</span>
          <span className="hud-status-link">详情 <Icon name="arrow" size={12} /></span>
        </button>

        {latest.running ? (
          <>
            <section className="hud-primary" aria-label={`CPU 单核负载 ${fmtPct(latest.cpu_single_pct)}%`}>
              <div className="hud-primary-label"><span>CPU 单核负载</span><span>近 60 秒</span></div>
              <div className="hud-primary-main">
                <div className="hud-reading" style={{ color: cpuColor }}><span className="num">{fmtPct(latest.cpu_single_pct)}</span><span className="num">%</span></div>
                <Sparkline data={cpuData} color={cpuColor} height={62} max={Math.max(100, ...cpuData)} />
              </div>
              <div className="hud-primary-caption"><span>100% = 一个核心满载</span><span>总量 <b className="num">{fmtPct(latest.cpu_total_pct)}%</b></span></div>
            </section>
            <div className="hud-stats">
              <HudStat label="AutoCAD 内存" value={mem.value} unit={mem.unit} color={memColor} />
              <HudStat label={latest.gpu_pct == null ? "GPU · 不可用" : "GPU 负载"} value={latest.gpu_pct == null ? "—" : fmtPct(latest.gpu_pct)} unit={latest.gpu_pct == null ? undefined : "%"} color={latest.gpu_pct == null ? undefined : gpuColor} />
              <HudStat label="最高实时频率" value={latest.cpu_freq_mhz > 0 ? (latest.cpu_freq_mhz / 1000).toFixed(2) : "—"} unit={latest.cpu_freq_mhz > 0 ? "GHz" : undefined} />
            </div>
          </>
        ) : (
          <>
            <div className="hud-waiting">
              <BrandMark />
              <strong>等待 AutoCAD</strong>
              <p>启动后自动监测，无需手动配置</p>
              {!latest.demo && <button className="text-btn hud-demo" onClick={() => invoke("set_demo", { on: true })}><Icon name="play" size={12} /> 试试演示模式</button>}
            </div>
            <div className="hud-stats hud-system-stats">
              <HudStat label="系统 CPU" value={fmtPct(latest.sys_cpu_pct)} unit="%" />
              <HudStat label="系统可用内存" value={available.value} unit={available.unit} />
              <HudStat label="监测状态" value="待机" />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function HudHeader({ demo, onCollapse }: { demo: boolean; onCollapse: () => void }) {
  return (
    <header className="hud-titlebar" data-tauri-drag-region>
      <BrandMark /><span className="hud-title">CAD Pulse</span>{demo && <span className="demo-badge">演示</span>}
      <div className="hud-actions">
        <button className="icon-btn" title="打开详情面板" aria-label="打开详情面板" onClick={() => invoke("open_dashboard")}><Icon name="dashboard" /></button>
        <button className="icon-btn" title="折叠" aria-label="折叠悬浮窗" onClick={onCollapse}><Icon name="collapse" /></button>
        <button className="icon-btn" title="隐藏悬浮窗（可从托盘找回）" aria-label="隐藏悬浮窗" onClick={() => win.hide()}><Icon name="close" /></button>
      </div>
    </header>
  );
}

function HudStat({ label, value, unit, color }: { label: string; value: string; unit?: string; color?: string }) {
  return <div className="hud-stat"><span className="hud-stat-label">{label}</span><div><span className="num hud-stat-value" style={{ color }}>{value}</span>{unit && <span className="num hud-stat-unit">{unit}</span>}</div></div>;
}
