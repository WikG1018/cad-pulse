# Changelog / 更新日志

## v0.3.0 (2026-11-09)

### Persistent status bar / 常驻状态条
- 折叠 HUD 升级为 360×48 桌面状态条，常驻显示进程 CPU 核当量、GPU、内存和最高实时频率，并保留动态颜色与运行状态灯。
- Collapsing the HUD now produces a 360×48 desktop status bar with process core-equivalent CPU, GPU, memory and peak live frequency, retaining dynamic colors and status.
- 除展开按钮外，点击任意指标区域均可拖动状态条；无 AutoCAD 时内存栏自动切换为系统可用内存。
- Every non-button metric area can drag the status bar. Without AutoCAD, the memory field switches to system available memory.

### Complete Chinese/English UI / 完整中英文界面
- 新增 `zh-CN` / `en-US` 切换并持久化选择；HUD、状态条、Dashboard、诊断、事件日志、复制摘要、托盘菜单、tooltip 和原生窗口标题同步更新。
- Added persistent zh-CN/en-US switching across the HUD, status bar, dashboard, diagnostics, event log, copied summaries, tray menu, tooltip and native window title.
- 诊断规则与显示文案分离；事件改为结构化存储，并迁移旧版中文文本日志。
- Separated diagnostic rules from display text and introduced structured events with migration for legacy Chinese text logs.
- GitHub README、设计标准与更新日志补齐英文说明。
- Added English usage, design and changelog documentation on GitHub.

### AutoCAD busiest-thread CPU / AutoCAD 最忙线程
- 使用 Windows 线程枚举与 `GetThreadTimes` 时间差采集 AutoCAD 最忙线程，新增百分比、TID 和线程数；处理首轮、线程退出、TID 复用及进程切换。
- Added AutoCAD busiest-thread percentage, TID and thread count using Windows thread enumeration and `GetThreadTimes` deltas, with warm-up, exited-thread, TID-reuse and process-change handling.
- HUD、Dashboard、托盘、事件与复制摘要区分进程核当量、AutoCAD 最忙线程和系统最忙核；最忙线程持续高负载时提供独立的单线程计算压力提示。
- HUD, dashboard, tray, events and copied summaries now separate process core-equivalent CPU, AutoCAD's busiest thread and the busiest system core; sustained thread load has a dedicated single-thread compute-pressure hint.

### Metric clarity / 指标口径修正
- “单核口径”统一更名为“进程 CPU（核当量）”：100% 等于一个逻辑核工作量，数值为 AutoCAD 所有线程累计，可超过 100%。
- Renamed “single-core scale” to “process CPU (core-equivalent)”: 100% is one logical core's work, summed across all AutoCAD threads and allowed to exceed 100%.
- 明确“最忙核/每核负载”为系统范围；CPU 诊断改为启发式“持续计算压力”，不再据此断言单线程瓶颈。
- Clarified that busiest-core/per-core metrics are system-wide. CPU diagnosis now reports heuristic sustained compute pressure instead of asserting a single-thread bottleneck.

## v0.2.0 (2026-11-09)

### UI redesign / 界面重做
- HUD 聚焦“状态 + CPU 大数字 + 近 60 秒趋势”，底部仅保留内存、GPU 与实时频率；折叠条调整为 176×48。
- Focused the HUD on status, a large CPU value and a 60-second trend, with memory, GPU and live frequency below; resized the collapsed strip to 176×48.
- 仪表盘重构为性能概览、硬件信息、每核负载、诊断与事件，默认尺寸调整为 1040×940，小窗口支持滚动。
- Rebuilt the dashboard around overview, hardware, per-core load, diagnosis and events; default size is 1040×940 with scrolling in smaller windows.
- 展示真实 CPU/GPU 型号；通过 Windows 处理器拓扑与组亲和掩码自动划分性能核和能效核，不依赖核心编号或型号猜测。
- Added real CPU/GPU models and Windows-topology-based P/E grouping using efficiency classes and group affinity masks, never model-name or core-index guesses.
- CPU/P 核以蓝色、GPU/E 核以青绿色、内存以紫色作为常态识别色；CPU/GPU/每核负载在 50–84% 变为琥珀色、≥85% 变为红色，系统可用内存低于 4/2 GB 时分别显示琥珀/红色。
- Added blue CPU/P-core, teal GPU/E-core and purple memory identity colors; amber at 50–84% load, red at 85% or above, and amber/red below 4/2 GB available system memory.
- 采用中性石墨色 Acrylic、中文系统字体和 JetBrains Mono 数字；去除渐变边框、追光与多余动效。
- Adopted neutral graphite acrylic, Chinese system fonts and JetBrains Mono numerals; removed gradient borders, cursor lighting and unnecessary motion.
- 全部文本颜色通过 WCAG AA 对比度检查；图标改为统一 SVG；状态行与控件支持键盘焦点。
- All text colors pass WCAG AA contrast checks; icons use a unified SVG set; status rows and controls support keyboard focus.
- 无 NVIDIA 时隐藏 GPU 卡；GPU 温度、时钟、显存和 CPU 频率支持独立缺失降级。
- Hide the GPU card without NVIDIA; GPU temperature, clock, VRAM and CPU frequency degrade independently when unavailable.

