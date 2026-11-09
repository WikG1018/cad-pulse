import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { DiagLevel } from "./diagnose";

export type Language = "zh-CN" | "en-US";
const LANGUAGE_KEY = "cadpulse-language";

const zh = {
  common: {
    connecting: "正在连接性能监测服务…",
    starting: "正在启动",
    running: "AutoCAD 运行中",
    notRunning: "AutoCAD 未运行",
    waiting: "等待 AutoCAD",
    waitingEllipsis: "等待 AutoCAD…",
    demo: "演示",
    demoMode: "演示模式",
    demoRunning: "演示中",
    copySummary: "复制摘要",
    copied: "已复制",
    copyFailed: "复制失败",
    minimize: "最小化",
    closeDashboardTitle: "关闭面板（后台继续监控）",
    closeDashboardAria: "关闭面板，后台继续监控",
    openDashboard: "打开详情面板",
    expand: "展开悬浮窗",
    collapse: "折叠为常驻状态条",
    hideHudTitle: "隐藏悬浮窗（可从托盘找回）",
    hideHudAria: "隐藏悬浮窗",
    details: "详情",
    languageSwitch: "切换到 English",
  },
  hud: {
    subtitle: "AutoCAD 性能监测",
    processCpu: "进程 CPU",
    cpuShort: "CPU",
    coreShort: "核当量",
    busiestThreadShort: "最忙线程",
    last60: "近 60 秒",
    coreEquivalent: "100% = 1 核工作量（多核累计）",
    normalized: "总量",
    autocadMemory: "AutoCAD 内存",
    gpuLoad: "GPU 负载",
    gpuUnavailable: "GPU · 不可用",
    frequency: "最高实时频率",
    frequencyShort: "频率",
    memoryShort: "内存",
    availableShort: "可用",
    systemAvailable: "系统可用内存",
    waitingTitle: "等待 AutoCAD",
    waitingDescription: "启动后自动监测，无需手动配置",
    tryDemo: "试试演示模式",
    systemCpu: "系统 CPU",
    monitorState: "监测状态",
    idle: "待机",
    statusBarAria: "常驻性能状态条",
    processCpuAria: "AutoCAD 进程 CPU（核当量）",
  },
  dash: {
    overview: "性能概览",
    overviewSubtitle: "区分进程总算力、系统核心压力与等待型卡顿",
    minutes5: "5 分钟",
    minutes30: "30 分钟",
    sample: "采样",
    seconds05: "0.5 秒",
    seconds1: "1 秒",
    seconds2: "2 秒",
    coreEquivalent: "核当量",
    normalized: "总量口径",
    hardwareAria: "硬件型号与处理器拓扑",
    nvmlGlobal: "NVML · 全局指标",
    noNvidia: "未检测到 NVIDIA",
    gpuUnavailable: "GPU 指标不可用",
    unknownCpu: "未知 CPU",
    cpuCoreCard: "AutoCAD CPU · 核当量",
    cpuTotalCard: "AutoCAD CPU · 总量口径",
    autocadMemory: "AutoCAD 内存",
    gpuGlobal: "GPU · 全局负载",
    frequencyUnavailable: "频率不可用",
    coreEquivalentShort: "核当量",
    normalizedShort: "总量",
    peak5: "5 分钟峰值",
    average5: "5 分钟均值",
    average: "均值",
    busiestDashed: "虚线 · 最忙核",
    systemAvailable: "系统可用",
    temperature: "温度",
    clock: "时钟",
    vram: "显存",
    perCore: "每核实时负载",
    logicalCores: "个逻辑核 · 系统范围",
    topologyAuto: "自动识别 P/E 核",
    topologyUnavailable: "P/E 拓扑不可用",
    normal: "正常 <50%",
    elevated: "偏高 50–84%",
    saturated: "饱和 ≥85%",
    busiestCore: "最忙核",
    busiestThread: "最忙线程",
    systemCpu: "系统 CPU",
    gpuTemperature: "GPU 温度",
    smartDiagnosis: "智能诊断",
    noBottleneck: "当前未发现明显瓶颈，继续监控即可。",
    launchToAnalyze: "启动 AutoCAD 后，将自动分析 CPU、GPU 与内存状态。",
    diskRead: "磁盘读取",
    diskWrite: "磁盘写入",
    uptime: "运行时长",
    quickCommands: "图纸卡顿速查",
    eventLog: "事件日志",
    stored80: "本机保存最近 80 条",
    rangeAria: "曲线时间范围",
    sampleAria: "采样间隔",
    scaleAria: "CPU 统计口径",
  },
  cores: {
    empty: "暂无核心数据",
    performance: "性能核",
    efficiency: "能效核",
    logical: "逻辑核",
    groupAria: "按性能核与能效核分组的系统实时负载",
    genericAria: "系统逻辑核实时负载",
    threads: "线程",
    logicalCore: "逻辑核",
  },
  diag: {
    idleTitle: "等待 AutoCAD…",
    idleAdvice: "启动 AutoCAD 后自动开始监控",
    threadTitle: "AutoCAD 最忙线程持续高负载 — 可能存在单线程计算瓶颈",
    cpuTitle: "CPU 持续高负载 — 可能存在计算瓶颈",
    cpuAdvice: [
      "图纸清理：-PURGE（选 Regapps 输入 *）→ SCALELISTEDIT 重置 → AUDIT",
      "天正对象：交付图用【文件布图】→【图形导出】拍平成纯 CAD 对象",
      "冻结不编辑的图层，减少屏幕上的填充与注释对象",
      "LAYOUTREGENCTL=1（切布局不重生成）、WHIPTHREAD=3（重生成多核）",
    ],
    memTitle: "系统内存吃紧 — 可能触发交换",
    memAdvice: [
      "关闭占内存的程序；32GB 仍吃紧说明有泄漏或图纸过大",
      "大图拆分外部参照，避免单文件全量加载",
    ],
    gpuTitle: "GPU 渲染管线繁忙",
    gpuAdvice: [
      "GRAPHICSCONFIG 开关硬件加速各试一次，平面图常关闭更快",
      "开加速仍卡则设 GFXDX12=0 回退 DX11",
      "NVIDIA 驱动改用 Studio 版而非 Game Ready",
    ],
    waitTitle: "负载不高 — 若体感卡顿多为等待型",
    waitAdvice: [
      "检查外部参照/字体/支持文件搜索路径中失效的网络路径",
      "杀毒软件把 DWG 工作目录加入实时扫描排除",
      "卸载 AutoCAD Activity Insights 后台组件",
      "确认天正版本与 CAD 2024 匹配（T20 V8.0 及以上）",
    ],
    okTitle: "运行正常",
  },
  events: {
    start: "AutoCAD 启动",
    stop: "AutoCAD 已关闭",
    cpu: "进程 CPU 持续高负载 {value}%（核当量）",
    thread: "AutoCAD 最忙线程持续高负载 {value}%",
    gpu: "GPU 负载 {value}% — 渲染管线繁忙",
    mem: "系统可用内存仅 {value} GB",
    empty: "暂无事件 — 启动 AutoCAD 或触发负载后自动记录",
  },
  commands: {
    purge: "清理 Regapps",
    scale: "重置注释比例",
    audit: "修复图纸错误",
    dx11: "回退 DX11",
    layout: "布局不重生成",
    proxyCommand: "天正 · 图形导出",
    proxy: "拍平代理对象",
  },
  summary: {
    title: "CAD Pulse 摘要",
    process: "进程",
    stopped: "AutoCAD 未运行",
    ranFor: "已运行",
    hardware: "硬件",
    cpu: "CPU（核当量）",
    normalized: "总量口径",
    busiestCore: "最忙核",
    busiestThread: "AutoCAD 最忙线程",
    threads: "线程",
    recent5: "近 5 分钟",
    peak: "峰值",
    average: "均值",
    memory: "内存",
    systemAvailable: "系统可用",
    gpuGlobal: "GPU（全局）",
    system: "系统",
    diagnosis: "诊断",
    unavailable: "不可用",
  },
};

