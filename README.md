<div align="center">

# CAD Pulse

**AutoCAD 性能监控悬浮窗 — 分清计算压力、图形负载与等待型卡顿**

*An always-on-top AutoCAD performance monitor that separates process workload, GPU load and wait-induced lag.*

[![License: MIT](https://img.shields.io/badge/License-MIT-82a9ff.svg)](LICENSE)
[![Platform: Windows](https://img.shields.io/badge/Platform-Windows%2010%2F11-82a9ff.svg)]()
[![Tauri](https://img.shields.io/badge/Tauri-2-72c6a5.svg)](https://v2.tauri.app)

简体中文 · [English](#english)

</div>

---

> 当前版本为 **v0.4.0**，新增只读界面响应性探针：直接判断 AutoCAD 界面线程是否还在处理消息，把“卡住了”从推测变成证据。

## 为什么做这个工具

任务管理器中的进程总 CPU 常按全部逻辑核归一化，难以直接说明 AutoCAD 的计算压力。CAD Pulse 同时展示**进程核当量、系统最忙核与全部逻辑核负载**，再把性能现象映射到可执行的排查建议。

- **进程 CPU（核当量）**：`100% = 一个逻辑核的工作量`，数值是 `acad.exe` 所有线程的累计，可超过 100%
- **AutoCAD 最忙线程**：直接根据线程自身的 kernel/user 时间差计算，显示百分比、TID 和线程数，不受线程在核心间迁移影响
- **系统核心视角**：最忙核和每核负载均为 Windows 全系统数据，不是 AutoCAD 线程到核心的映射
- **界面响应探针**：向 AutoCAD 主窗口发送 `WM_NULL` 并测量往返延迟，直接判断界面线程是否还在处理消息——CPU 不高≠不卡，这条才说明它到底有没有在响应
- **自动诊断**：区分界面无响应、持续计算压力、GPU 繁忙、内存压力与低负载下的等待型卡顿；结论是启发式提示，不代替专项性能分析
- **石墨色玻璃 HUD + 常驻状态条 + 托盘**：画图时一眼可读，不需要时折叠或隐藏
- **完整中英文界面**：详情面板一键切换，HUD、状态条、日志、摘要、托盘菜单和原生标题同步更新并记住选择

## 截图

| 悬浮 HUD | 详情面板 |
|:---:|:---:|
| ![HUD](screenshots/hud.png) | ![Dashboard](screenshots/dashboard.png) |

**常驻状态条（360×48）**

![常驻状态条](screenshots/status-bar.png)

> 图为真实 AutoCAD 运行数据。指标使用 CPU 蓝、GPU 青绿、内存紫作为常态识别色，负载升高后转为琥珀/红色；托盘图标为随 CPU 负载变色的进度环。

## 功能

- **悬浮 HUD**（置顶 / 拖动 / 折叠 / 隐藏）：进程 CPU 核当量大数字、近 60 秒曲线、诊断状态、AutoCAD 内存、GPU 负载与最高核实时频率
- **常驻状态条**（360×48）：折叠后持续显示进程 CPU、GPU、内存和频率；整条指标区域可拖动，动态颜色与状态灯保持不变
- **详情面板**（托盘左键 / HUD 详情入口）：真实 CPU/GPU 型号、自动 P/E 核分组、CPU/内存/GPU 的 5/30 分钟曲线与近 5 分钟峰值/均值、IO、运行时长
- **动态负载色彩**：CPU、每核负载与 GPU 按常态色 → 琥珀 → 红变化；系统内存压力使用同一套直观语义
- **界面无响应提示**：界面线程停止处理消息时，状态条把频率位让给“无响应 N 秒”，诊断面板、事件日志、复制摘要与托盘图标同步转红；无响应期间不占据额外宽度
- **自动诊断 + CAD 卡顿速查**：`-PURGE`、`SCALELISTEDIT`、`AUDIT`、`GFXDX12=0`、`LAYOUTREGENCTL=1`、天正图形导出
- **事件日志**：自动记录 AutoCAD 启动/关闭、进程 CPU 持续高负载、GPU 繁忙、内存吃紧；本机持久化最近 80 条，旧版文本日志自动迁移
- **一键复制摘要**：按当前语言复制负载、统计口径、峰值与诊断结论，失败时有明确反馈
- **Windows 原生 Acrylic**：远程桌面或玻璃不可用时自动回退为高对比度不透明深色界面
- **轻量后台监控**：AutoCAD 未运行时自动降频轮询；支持开机自启、单实例与演示模式

## 下载安装

从 [**Releases**](https://github.com/WikG1018/cad-pulse/releases) 下载 `CAD.Pulse_x.x.x_x64-setup.exe` 安装，也可选择 MSI。无需配置，打开 AutoCAD 后自动开始监控。

> 安装包未做代码签名（个人开源项目），Windows SmartScreen 可能提示“已保护你的电脑”——确认来源后可点“更多信息 → 仍要运行”。

> GPU 指标来自 NVIDIA NVML，为整卡负载而非 AutoCAD 独占值；无 NVIDIA 时自动隐藏 GPU 卡。系统需求：Windows 10/11 x64。

## 使用

**两个窗口**：桌面悬浮 HUD（展开小窗或常驻状态条）+ 详情面板（完整数据）。首次启动会自动打开面板一次。

| 想做什么 | 操作 |
|---|---|
| 打开详情面板 | HUD 标题栏四宫格按钮 / 点 HUD 状态行 / 托盘左键 |
| 切换中英文 | 详情面板右上角 `EN` / `中`；两个窗口和原生托盘同步，重启后保留 |
| 使用托盘 | 任务栏右下角；悬停查看摘要，右键打开悬浮窗、面板、演示、开机自启或退出 |
| 使用常驻状态条 | 点标题栏横线折叠成 360×48 状态条；拖动任意指标区域移动位置，点右侧展开按钮恢复 HUD |
| 隐藏悬浮窗 | 点 × 隐藏后从托盘找回 |
| 复制排障摘要 | 详情面板点“复制摘要”，粘贴到工单或技术沟通中 |

### 指标定义

- **进程 CPU（核当量）**：AutoCAD 所有线程 CPU 使用量之和；100% 代表一个逻辑核的工作量。160% 可能对应四个核各约 40%，不要求任何核心满载。线程迁移与采样平均也会分散瞬时峰值。
- **AutoCAD 最忙线程**：枚举 `acad.exe` 线程并用 `GetThreadTimes` 的累计时间差计算；100% 表示该线程占满一个逻辑核。首轮或数据不可用时显示“—”，不会假设它是 AutoCAD 主线程。
- **总量口径**：进程核当量除以逻辑核数量，用于对照任务管理器式总 CPU。
- **界面响应**：对 `acad.exe` 主框架窗口做一次 `WM_NULL` 往返，200 ms 内应答即正常并显示延迟毫秒数；未应答则累计“无响应”秒数。只读探测，不向 AutoCAD 写入任何内容；找不到窗口或权限不足时显示“未测量”，不与“无响应”混为一谈。
- **最忙核 / 每核负载**：系统全部逻辑核的实时负载，不是 AutoCAD 进程的按核拆分。
- **P/E 核拓扑**：Windows `GetLogicalProcessorInformationEx` 的效率类别和组亲和掩码自动划分；同构处理器全部归入 P 组，无法与采集核心数对齐时明确显示“拓扑不可用”。
- **动态颜色**：CPU/P 核常态为蓝色，GPU/E 核常态为青绿色，内存常态为紫色；CPU/GPU/每核负载 50–84% 为琥珀色，85% 及以上为红色；系统可用内存低于 4 GB / 2 GB 时分别为琥珀色 / 红色。
- **时间范围**：5/30 分钟按数据时间戳计算，切换 0.5/1/2 秒采样不会改变时间含义。
- **实时频率**：Windows PDH 的最高核实时频率（含睿频）；不可用时显示“—”。
- **等待状态**：AutoCAD 未运行时仍显示系统 CPU、可用内存与每核负载；状态条内存栏自动切换为系统可用内存，可开启演示模式体验。

## 诊断规则

诊断使用最近最多 30 个采样点，以下为启发式规则：

| 表现 | 结论 | 处理 |
|---|---|---|
| 界面探针连续未应答 ≥2 秒 | **界面无响应**（≥5 秒转危险） | CPU 同时不高说明卡在等待；CPU 同时满载则是计算耗时导致的假死 |
| 最忙线程峰值 ≥85%、均值 ≥60% | **AutoCAD 单线程计算压力** | 清理 Regapps、重置注释比例、修复图纸；冻结不编辑图层 |
| 无线程数据时，进程核当量峰值 ≥85%、均值 ≥40%，且系统最忙核均值 ≥80% | **持续 CPU 计算压力（回退规则）** | 同上；该组合不能单独证明单线程瓶颈 |
| 系统可用内存 <2 GB | **内存压力** | 关闭大程序；大图拆分外部参照 |
| GPU 峰值 ≥60% | **渲染管线忙** | 对比硬件加速开关；回退 DX11；使用 Studio 驱动 |
| 无探针数据时，进程核当量均值 <30%、GPU 峰值 <40%，但体感仍卡 | **可能为等待型卡顿** | 检查失效外部参照/字体路径、杀毒扫描、天正版本匹配 |

界面无响应优先于所有负载规则：它测的是“能不能干活”，负载测的是“干了多少活”。有探针数据后，低负载不再被推测成等待型卡顿，而直接判为运行正常。

最忙线程指标可以确认单个执行线程的持续压力，但不能仅凭 TID 认定它是 AutoCAD 主线程；诊断仍属于启发式提示。

## 开发

```bash
pnpm install
pnpm tauri dev                    # 开发运行
CAD_PULSE_DEMO=1 pnpm tauri dev   # 演示模式（PowerShell 可用 $env:CAD_PULSE_DEMO=1）
pnpm tauri build                  # 打包（NSIS + MSI）
```

技术栈：Tauri 2 · React 19 · TypeScript；Rust 使用 [sysinfo](https://github.com/GuillaumeGomez/sysinfo)、[nvml-wrapper](https://github.com/Cldfire/nvml-wrapper)、tiny-skia 与 [window-vibrancy](https://github.com/tauri-apps/window-vibrancy)。

设计体系与质量门禁见 [DESIGN.md](DESIGN.md)，版本变化见 [CHANGELOG.md](CHANGELOG.md)。欢迎 Issue / PR。

---

## <a id="english"></a>English

> The current release is **v0.4.0**, adding a read-only UI responsiveness probe that tells you whether AutoCAD's UI thread is still pumping messages, turning "it froze" from a guess into evidence.

### Why CAD Pulse

Task Manager's normalized process CPU does not directly describe AutoCAD's compute pressure. CAD Pulse shows **process core-equivalent CPU, the busiest system core and every logical core** together, then maps those signals to practical troubleshooting steps.

- **Process CPU (core-equivalent):** 100% equals one logical core's work. It sums all `acad.exe` threads and can exceed 100%.
- **AutoCAD busiest thread:** measured directly from each thread's kernel/user time deltas, with percentage, TID and thread count; thread migration between cores does not distort it.
- **System-core view:** the busiest core and per-core charts cover the whole Windows system; they are not an AutoCAD thread-to-core map.
- **UI responsiveness probe:** a `WM_NULL` round trip to AutoCAD's main window directly reports whether the UI thread is still answering — low CPU does not mean "not stuck", this does.
- **Heuristic diagnostics:** distinguish an unresponsive UI, sustained compute pressure, GPU load, memory pressure and possible wait-induced lag without claiming to replace dedicated profiling.
- **Graphite HUD, persistent status bar and tray:** readable while drafting, easy to collapse or hide.
- **Complete Chinese/English UI:** one switch updates the HUD, status bar, logs, copied summaries, tray menu and native window title, and persists across restarts.

### Features

- **Always-on-top HUD:** process core-equivalent CPU, a 60-second trend, diagnostic state, AutoCAD memory, whole-GPU load and peak live core frequency.
- **Persistent 360×48 status bar:** keeps process CPU, GPU, memory and frequency visible; drag any metric area and expand with the right-hand button.
- **Dashboard:** real CPU/GPU model names, Windows-topology-based P/E grouping, time-based 5/30-minute charts, 5-minute peak/average statistics, I/O and uptime.
- **Dynamic colors:** CPU blue, GPU/E-core teal and memory purple at normal levels; amber/red indicate elevated load or resource pressure.
- **Unresponsive warning:** when the UI thread stops pumping messages, the status bar lends its frequency slot to the stall age and the dashboard, event log, copied summary and tray icon all turn red, without widening the bar.
- **Diagnostics and quick commands:** `-PURGE`, `SCALELISTEDIT`, `AUDIT`, `GFXDX12=0`, `LAYOUTREGENCTL=1` and TArch drawing export.
- **Persistent event log:** stores the latest 80 start/stop, sustained process-CPU, GPU and memory events locally; legacy text events are migrated.
- **Localized summary copy:** copies current metrics, CPU scale, peaks and diagnosis in the selected language.
- **Native Windows acrylic:** falls back to an opaque, high-contrast dark surface when glass is unavailable or over Remote Desktop.
- **Lightweight background monitoring:** slower polling while AutoCAD is closed, autostart, single-instance behavior and demo mode.

### Install

Download `CAD.Pulse_x.x.x_x64-setup.exe` from [**Releases**](https://github.com/WikG1018/cad-pulse/releases), or use the MSI. Launch AutoCAD and monitoring starts automatically.

The installers are not code-signed, so Windows SmartScreen may warn you. Verify the source before choosing **More info → Run anyway**. NVIDIA metrics come from NVML and describe the whole GPU, not AutoCAD alone. Requires Windows 10/11 x64.

### Use

| Goal | Action |
|---|---|
| Open the dashboard | HUD dashboard button, HUD status row, or tray left-click |
| Switch Chinese/English | Click `EN` / `中` at the dashboard top right; all surfaces synchronize and the choice persists |
| Use the tray | Hover for a summary; right-click for HUD, dashboard, demo, autostart or quit |
| Use the status bar | Collapse the HUD to 360×48, drag any metric area, and use the right-hand button to expand |
| Hide the HUD | Click × and restore it from the tray |
| Copy a support summary | Click **Copy summary** on the dashboard |

### Metric definitions

- **Process CPU (core-equivalent):** the sum of all AutoCAD thread CPU usage. 100% is one logical core's work. A reading of 160% could mean four cores at roughly 40% each; no core needs to be saturated. Thread migration and sampling averages can further spread instantaneous peaks.
- **AutoCAD busiest thread:** enumerates `acad.exe` threads and uses `GetThreadTimes` deltas; 100% means one thread occupies one logical core's work. The first or unavailable sample shows “—”, and the metric does not assume the thread is AutoCAD's main thread.
- **Normalized:** process core-equivalent CPU divided by logical-core count, comparable with Task Manager-style total CPU.
- **UI response:** one `WM_NULL` round trip to the `acad.exe` main frame. A reply within 200 ms means responsive, with the latency in milliseconds; otherwise the stall age accumulates. The probe is read-only and writes nothing to AutoCAD. When no window is found or access is denied it reports "unmeasured", which is never conflated with "not responding".
- **Busiest core / per-core load:** system-wide Windows metrics, not a breakdown of AutoCAD by core.
- **P/E topology:** derived from `GetLogicalProcessorInformationEx` efficiency classes and group affinity masks. Homogeneous processors are shown as P; mismatched topology and sample counts are explicitly reported as unavailable.
- **Colors:** CPU/P cores are blue, GPU/E cores teal and memory purple at normal levels. CPU/GPU/core load is amber at 50–84% and red at 85% or above. Available system memory turns amber below 4 GB and red below 2 GB.
- **Time ranges:** 5/30-minute charts use sample timestamps, so 0.5/1/2-second sampling does not change their meaning.
- **Live frequency:** highest per-core Windows PDH frequency, including boost; unavailable values show “—”.
- **While AutoCAD is closed:** system CPU, available memory and per-core load remain visible. The status bar switches its memory field to system available memory.

### Diagnostic rules

Rules use up to the latest 30 samples:

| Signal | Interpretation | Suggested action |
|---|---|---|
| UI probe unanswered for ≥2 s | **Unresponsive UI** (critical at ≥5 s) | Low CPU alongside means a blocking wait; saturated CPU means the freeze is compute time |
| Busiest AutoCAD thread peak ≥85% and average ≥60% | AutoCAD single-thread compute pressure | Clean Regapps, reset annotation scales, audit the drawing and freeze unused layers |
| Fallback without thread data: process core-equivalent peak ≥85%, average ≥40%, and busiest system core average ≥80% | Sustained CPU compute pressure | Same actions; this combination alone cannot prove a single-thread bottleneck |
| Available system memory <2 GB | Memory pressure | Close heavy applications and split large drawings into external references |
| GPU peak ≥60% | Busy rendering pipeline | Compare hardware acceleration on/off, fall back to DX11 and try the Studio driver |
| Without probe data: process core-equivalent average <30% and GPU peak <40%, but lag is still perceived | Possible I/O or waiting | Check unreachable reference/font paths, antivirus scanning and TArch compatibility |

An unresponsive UI outranks every load rule: the probe measures whether work can happen at all, while load measures how much already happened. Once probe data exists, low load stops being guessed as wait-type lag and simply reads as healthy.

The busiest-thread metric confirms sustained pressure on one execution thread, but its TID alone does not establish that it is AutoCAD's main thread. Diagnosis remains heuristic.

### Development

```bash
pnpm install
pnpm tauri dev                    # Development
CAD_PULSE_DEMO=1 pnpm tauri dev   # Demo mode (PowerShell: $env:CAD_PULSE_DEMO=1)
pnpm tauri build                  # NSIS + MSI installers
```

Built with Tauri 2, React 19 and TypeScript. Rust uses [sysinfo](https://github.com/GuillaumeGomez/sysinfo), [nvml-wrapper](https://github.com/Cldfire/nvml-wrapper), tiny-skia and [window-vibrancy](https://github.com/tauri-apps/window-vibrancy).

See [DESIGN.md](DESIGN.md) for the design system and quality gates, and [CHANGELOG.md](CHANGELOG.md) for release history. Issues and PRs are welcome.

## License / 许可证

[MIT](LICENSE) © WikG1018
