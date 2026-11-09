import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useStats, series } from "../hooks/useStats";
import { useGlass } from "../hooks/useGlass";
import { diagnose } from "../diagnose";
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
  const glass = useGlass();
  const events = useEventLog(history);
  const [sampleMs, setSampleMs] = useState(1000);
  const [scale, setScale] = useState<CpuScale>("single");
  const [range, setRange] = useState<Range>(300);
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");

  const diag = useMemo(() => diagnose(history), [history]);
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
    return <div className={glass ? "glass" : ""}><div className="dash-root"><div className="dash-loading"><BrandMark /><strong>CAD Pulse</strong><span>正在连接性能监测服务…</span></div></div></div>;
  }

  const mem = fmtMem(latest.mem_mb);
  const available = fmtMem(latest.sys_mem_avail_mb);
  const gpuMissing = latest.gpu_pct == null;
  const cpuColor = latest.running ? coreColor(cpuValue(latest)) : "#8d99ac";
  const memColor = memoryColor(latest.sys_mem_avail_mb);
  const gpuColor = gpuLoadColor(latest.gpu_pct ?? 0);

  const copySummary = async () => {
    try {
      await navigator.clipboard.writeText(buildSummary(latest, { cpu5, mem5, gpu5 }, diag, scale));
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
          <div className="dash-brand"><BrandMark /><div><strong>CAD Pulse</strong><span>AutoCAD 性能监测</span></div></div>
          <div className="process-status"><span className={`status-dot ${latest.running ? diag.tone : "muted"}`} /><span>{latest.running ? "AutoCAD 运行中" : "AutoCAD 未运行"}</span>{latest.running && <span className="num process-pid">PID {latest.pid}</span>}{latest.demo && <span className="demo-badge">演示</span>}</div>
          <div className="window-actions">
            <button className={`text-btn${latest.demo ? " active" : ""}`} onClick={() => invoke("set_demo", { on: !latest.demo })}>{latest.demo ? <Icon name="check" /> : <Icon name="play" />}{latest.demo ? "演示中" : "演示模式"}</button>
            <button className="text-btn copy-btn" onClick={copySummary}><Icon name={copyStatus === "copied" ? "check" : "copy"} />{copyStatus === "copied" ? "已复制" : copyStatus === "error" ? "复制失败" : "复制摘要"}</button>
            <span className="window-divider" />
            <button className="icon-btn" title="最小化" aria-label="最小化" onClick={() => win.minimize()}><Icon name="collapse" /></button>
            <button className="icon-btn" title="关闭面板（后台继续监控）" aria-label="关闭面板，后台继续监控" onClick={() => win.hide()}><Icon name="close" /></button>
          </div>
        </header>

        <main className="dash-body">
          <section className="overview-heading">
            <div><h1>性能概览</h1><p>聚焦单核负载，识别 AutoCAD 卡顿根源</p></div>
            <div className="overview-controls">
              <div className="segment" role="group" aria-label="曲线时间范围">
                <button className={range === 300 ? "active" : ""} aria-pressed={range === 300} onClick={() => setRange(300)}>5 分钟</button>
                <button className={range === 1800 ? "active" : ""} aria-pressed={range === 1800} onClick={() => setRange(1800)}>30 分钟</button>
              </div>
              <label className="sample-control">采样<select aria-label="采样间隔" value={sampleMs} onChange={(e) => { const ms = Number(e.target.value); setSampleMs(ms); invoke("set_sample_interval", { ms }).catch(() => {}); }}><option value={500}>0.5 秒</option><option value={1000}>1 秒</option><option value={2000}>2 秒</option></select></label>
              <div className="segment" role="group" aria-label="CPU 统计口径">
                <button className={scale === "single" ? "active" : ""} aria-pressed={scale === "single"} onClick={() => setScale("single")}>单核口径</button>
                <button className={scale === "total" ? "active" : ""} aria-pressed={scale === "total"} onClick={() => setScale("total")}>总量口径</button>
              </div>
            </div>
          </section>

          <section className="hardware-bar" aria-label="硬件型号与处理器拓扑">
            <div className="hardware-item cpu"><span className="hardware-kind">CPU</span><div><strong title={latest.cpu_model}>{latest.cpu_model}</strong><span>{topologyText(latest)}</span></div></div>
            <div className="hardware-item gpu"><span className="hardware-kind">GPU</span><div><strong title={latest.gpu_model ?? "未检测到 NVIDIA"}>{latest.gpu_model ?? "未检测到 NVIDIA"}</strong><span>{latest.gpu_model ? "NVML · 全局指标" : "GPU 指标不可用"}</span></div></div>
          </section>

          <div className={`metric-grid${gpuMissing ? " no-gpu" : ""}`}>
            <MetricCard
              primary
              label={scale === "single" ? "CPU · 单核口径" : "CPU · 总量口径"}
              value={latest.running ? fmtPct(cpuValue(latest)) : "—"}
              animValue={latest.running ? cpuValue(latest) : undefined}
              format={fmtPct}
              unit={latest.running ? "%" : undefined}
              color={cpuColor}
              data={cpuData}
              max={scale === "single" ? Math.max(100, ...cpuData) : 100}
              sub={latest.cpu_freq_mhz > 0 ? fmtFreq(latest.cpu_freq_mhz) : "频率不可用"}
              secondary={scale === "single" ? { data: coreData, max: 100 } : undefined}
              footer={<div className="card-stats"><span>{scale === "single" ? "总量" : "单核"}<b className="num">{latest.running ? `${fmtPct(scale === "single" ? latest.cpu_total_pct : latest.cpu_single_pct)}%` : "—"}</b></span><span>5 分钟峰值<b className="num">{latest.running ? `${fmtPct(cpu5.peak)}%` : "—"}</b></span><span>5 分钟均值<b className="num">{latest.running ? `${fmtPct(cpu5.avg)}%` : "—"}</b></span><span className="chart-legend">虚线 · 最忙核</span></div>}
            />
            <MetricCard
              label="AutoCAD 内存"
              value={latest.running ? mem.value : "—"}
              animValue={latest.running ? latest.mem_mb : undefined}
              format={(v) => fmtMem(v).value}
              unit={latest.running ? mem.unit : undefined}
              color={memColor}
              data={memData}
              max={memMax}
              sub={`系统可用 ${available.value} ${available.unit}`}
              secondary={{ data: availData, max: availMax }}
              footer={<div className="card-stats"><span>5 分钟峰值<b className="num">{latest.running ? `${fmtMem(mem5.peak).value} ${fmtMem(mem5.peak).unit}` : "—"}</b></span><span>均值<b className="num">{latest.running ? `${fmtMem(mem5.avg).value} ${fmtMem(mem5.avg).unit}` : "—"}</b></span></div>}
            />
            {!gpuMissing && <MetricCard
              label="GPU · 全局负载"
              value={fmtPct(latest.gpu_pct ?? 0)}
              animValue={latest.gpu_pct ?? undefined}
              format={fmtPct}
              unit="%"
              color={gpuColor}
              data={gpuData}
              max={100}
              sub={<span>{latest.gpu_temp_c != null ? <span style={{ color: tempColor(latest.gpu_temp_c) }}>{latest.gpu_temp_c}°C</span> : "温度 —"} · {latest.gpu_clock_mhz != null ? `${latest.gpu_clock_mhz} MHz` : "时钟 —"}</span>}
              footer={<div className="card-stats"><span>5 分钟峰值<b className="num">{fmtPct(gpu5.peak)}%</b></span><span>均值<b className="num">{fmtPct(gpu5.avg)}%</b></span><span>显存<b className="num">{latest.gpu_mem_mb != null ? `${(latest.gpu_mem_mb / 1024).toFixed(1)} GB` : "—"}</b></span></div>}
            />}
          </div>

          <section className="panel cores-card">
            <div className="section-heading"><div><h2>每核实时负载</h2><p>{latest.cores.length} 个逻辑核 · 系统范围 · {latest.core_types.length > 0 && latest.core_types.length === latest.cores.length ? "自动识别 P/E 核" : "P/E 拓扑不可用"}</p></div><span className="load-legend"><span><i style={{ background: "#82a9ff" }} />正常 &lt;50%</span><span><i style={{ background: "#efbd72" }} />偏高 50–84%</span><span><i style={{ background: "#f08b82" }} />饱和 ≥85%</span></span></div>
            <div className="cores-content">
              <CoreBars cores={latest.cores} coreTypes={latest.core_types} height={50} gap={5} showNumbers />
              <div className="cores-side"><SideStat label="最忙核" value={`${fmtPct(latest.busiest_core_pct)}%`} color={coreColor(latest.busiest_core_pct)} /><SideStat label="系统 CPU" value={`${fmtPct(latest.sys_cpu_pct)}%`} color={coreColor(latest.sys_cpu_pct)} />{latest.gpu_temp_c != null ? <SideStat label="GPU 温度" value={`${latest.gpu_temp_c}°C`} color={tempColor(latest.gpu_temp_c)} /> : <SideStat label="系统可用" value={`${available.value} ${available.unit}`} color={memColor} />}</div>
            </div>
          </section>

          <div className="insight-grid">
            <section className={`panel diagnosis-panel ${diag.tone}`}>
              <div className="section-heading"><div className="diagnosis-title"><span className={`status-dot ${latest.running ? diag.tone : "muted"}`} /><h2>{latest.running ? diag.title : "等待 AutoCAD"}</h2></div><span className="section-kicker">智能诊断</span></div>
              <div className="diagnosis-content">
                {diag.advice.length > 0 && latest.running ? <ul className="diag-advice">{diag.advice.map((advice) => <li key={advice}>{advice}</li>)}</ul> : <p className="diagnosis-ok">{latest.running ? "当前未发现明显瓶颈，继续监控即可。" : "启动 AutoCAD 后，将自动分析 CPU、GPU 与内存状态。"}</p>}
                <div className="process-facts"><span>磁盘读取<b className="num">{latest.running ? fmtBps(latest.io_read_bps) : "—"}</b></span><span>磁盘写入<b className="num">{latest.running ? fmtBps(latest.io_write_bps) : "—"}</b></span><span>运行时长<b className="num">{latest.running ? fmtUptime(latest.uptime_sec) : "—"}</b></span></div>
              </div>
              <div className="command-section"><h3>图纸卡顿速查</h3><div className="command-grid"><CheatItem cmd="-PURGE" desc="清理 Regapps" /><CheatItem cmd="SCALELISTEDIT" desc="重置注释比例" /><CheatItem cmd="AUDIT" desc="修复图纸错误" /><CheatItem cmd="GFXDX12=0" desc="回退 DX11" /><CheatItem cmd="LAYOUTREGENCTL=1" desc="布局不重生成" /><CheatItem cmd="天正 · 图形导出" desc="拍平代理对象" /></div></div>
            </section>
            <section className="panel activity-panel"><div className="section-heading"><div><h2>事件日志</h2><p>本机保存最近 80 条</p></div><span className="count-badge num">{events.length}</span></div><EventLogView events={events} /></section>
          </div>
        </main>
      </div>
    </div>
  );
}

function SideStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return <div className="side-stat"><span>{label}</span><strong className="num" style={{ color }}>{value}</strong></div>;
}

function topologyText(s: Stats): string {
  if (s.core_types.length === 0 || s.core_types.length !== s.cores.length) {
    return `${s.cores.length} 逻辑核 · P/E 拓扑不可用`;
  }
  const performance = s.core_types.filter((kind) => kind === "P").length;
  const efficiency = s.core_types.filter((kind) => kind === "E").length;
  return performance > 0 && efficiency > 0 ? `P ${performance} 线程 · E ${efficiency} 线程` : `${s.cores.length} 逻辑核 · 同构处理器`;
}

function CheatItem({ cmd, desc }: { cmd: string; desc: string }) {
  return <div className="cheat-item"><code>{cmd}</code><span>{desc}</span></div>;
}

function stats(data: number[]) {
  if (!data.length) return { peak: 0, avg: 0 };
  return { peak: Math.max(...data), avg: data.reduce((a, b) => a + b, 0) / data.length };
}

function buildSummary(s: Stats, windows: { cpu5: { peak: number; avg: number }; mem5: { peak: number; avg: number }; gpu5: { peak: number; avg: number } }, diag: ReturnType<typeof diagnose>, scale: CpuScale): string {
  const mem = fmtMem(s.mem_mb);
  const available = fmtMem(s.sys_mem_avail_mb);
  const memPeak = fmtMem(windows.mem5.peak);
  const gpu = s.gpu_pct != null ? `${fmtPct(s.gpu_pct)}%（${s.gpu_temp_c ?? "?"}°C，显存 ${s.gpu_mem_mb != null ? `${(s.gpu_mem_mb / 1024).toFixed(1)} GB` : "不可用"}）` : "不可用";
  return [
    `CAD Pulse 摘要 @ ${new Date().toLocaleString("zh-CN")}`,
    s.running ? `进程: acad.exe (PID ${s.pid}) 已运行 ${fmtUptime(s.uptime_sec)}` : "进程: AutoCAD 未运行",
    `硬件: ${s.cpu_model}（${topologyText(s)}）· ${s.gpu_model ?? "GPU 不可用"}`,
    `CPU: ${fmtPct(s.cpu_single_pct)}%（单核口径）/ ${fmtPct(s.cpu_total_pct)}%（总量口径）· 最忙核 ${fmtPct(s.busiest_core_pct)}% · ${fmtFreq(s.cpu_freq_mhz)}`,
    `     近 5 分钟${scale === "single" ? "单核" : "总量"}峰值 ${fmtPct(windows.cpu5.peak)}% · 均值 ${fmtPct(windows.cpu5.avg)}%`,
    `内存: ${mem.value} ${mem.unit} · 峰值 ${memPeak.value} ${memPeak.unit} · 系统可用 ${available.value} ${available.unit}`,
    `GPU（全局）: ${gpu}`,
    `系统: CPU ${fmtPct(s.sys_cpu_pct)}% · IO ↓${fmtBps(s.io_read_bps)} ↑${fmtBps(s.io_write_bps)}`,
    `诊断: ${diag.title}`,
    ...diag.advice.map((advice) => `  · ${advice}`),
  ].join("\n");
}
