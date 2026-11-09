import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { useStats, series } from "../hooks/useStats";
import { useGlass } from "../hooks/useGlass";
import { diagnose } from "../diagnose";
import { diagnosisText, useLanguage } from "../i18n";
import { fmtPct, fmtMem, fmtLatency, coreColor, gpuLoadColor, memoryColor, uiColor } from "../types";
import Sparkline from "../components/Sparkline";
import Ring from "../components/Ring";
import Icon, { BrandMark } from "../components/Icons";

const win = getCurrentWebviewWindow();
const EXPANDED = { w: 320, h: 252 };
const COLLAPSED = { w: 360, h: 48 };
const SEEN_KEY = "cadpulse-seen-dashboard";

export default function Hud() {
  const { latest, history } = useStats();
  const { t } = useLanguage();
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
  const diagText = diagnosisText(t, diag.level);
  const cpuData = useMemo(() => series(history, (s) => s.cpu_single_pct, 60), [history]);
  const cls = `hud-content ${glass ? "glass" : ""}`;

  if (!latest) {
    return (
      <div className={cls}>
        <div className="hud-root">
          <HudHeader demo={false} onCollapse={() => setCollapsed(true)} />
          <div className="hud-waiting"><BrandMark /><strong>{t.common.starting}</strong><p>{t.common.connecting}</p></div>
        </div>
      </div>
    );
  }

  const mem = fmtMem(latest.mem_mb);
  const available = fmtMem(latest.sys_mem_avail_mb);
  const cpuColor = coreColor(latest.cpu_single_pct);
  const gpuColor = gpuLoadColor(latest.gpu_pct ?? 0);
  const memColor = memoryColor(latest.sys_mem_avail_mb);
  const miniMem = latest.running ? mem : available;
  const stalled = latest.ui_responsive === false;
  const uiLabel = latest.ui_responsive == null
    ? t.dash.uiUnmeasured
    : stalled
      ? `${t.dash.uiStalled} ${latest.ui_stall_sec}s`
      : `${t.dash.uiOk} ${fmtLatency(latest.ui_response_ms ?? 0)}`;

  if (collapsed) {
    return (
      <div className={cls}>
        <div className="hud-mini" aria-label={t.hud.statusBarAria} onMouseDown={(event) => {
          if (event.button === 0 && !(event.target as HTMLElement).closest("button")) {
            win.startDragging().catch(() => {});
          }
        }}>
          <div className="mini-cpu" title={`${t.hud.processCpuAria}: ${latest.running ? `${fmtPct(latest.cpu_single_pct)}%` : "—"} · ${t.hud.busiestThreadShort}: ${latest.busiest_thread_pct != null ? `${fmtPct(latest.busiest_thread_pct)}%` : "—"}`}>
            <Ring pct={latest.running ? latest.cpu_single_pct : 0} size={26} width={3} color={latest.running ? cpuColor : "#657188"} track="#303b4c" />
            <div className="mini-reading"><span className="num">{latest.running ? `${fmtPct(latest.cpu_single_pct)}%` : "—"}</span><span>{t.hud.cpuShort}</span></div>
          </div>
          <MiniStat label="GPU" value={latest.gpu_pct == null ? "—" : fmtPct(latest.gpu_pct)} unit={latest.gpu_pct == null ? undefined : "%"} color={latest.gpu_pct == null ? undefined : gpuColor} />
          <MiniStat label={latest.running ? t.hud.memoryShort : t.hud.availableShort} value={miniMem.value} unit={miniMem.unit} color={memColor} title={latest.running ? t.hud.autocadMemory : t.hud.systemAvailable} />
          {/* During a freeze the stall age matters more than the clock, so it
              takes the same slot instead of widening the 360 px bar. */}
          {stalled ? (
            <MiniStat label={t.hud.stallShort} value={String(latest.ui_stall_sec)} unit="s" color={uiColor(false, latest.ui_stall_sec)} title={t.hud.stallAria} />
          ) : (
            <MiniStat label={t.hud.frequencyShort} value={latest.cpu_freq_mhz > 0 ? (latest.cpu_freq_mhz / 1000).toFixed(2) : "—"} unit={latest.cpu_freq_mhz > 0 ? "GHz" : undefined} />
          )}
          <span className={`status-dot ${latest.running ? diag.tone : "muted"}`} title={latest.running ? `${diagText.title} · ${uiLabel}` : t.common.notRunning} />
          <button className="icon-btn" title={t.common.expand} aria-label={t.common.expand} onClick={() => setCollapsed(false)}><Icon name="expand" /></button>
        </div>
      </div>
    );
  }

  return (
    <div className={cls}>
      <div className="hud-root">
        <HudHeader demo={latest.demo} onCollapse={() => setCollapsed(true)} />
        <button className="hud-status" onClick={() => invoke("open_dashboard")} title={`${t.common.openDashboard} · ${uiLabel}`}>
          <span className={`status-dot ${latest.running ? diag.tone : "muted"}`} />
          <span>{latest.running ? diagText.title : t.hud.waitingTitle}</span>
          <span className="hud-status-link">{t.common.details} <Icon name="arrow" size={12} /></span>
        </button>

        {latest.running ? (
          <>
            <section className="hud-primary" aria-label={`${t.hud.processCpuAria} ${fmtPct(latest.cpu_single_pct)}%`}>
              <div className="hud-primary-label"><span>{t.hud.processCpu}</span><span>{t.hud.last60}</span></div>
              <div className="hud-primary-main">
                <div className="hud-reading" style={{ color: cpuColor }}><span className="num">{fmtPct(latest.cpu_single_pct)}</span><span className="num">%</span></div>
                <Sparkline data={cpuData} color={cpuColor} height={62} max={Math.max(100, ...cpuData)} />
              </div>
              <div className="hud-primary-caption"><span>{t.hud.coreEquivalent}</span><span title={latest.busiest_thread_id != null ? `TID ${latest.busiest_thread_id}` : undefined}>{t.hud.busiestThreadShort} <b className="num" style={{ color: latest.busiest_thread_pct != null ? coreColor(latest.busiest_thread_pct) : undefined }}>{latest.busiest_thread_pct != null ? `${fmtPct(latest.busiest_thread_pct)}%` : "—"}</b> · {t.hud.normalized} <b className="num">{fmtPct(latest.cpu_total_pct)}%</b></span></div>
            </section>
            <div className="hud-stats">
              <HudStat label={t.hud.autocadMemory} value={mem.value} unit={mem.unit} color={memColor} />
              <HudStat label={latest.gpu_pct == null ? t.hud.gpuUnavailable : t.hud.gpuLoad} value={latest.gpu_pct == null ? "—" : fmtPct(latest.gpu_pct)} unit={latest.gpu_pct == null ? undefined : "%"} color={latest.gpu_pct == null ? undefined : gpuColor} />
              <HudStat label={t.hud.frequency} value={latest.cpu_freq_mhz > 0 ? (latest.cpu_freq_mhz / 1000).toFixed(2) : "—"} unit={latest.cpu_freq_mhz > 0 ? "GHz" : undefined} />
            </div>
          </>
        ) : (
          <>
            <div className="hud-waiting">
              <BrandMark />
              <strong>{t.hud.waitingTitle}</strong>
              <p>{t.hud.waitingDescription}</p>
              {!latest.demo && <button className="text-btn hud-demo" onClick={() => invoke("set_demo", { on: true })}><Icon name="play" size={12} /> {t.hud.tryDemo}</button>}
            </div>
            <div className="hud-stats hud-system-stats">
              <HudStat label={t.hud.systemCpu} value={fmtPct(latest.sys_cpu_pct)} unit="%" />
              <HudStat label={t.hud.systemAvailable} value={available.value} unit={available.unit} />
              <HudStat label={t.hud.monitorState} value={t.hud.idle} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function HudHeader({ demo, onCollapse }: { demo: boolean; onCollapse: () => void }) {
  const { t } = useLanguage();
  return (
    <header className="hud-titlebar" data-tauri-drag-region>
      <BrandMark /><span className="hud-title">CAD Pulse</span>{demo && <span className="demo-badge">{t.common.demo}</span>}
      <div className="hud-actions">
        <button className="icon-btn" title={t.common.openDashboard} aria-label={t.common.openDashboard} onClick={() => invoke("open_dashboard")}><Icon name="dashboard" /></button>
        <button className="icon-btn" title={t.common.collapse} aria-label={t.common.collapse} onClick={onCollapse}><Icon name="collapse" /></button>
        <button className="icon-btn" title={t.common.hideHudTitle} aria-label={t.common.hideHudAria} onClick={() => win.hide()}><Icon name="close" /></button>
      </div>
    </header>
  );
}

function MiniStat({ label, value, unit, color, title }: { label: string; value: string; unit?: string; color?: string; title?: string }) {
  const fullValue = `${value}${unit ? ` ${unit}` : ""}`;
  return <div className="mini-stat" title={`${title ?? label}: ${fullValue}`}><span className="mini-stat-label">{label}</span><div><strong className="num mini-stat-value" style={{ color }}>{value}</strong>{unit && <span className="num mini-stat-unit">{unit}</span>}</div></div>;
}

function HudStat({ label, value, unit, color }: { label: string; value: string; unit?: string; color?: string }) {
  const fullValue = `${value}${unit ? ` ${unit}` : ""}`;
  return <div className="hud-stat" title={`${label}: ${fullValue}`}><span className="hud-stat-label">{label}</span><div><span className="num hud-stat-value" style={{ color }}>{value}</span>{unit && <span className="num hud-stat-unit">{unit}</span>}</div></div>;
}