export type Messages = typeof zh;

const en: Messages = {
  common: {
    connecting: "Connecting to the performance monitor…",
    starting: "Starting",
    running: "AutoCAD running",
    notRunning: "AutoCAD not running",
    waiting: "Waiting for AutoCAD",
    waitingEllipsis: "Waiting for AutoCAD…",
    demo: "Demo",
    demoMode: "Demo mode",
    demoRunning: "Demo on",
    copySummary: "Copy summary",
    copied: "Copied",
    copyFailed: "Copy failed",
    minimize: "Minimize",
    closeDashboardTitle: "Close panel (monitoring continues)",
    closeDashboardAria: "Close panel; monitoring continues",
    openDashboard: "Open dashboard",
    expand: "Expand HUD",
    collapse: "Collapse to status bar",
    hideHudTitle: "Hide HUD (restore from tray)",
    hideHudAria: "Hide HUD",
    details: "Details",
    languageSwitch: "切换到中文",
  },
  hud: {
    subtitle: "AutoCAD performance monitor",
    processCpu: "Process CPU",
    cpuShort: "CPU",
    coreShort: "core-eq.",
    busiestThreadShort: "Thread",
    last60: "Last 60 s",
    coreEquivalent: "100% = 1 core (all threads)",
    normalized: "Total",
    autocadMemory: "AutoCAD RAM",
    gpuLoad: "GPU load",
    gpuUnavailable: "GPU · unavailable",
    frequency: "Peak clock",
    frequencyShort: "Freq.",
    memoryShort: "RAM",
    availableShort: "Avail.",
    systemAvailable: "System available memory",
    waitingTitle: "Waiting for AutoCAD",
    waitingDescription: "Monitoring starts automatically when AutoCAD launches",
    tryDemo: "Try demo mode",
    systemCpu: "System CPU",
    monitorState: "Monitor state",
    idle: "Idle",
    statusBarAria: "Persistent performance status bar",
    processCpuAria: "AutoCAD process CPU (core-equivalent)",
  },
  dash: {
    overview: "Performance overview",
    overviewSubtitle: "Separate process workload, system core pressure and wait-induced lag",
    minutes5: "5 min",
    minutes30: "30 min",
    sample: "Sample",
    seconds05: "0.5 s",
    seconds1: "1 s",
    seconds2: "2 s",
    coreEquivalent: "Core-equivalent",
    normalized: "Normalized",
    hardwareAria: "Hardware models and processor topology",
    nvmlGlobal: "NVML · whole-GPU metrics",
    noNvidia: "No NVIDIA GPU detected",
    gpuUnavailable: "GPU metrics unavailable",
    unknownCpu: "Unknown CPU",
    cpuCoreCard: "AutoCAD CPU · core-equivalent",
    cpuTotalCard: "AutoCAD CPU · normalized",
    autocadMemory: "AutoCAD RAM",
    gpuGlobal: "GPU · Global load",
    frequencyUnavailable: "Frequency unavailable",
    coreEquivalentShort: "Core-eq.",
    normalizedShort: "Normalized",
    peak5: "5-min peak",
    average5: "5-min average",
    average: "Average",
    busiestDashed: "Dashed · busiest system core",
    systemAvailable: "Available",
    temperature: "Temperature",
    clock: "Clock",
    vram: "VRAM",
    perCore: "Live load per logical core",
    logicalCores: "logical cores · system-wide",
    topologyAuto: "automatic P/E detection",
    topologyUnavailable: "P/E topology unavailable",
    normal: "Normal <50%",
    elevated: "Elevated 50–84%",
    saturated: "Saturated ≥85%",
    busiestCore: "Busiest core",
    busiestThread: "Busiest thread",
    systemCpu: "System CPU",
    gpuTemperature: "GPU temp",
    smartDiagnosis: "Smart diagnosis",
    noBottleneck: "No obvious bottleneck detected. Keep monitoring.",
    launchToAnalyze: "Launch AutoCAD to analyze CPU, GPU and memory automatically.",
    diskRead: "Disk read",
    diskWrite: "Disk write",
    uptime: "Uptime",
    quickCommands: "Drawing lag quick reference",
    eventLog: "Event log",
    stored80: "Latest 80 events stored locally",
    rangeAria: "Chart time range",
    sampleAria: "Sampling interval",
    scaleAria: "CPU measurement scale",
  },
  cores: {
    empty: "No core data",
    performance: "Performance cores",
    efficiency: "Efficiency cores",
    logical: "Logical cores",
    groupAria: "System load grouped by performance and efficiency cores",
    genericAria: "System logical-core load",
    threads: "threads",
    logicalCore: "logical core",
  },
  diag: {
    idleTitle: "Waiting for AutoCAD…",
    idleAdvice: "Launch AutoCAD to start monitoring automatically",
    threadTitle: "AutoCAD thread saturated — possible single-thread compute bottleneck",
    cpuTitle: "Sustained high CPU — possible compute bottleneck",
    cpuAdvice: [
      "Clean: -PURGE (Regapps, *) → reset SCALELISTEDIT → AUDIT",
      "TArch: 文件布图 → 图形导出 flattens proxy objects for delivery",
      "Freeze unused layers; hide unneeded hatches and annotative objects",
      "LAYOUTREGENCTL=1 skips layout regen; WHIPTHREAD=3 uses multicore regen",
    ],
    memTitle: "Low system memory — paging may occur",
    memAdvice: [
      "Close memory-heavy programs; pressure with 32 GB may indicate a leak or oversized drawing",
      "Split large drawings into external references instead of loading everything into one file",
    ],
    gpuTitle: "GPU rendering pipeline is busy",
    gpuAdvice: [
      "Toggle hardware acceleration in GRAPHICSCONFIG; 2D drawings are often faster with it off",
      "If lag persists with acceleration on, set GFXDX12=0 to fall back to DX11",
      "Use the NVIDIA Studio driver instead of Game Ready",
    ],
    waitTitle: "Low load — perceived lag is more likely I/O or waiting",
    waitAdvice: [
      "Check external-reference, font and support-file paths for unreachable network locations",
      "Exclude the DWG working directory from antivirus real-time scanning",
      "Uninstall the AutoCAD Activity Insights background component",
      "Confirm the TArch version matches CAD 2024 (T20 V8.0 or later)",
    ],
    okTitle: "Running normally",
  },
  events: {
    start: "AutoCAD started",
    stop: "AutoCAD closed",
    cpu: "Sustained process CPU {value}% (core-equivalent)",
    thread: "Sustained AutoCAD busiest-thread CPU {value}%",
    gpu: "GPU load {value}% — rendering pipeline busy",
    mem: "Only {value} GB system memory available",
    empty: "No events — launch AutoCAD or generate load to start recording",
  },
  commands: {
    purge: "Clean Regapps",
    scale: "Reset annotation scales",
    audit: "Repair drawing errors",
    dx11: "Fall back to DX11",
    layout: "Skip layout regeneration",
    proxyCommand: "天正 · 图形导出",
    proxy: "Flatten proxy objects",
  },
  summary: {
    title: "CAD Pulse summary",
    process: "Process",
    stopped: "AutoCAD not running",
    ranFor: "running for",
    hardware: "Hardware",
    cpu: "CPU (core-equivalent)",
    normalized: "normalized",
    busiestCore: "busiest system core",
    busiestThread: "AutoCAD busiest thread",
    threads: "threads",
    recent5: "Last 5 min",
    peak: "peak",
    average: "average",
    memory: "Memory",
    systemAvailable: "system available",
    gpuGlobal: "GPU (whole device)",
    system: "System",
    diagnosis: "Diagnosis",
    unavailable: "unavailable",
  },
};