### Fixes / 修正
- 原生窗口与 CSS 圆角统一为 8 px，消除四角重复圆弧。
- Unified native and CSS window radii at 8 px to remove duplicate corner arcs.
- 修正稀疏处理器亲和掩码的 P/E 映射；多处理器组与采集核心数不一致时统一降级为“拓扑不可用”，不再误报为同构处理器。
- Fixed P/E mapping for sparse processor affinity masks; topology/sample count mismatches now consistently report unavailable topology instead of a homogeneous CPU.
- 修复 WebView2 中曲线可能显示为黑色的问题。
- Fixed chart lines that could appear black in WebView2.
- 5/30 分钟曲线和近 5 分钟统计改为按时间戳筛选，不再随 0.5/1/2 秒采样率改变窗口含义。
- Made 5/30-minute charts and 5-minute statistics timestamp-based, independent of 0.5/1/2-second sampling.
- 修复可用内存低于 1 GB 时单位误写为 GB 的问题；托盘内存与显存缺失显示同步修正。
- Fixed memory units below 1 GB and aligned tray memory/VRAM unavailable states.
- 修复 `perf-tick` 异步订阅在组件快速卸载时可能未清理的竞态。
- Fixed an asynchronous `perf-tick` subscription cleanup race during rapid component unmounts.
- 复制摘要失败时显示明确反馈；摘要包含正确的内存单位和当前 CPU 统计口径。
- Added explicit summary-copy failure feedback, correct memory units and the selected CPU scale.

## v0.1.0 (2026-11-09)

首个公开版本。Initial public release.

### Features / 功能
- 悬浮 HUD：CPU、内存实时曲线、每核负载条、GPU/温度、CPU 频率、运行时长、自动诊断行；可拖动、可折叠迷你条、置顶。
- Always-on-top HUD with CPU/memory trends, per-core bars, GPU/temperature, CPU frequency, uptime and diagnosis; draggable and collapsible.
- 详情面板：5/30 分钟三曲线卡（峰值/均值/频率/显存）、每核实时负载、事件日志、诊断建议、CAD 卡顿速查命令、一键复制摘要。
- Dashboard with 5/30-minute metric cards, per-core load, persistent event log, diagnostic advice, CAD quick commands and summary copy.
- 托盘：环形图标实时变色、悬停多行摘要、左键开面板、右键菜单（悬浮窗/面板/演示模式/开机自启/退出）。
- Tray ring icon changes with load, with a hover summary, left-click dashboard and right-click HUD/dashboard/demo/autostart/quit menu.
- AutoCAD 未运行自动降频轮询；演示模式（环境变量 `CAD_PULSE_DEMO=1` 或界面开关）。
- Slower polling while AutoCAD is closed and demo mode via `CAD_PULSE_DEMO=1` or the UI.
- Windows 原生 Acrylic 暗色玻璃（远程桌面下自动回退）；单实例保护；窗口关闭转为后台驻留。
- Native Windows acrylic with an RDP-safe fallback, single-instance protection and close-to-background behavior.

### Technical / 技术
- Tauri 2 + React 19 + TypeScript；Rust：sysinfo / nvml-wrapper / tiny-skia / window-vibrancy / autostart / single-instance。
- Built with Tauri 2, React 19 and TypeScript; Rust uses sysinfo, nvml-wrapper, tiny-skia, window-vibrancy, autostart and single-instance.
- v0.1.1 完善窗口圆角、详情入口和双 CPU 口径；v0.1.2 使用 PDH 修正实时睿频。
- v0.1.1 refined window corners, dashboard access and dual CPU scales; v0.1.2 corrected live boost frequency using PDH.
