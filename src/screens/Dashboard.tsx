import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useStats, series } from "../hooks/useStats";
import { useGlass } from "../hooks/useGlass";
import { diagnose } from "../diagnose";
import { diagnosisText, useLanguage, type Language, type Messages } from "../i18n";
import { useEventLog, EventLogView } from "../components/EventLog";
import { fmtPct, fmtMem, fmtBps, fmtUptime, fmtFreq, tempColor, coreColor, gpuLoadColor, memoryColor, type Stats } from "../types";
import MetricCard from "../components/MetricCard";
import CoreBars from "../components/CoreBars";
import Icon, { BrandMark } from "../components/Icons";

const win = getCurrentWebviewWindow();
type CpuScale = "single" | "total";
type Range = 300 | 1800;
type CopyStatus = "idle" | "copied" | "error";

export default function Dashboard() {
  const { latest, history } = useStats();
  const { lang, t, setLanguage } = useLanguage();
  const glass = useGlass();
  const events = useEventLog(history);
  const [sampleMs, setSampleMs] = useState(1000);
  const [scale, setScale] = useState<CpuScale>("single");
  const [range, setRange] = useState<Range>(300);
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");

  const diag = useMemo(() => diagnose(history), [history]);
  const diagText = diagnosisText(t, diag.level);
  const cpuValue = (s: Stats) => scale === "single" ? s.cpu_single_pct : s.cpu_total_pct;
  const cpuData = useMemo(() => series(history, cpuValue, range), [history, scale, range]);
  const coreData = useMemo(() => series(history, (s) => s.busiest_core_pct, range), [history, range]);
  const memData = useMemo(() => series(history, (s) => s.mem_mb, range), [history, range]);
  const memMax = useMemo(() => Math.max(1024, ...memData.map((v) => v * 1.15)), [memData]);
  const gpuData = useMemo(() => series(history, (s) => s.gpu_pct, range), [history, range]);
  const availData = useMemo(() => series(history, (s) => s.sys_mem_avail_mb, range), [history, range]);
  const availMax = useMemo(() => Math.max(4096, ...availData.map((v) => v * 1.2)), [availData]);
  const cpu5 = useMemo(() => stats(series(history, cpuValue, 300)), [history, scale]);
  const mem5 = useMemo(() => stats(series(history, (s) => s.mem_mb, 300)), [history]);
  const gpu5 = useMemo(() => stats(series(history, (s) => s.gpu_pct, 300)), [history]);

  if (!latest) {
    return <div className={glass ? "glass" : ""}><div className="dash-root"><div className="dash-loading"><BrandMark /><strong>CAD Pulse</strong><span>{t.common.connecting}</span></div></div></div>;
  }

  const mem = fmtMem(latest.mem_mb);
  const available = fmtMem(latest.sys_mem_avail_mb);
  const gpuMissing = latest.gpu_pct == null;
  const cpuColor = latest.running ? coreColor(cpuValue(latest)) : "#8d99ac";
  const memColor = memoryColor(latest.sys_mem_avail_mb);
  const gpuColor = gpuLoadColor(latest.gpu_pct ?? 0);
  const gpuModel = latest.gpu_model ?? t.dash.noNvidia;
  const cpuModel = latest.cpu_model || t.dash.unknownCpu;

  const copySummary = async () => {
    try {
      await navigator.clipboard.writeText(buildSummary(latest, { cpu5, mem5, gpu5 }, diagText, scale, lang, t));
      setCopyStatus("copied");
    } catch {
      setCopyStatus("error");
    }
    setTimeout(() => setCopyStatus("idle"), 2000);
  };

  return (
    <div className={glass ? "glass" : ""}>
      <div className="dash-root">
        <header className="dash-titlebar" data-tauri-drag-region>
          <div className="dash-brand"><BrandMark /><div><strong>CAD Pulse</strong><span>{t.hud.subtitle}</span></div></div>
          <div className="process-status"><span className={`status-dot ${latest.running ? diag.tone : "muted"}`} /><span>{latest.running ? t.common.running : t.common.notRunning}</span>{latest.running && <span className="num process-pid">PID {latest.pid}</span>}{latest.demo && <span className="demo-badge">{t.common.demo}</span>}</div>
          <div className="window-actions">
            <button className="text-btn language-btn" title={t.common.languageSwitch} aria-label={t.common.languageSwitch} onClick={() => setLanguage(lang === "zh-CN" ? "en-US" : "zh-CN")}>{lang === "zh-CN" ? "EN" : "中"}</button>
            <button className={`text-btn${latest.demo ? " active" : ""}`} onClick={() => invoke("set_demo", { on: !latest.demo })}>{latest.demo ? <Icon name="check" /> : <Icon name="play" />}{latest.demo ? t.common.demoRunning : t.common.demoMode}</button>
            <button className="text-btn copy-btn" onClick={copySummary}><Icon name={copyStatus === "copied" ? "check" : "copy"} />{copyStatus === "copied" ? t.common.copied : copyStatus === "error" ? t.common.copyFailed : t.common.copySummary}</button>
            <span className="window-divider" />
            <button className="icon-btn" title={t.common.minimize} aria-label={t.common.minimize} onClick={() => win.minimize()}><Icon name="collapse" /></button>
            <button className="icon-btn" title={t.common.closeDashboardTitle} aria-label={t.common.closeDashboardAria} onClick={() => win.hide()}><Icon name="close" /></button>
          </div>
        </header>

        <main className="dash-body">
          <section className="overview-heading">
            <div><h1>{t.dash.overview}</h1><p>{t.dash.overviewSubtitle}</p></div>
            <div className="overview-controls">
              <div className="segment" role="group" aria-label={t.dash.rangeAria}>
                <button className={range === 300 ? "active" : ""} aria-pressed={range === 300} onClick={() => setRange(300)}>{t.dash.minutes5}</button>
                <button className={range === 1800 ? "active" : ""} aria-pressed={range === 1800} onClick={() => setRange(1800)}>{t.dash.minutes30}</button>
              </div>
              <label className="sample-control">{t.dash.sample}<select aria-label={t.dash.sampleAria} value={sampleMs} onChange={(e) => { const ms = Number(e.target.value); setSampleMs(ms); invoke("set_sample_interval", { ms }).catch(() => {}); }}><option value={500}>{t.dash.seconds05}</option><option value={1000}>{t.dash.seconds1}</option><option value={2000}>{t.dash.seconds2}</option></select></label>
              <div className="segment" role="group" aria-label={t.dash.scaleAria}>
                <button className={scale === "single" ? "active" : ""} aria-pressed={scale === "single"} onClick={() => setScale("single")}>{t.dash.coreEquivalent}</button>
                <button className={scale === "total" ? "active" : ""} aria-pressed={scale === "total"} onClick={() => setScale("total")}>{t.dash.normalized}</button>
              </div>
            </div>
          </section>

          <section className="hardware-bar" aria-label={t.dash.hardwareAria}>
            <div className="hardware-item cpu"><span className="hardware-kind">CPU</span><div><strong title={cpuModel}>{cpuModel}</strong><span>{topologyText(latest, t)}</span></div></div>
            <div className="hardware-item gpu"><span className="hardware-kind">GPU</span><div><strong title={gpuModel}>{gpuModel}</strong><span>{latest.gpu_model ? t.dash.nvmlGlobal : t.dash.gpuUnavailable}</span></div></div>
          </section>

          <div className={`metric-grid${gpuMissing ? " no-gpu" : ""}`}>
            <MetricCard
              primary
              label={scale === "single" ? t.dash.cpuCoreCard : t.dash.cpuTotalCard}
              value={latest.running ? fmtPct(cpuValue(latest)) : "—"}
              animValue={latest.running ? cpuValue(latest) : undefined}
              format={fmtPct}
              unit={latest.running ? "%" : undefined}
              color={cpuColor}
              data={cpuData}
              max={scale === "single" ? Math.max(100, ...cpuData) : 100}
              sub={latest.cpu_freq_mhz > 0 ? fmtFreq(latest.cpu_freq_mhz) : t.dash.frequencyUnavailable}
              secondary={scale === "single" ? { data: coreData, max: 100 } : undefined}
              footer={<div className="card-stats"><span title={latest.busiest_thread_id != null ? `TID ${latest.busiest_thread_id}` : undefined}>{t.dash.busiestThread}<b className="num" style={{ color: latest.busiest_thread_pct != null ? coreColor(latest.busiest_thread_pct) : undefined }}>{latest.busiest_thread_pct != null ? `${fmtPct(latest.busiest_thread_pct)}%` : "—"}</b></span><span>{scale === "single" ? t.dash.normalizedShort : t.dash.coreEquivalentShort}<b className="num">{latest.running ? `${fmtPct(scale === "single" ? latest.cpu_total_pct : latest.cpu_single_pct)}%` : "—"}</b></span><span>{t.dash.peak5}<b className="num">{latest.running ? `${fmtPct(cpu5.peak)}%` : "—"}</b></span><span>{t.dash.average5}<b className="num">{latest.running ? `${fmtPct(cpu5.avg)}%` : "—"}</b></span><span className="chart-legend">{t.dash.busiestDashed}</span></div>}
            />
            <MetricCard
              label={t.dash.autocadMemory}
              value={latest.running ? mem.value : "—"}
              animValue={latest.running ? latest.mem_mb : undefined}
              format={(v) => fmtMem(v).value}
              unit={latest.running ? mem.unit : undefined}
              color={memColor}
              data={memData}
              max={memMax}
              sub={`${t.dash.systemAvailable} ${available.value} ${available.unit}`}
              secondary={{ data: availData, max: availMax }}
              footer={<div className="card-stats"><span>{t.dash.peak5}<b className="num">{latest.running ? `${fmtMem(mem5.peak).value} ${fmtMem(mem5.peak).unit}` : "—"}</b></span><span>{t.dash.average}<b className="num">{latest.running ? `${fmtMem(mem5.avg).value} ${fmtMem(mem5.avg).unit}` : "—"}</b></span></div>}
            />
            {!gpuMissing && <MetricCard
              label={t.dash.gpuGlobal}
              value={fmtPct(latest.gpu_pct ?? 0)}
              animValue={latest.gpu_pct ?? undefined}
              format={fmtPct}
              unit="%"
              color={gpuColor}
              data={gpuData}
              max={100}
              sub={<span>{latest.gpu_temp_c != null ? <span style={{ color: tempColor(latest.gpu_temp_c) }}>{latest.gpu_temp_c}°C</span> : `${t.dash.temperature} —`} · {latest.gpu_clock_mhz != null ? `${latest.gpu_clock_mhz} MHz` : `${t.dash.clock} —`}</span>}
              footer={<div className="card-stats"><span>{t.dash.peak5}<b className="num">{fmtPct(gpu5.peak)}%</b></span><span>{t.dash.average}<b className="num">{fmtPct(gpu5.avg)}%</b></span><span>{t.dash.vram}<b className="num">{latest.gpu_mem_mb != null ? `${(latest.gpu_mem_mb / 1024).toFixed(1)} GB` : "—"}</b></span></div>}
            />}
          </div>

          <section className="panel cores-card">
            <div className="section-heading"><div><h2>{t.dash.perCore}</h2><p>{latest.cores.length} {t.dash.logicalCores} · {latest.core_types.length > 0 && latest.core_types.length === latest.cores.length ? t.dash.topologyAuto : t.dash.topologyUnavailable}</p></div><span className="load-legend"><span><i style={{ background: "#82a9ff" }} />{t.dash.normal}</span><span><i style={{ background: "#efbd72" }} />{t.dash.elevated}</span><span><i style={{ background: "#f08b82" }} />{t.dash.saturated}</span></span></div>
            <div className="cores-content">
              <CoreBars cores={latest.cores} coreTypes={latest.core_types} height={50} gap={5} showNumbers />
              <div className="cores-side"><SideStat label={t.dash.busiestCore} value={`${fmtPct(latest.busiest_core_pct)}%`} color={coreColor(latest.busiest_core_pct)} /><SideStat label={t.dash.systemCpu} value={`${fmtPct(latest.sys_cpu_pct)}%`} color={coreColor(latest.sys_cpu_pct)} />{latest.gpu_temp_c != null ? <SideStat label={t.dash.gpuTemperature} value={`${latest.gpu_temp_c}°C`} color={tempColor(latest.gpu_temp_c)} /> : <SideStat label={t.dash.systemAvailable} value={`${available.value} ${available.unit}`} color={memColor} />}</div>
            </div>
          </section>

          <div className="insight-grid">
            <section className={`panel diagnosis-panel ${diag.tone}`}>
              <div className="section-heading"><div className="diagnosis-title"><span className={`status-dot ${latest.running ? diag.tone : "muted"}`} /><h2>{latest.running ? diagText.title : t.common.waiting}</h2></div><span className="section-kicker">{t.dash.smartDiagnosis}</span></div>
              <div className="diagnosis-content">
                {diagText.advice.length > 0 && latest.running ? <ul className="diag-advice">{diagText.advice.map((advice) => <li key={advice}>{advice}</li>)}</ul> : <p className="diagnosis-ok">{latest.running ? t.dash.noBottleneck : t.dash.launchToAnalyze}</p>}
                <div className="process-facts"><span>{t.dash.diskRead}<b className="num">{latest.running ? fmtBps(latest.io_read_bps) : "—"}</b></span><span>{t.dash.diskWrite}<b className="num">{latest.running ? fmtBps(latest.io_write_bps) : "—"}</b></span><span>{t.dash.uptime}<b className="num">{latest.running ? fmtUptime(latest.uptime_sec) : "—"}</b></span></div>
              </div>
              <div className="command-section"><h3>{t.dash.quickCommands}</h3><div className="command-grid"><CheatItem cmd="-PURGE" desc={t.commands.purge} /><CheatItem cmd="SCALELISTEDIT" desc={t.commands.scale} /><CheatItem cmd="AUDIT" desc={t.commands.audit} /><CheatItem cmd="GFXDX12=0" desc={t.commands.dx11} /><CheatItem cmd="LAYOUTREGENCTL=1" desc={t.commands.layout} /><CheatItem cmd={t.commands.proxyCommand} desc={t.commands.proxy} /></div></div>
            </section>
            <section className="panel activity-panel"><div className="section-heading"><div><h2>{t.dash.eventLog}</h2><p>{t.dash.stored80}</p></div><span className="count-badge num">{events.length}</span></div><EventLogView events={events} /></section>
          </div>
        </main>
      </div>
    </div>
  );
}

function SideStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return <div className="side-stat" title={`${label}: ${value}`}><span>{label}</span><strong className="num" style={{ color }}>{value}</strong></div>;
}

function topologyText(s: Stats, t: Messages): string {
  if (s.core_types.length === 0 || s.core_types.length !== s.cores.length) {
    return `${s.cores.length} ${t.cores.logical} · ${t.dash.topologyUnavailable}`;
  }
  const performance = s.core_types.filter((kind) => kind === "P").length;
  const efficiency = s.core_types.filter((kind) => kind === "E").length;
  return performance > 0 && efficiency > 0 ? `P ${performance} ${t.cores.threads} · E ${efficiency} ${t.cores.threads}` : `${s.cores.length} ${t.cores.logical}`;
}

function CheatItem({ cmd, desc }: { cmd: string; desc: string }) {
  return <div className="cheat-item"><code>{cmd}</code><span>{desc}</span></div>;
}

function stats(data: number[]) {
  if (!data.length) return { peak: 0, avg: 0 };
  return { peak: Math.max(...data), avg: data.reduce((a, b) => a + b, 0) / data.length };
}

function buildSummary(
  s: Stats,
  windows: { cpu5: { peak: number; avg: number }; mem5: { peak: number; avg: number }; gpu5: { peak: number; avg: number } },
  diag: { title: string; advice: string[] },
  scale: CpuScale,
  lang: Language,
  t: Messages,
): string {
  const mem = fmtMem(s.mem_mb);
  const available = fmtMem(s.sys_mem_avail_mb);
  const memPeak = fmtMem(windows.mem5.peak);
  const vram = s.gpu_mem_mb != null ? `${(s.gpu_mem_mb / 1024).toFixed(1)} GB` : t.summary.unavailable;
  const gpu = s.gpu_pct != null ? `${fmtPct(s.gpu_pct)}% (${s.gpu_temp_c ?? "?"}°C, ${t.dash.vram} ${vram})` : t.summary.unavailable;
  const selectedScale = scale === "single" ? t.summary.cpu : t.summary.normalized;
  return [
    `${t.summary.title} @ ${new Date().toLocaleString(lang)}`,
    s.running ? `${t.summary.process}: acad.exe (PID ${s.pid}) ${t.summary.ranFor} ${fmtUptime(s.uptime_sec)}` : `${t.summary.process}: ${t.summary.stopped}`,
    `${t.summary.hardware}: ${s.cpu_model || t.dash.unknownCpu} (${topologyText(s, t)}) · ${s.gpu_model ?? t.summary.unavailable}`,
    `${t.summary.cpu}: ${fmtPct(s.cpu_single_pct)}% / ${t.summary.normalized} ${fmtPct(s.cpu_total_pct)}% · ${t.summary.busiestCore} ${fmtPct(s.busiest_core_pct)}% · ${fmtFreq(s.cpu_freq_mhz)}`,
    `${t.summary.busiestThread}: ${s.busiest_thread_pct != null ? `${fmtPct(s.busiest_thread_pct)}%` : t.summary.unavailable} · TID ${s.busiest_thread_id ?? "—"} · ${s.thread_count} ${t.summary.threads}`,
    `     ${t.summary.recent5} ${selectedScale} ${t.summary.peak} ${fmtPct(windows.cpu5.peak)}% · ${t.summary.average} ${fmtPct(windows.cpu5.avg)}%`,
    `${t.summary.memory}: ${mem.value} ${mem.unit} · ${t.summary.peak} ${memPeak.value} ${memPeak.unit} · ${t.summary.systemAvailable} ${available.value} ${available.unit}`,
    `${t.summary.gpuGlobal}: ${gpu}`,
    `${t.summary.system}: CPU ${fmtPct(s.sys_cpu_pct)}% · IO ↓${fmtBps(s.io_read_bps)} ↑${fmtBps(s.io_write_bps)}`,
    `${t.summary.diagnosis}: ${diag.title}`,
    ...diag.advice.map((advice) => `  · ${advice}`),
  ].join("\n");
}