interface LanguageContextValue {
  lang: Language;
  t: Messages;
  setLanguage: (language: Language) => void;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

function initialLanguage(): Language {
  try {
    const saved = localStorage.getItem(LANGUAGE_KEY);
    if (saved === "zh-CN" || saved === "en-US") return saved;
  } catch {
    /* storage unavailable */
  }
  return navigator.language.toLowerCase().startsWith("en") ? "en-US" : "zh-CN";
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Language>(initialLanguage);

  useEffect(() => {
    document.documentElement.lang = lang;
    try {
      localStorage.setItem(LANGUAGE_KEY, lang);
    } catch {
      /* storage unavailable */
    }
  }, [lang]);

  // The HUD is always created at startup and is the sole initial native sync
  // source. Deferring one task lets both WebViews finish their first render;
  // the dashboard receives the same value through language-changed.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (getCurrentWebviewWindow().label !== "hud") return;
      invoke("set_language", { language: lang }).catch((error) => {
        console.error("Failed to apply initial language", error);
      });
    }, 0);
    return () => window.clearTimeout(timer);
    // Mount-only: lang is the restored initial value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    listen<Language>("language-changed", (event) => {
      if (!disposed && (event.payload === "zh-CN" || event.payload === "en-US")) {
        setLang(event.payload);
      }
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const setLanguage = useCallback((language: Language) => {
    setLang(language);
    invoke("set_language", { language }).catch((error) => {
      console.error("Failed to synchronize language", error);
    });
  }, []);
  const value = useMemo(() => ({ lang, t: lang === "en-US" ? en : zh, setLanguage }), [lang, setLanguage]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const value = useContext(LanguageContext);
  if (!value) throw new Error("useLanguage must be used inside LanguageProvider");
  return value;
}

export function diagnosisText(t: Messages, level: DiagLevel): { title: string; advice: string[] } {
  switch (level) {
    case "idle": return { title: t.diag.idleTitle, advice: [t.diag.idleAdvice] };
    case "thread": return { title: t.diag.threadTitle, advice: t.diag.cpuAdvice };
    case "cpu": return { title: t.diag.cpuTitle, advice: t.diag.cpuAdvice };
    case "mem": return { title: t.diag.memTitle, advice: t.diag.memAdvice };
    case "gpu": return { title: t.diag.gpuTitle, advice: t.diag.gpuAdvice };
    case "wait": return { title: t.diag.waitTitle, advice: t.diag.waitAdvice };
    case "ok": return { title: t.diag.okTitle, advice: [] };
  }
}
