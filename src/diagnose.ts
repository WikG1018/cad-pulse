import type { Stats } from "./types";

export type DiagLevel = "idle" | "ok" | "cpu" | "gpu" | "wait" | "mem";
export type Tone = "ok" | "warn" | "danger" | "muted";

export interface Diagnosis {
  level: DiagLevel;
  tone: Tone;
  title: string;
  advice: string[];
}

const ADVICE_CPU = [
  "图纸清理：-PURGE（选 Regapps 输入 *）→ SCALELISTEDIT 重置 → AUDIT",
  "天正对象：交付图用【文件布图】→【图形导出】拍平成纯 CAD 对象",
  "冻结不编辑的图层，减少屏幕上的填充与注释对象",
  "LAYOUTREGENCTL=1（切布局不重生成）、WHIPTHREAD=3（重生成多核）",
];

const ADVICE_GPU = [
  "GRAPHICSCONFIG 开关硬件加速各试一次，平面图常关闭更快",
  "开加速仍卡则设 GFXDX12=0 回退 DX11",
  "NVIDIA 驱动改用 Studio 版而非 Game Ready",
];

const ADVICE_WAIT = [
  "检查外部参照/字体/支持文件搜索路径中失效的网络路径",
  "杀毒软件把 DWG 工作目录加入实时扫描排除",
  "卸载 AutoCAD Activity Insights 后台组件",
  "确认天正版本与 CAD 2024 匹配（T20 V8.0 及以上）",
];

const ADVICE_MEM = [
  "关闭占内存的程序；32GB 仍吃紧说明有泄漏或图纸过大",
  "大图拆分外部参照，避免单文件全量加载",
];

/** Rules mirror the verified PowerShell monitor: decide on the last ~30 samples. */
export function diagnose(history: Stats[]): Diagnosis {
  const last = history[history.length - 1];
  if (!last || !last.running) {
    return {
      level: "idle",
      tone: "muted",
      title: "等待 AutoCAD…",
      advice: ["启动 AutoCAD 后自动开始监控"],
    };
  }

  const win = history.slice(-30);
  const vals = (f: (s: Stats) => number) => win.map(f);
  const avg = (f: (s: Stats) => number) =>
    vals(f).reduce((a, b) => a + b, 0) / Math.max(win.length, 1);
  const peak = (f: (s: Stats) => number) => Math.max(...vals(f), 0);

  const avgCpu = avg((s) => s.cpu_single_pct);
  const peakCpu = peak((s) => s.cpu_single_pct);
  const avgCore = avg((s) => s.busiest_core_pct);
  const peakGpu = peak((s) => s.gpu_pct ?? 0);
  const minAvail = Math.min(...vals((s) => s.sys_mem_avail_mb));

  if (peakCpu >= 85 && avgCpu >= 40 && avgCore >= 80) {
    return { level: "cpu", tone: "danger", title: "CPU 单线程瓶颈 — 图纸数据偏重", advice: ADVICE_CPU };
  }
  if (minAvail < 2048) {
    return { level: "mem", tone: "warn", title: "系统内存吃紧 — 可能触发交换", advice: ADVICE_MEM };
  }
  if (peakGpu >= 60) {
    return { level: "gpu", tone: "warn", title: "GPU 渲染管线繁忙", advice: ADVICE_GPU };
  }
  if (avgCpu < 30 && peakGpu < 40) {
    return {
      level: "wait",
      tone: "warn",
      title: "负载不高 — 若体感卡顿多为等待型",
      advice: ADVICE_WAIT,
    };
  }
  return { level: "ok", tone: "ok", title: "运行正常", advice: [] };
}
