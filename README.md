<div align="center">

# CAD Pulse

**AutoCAD 性能监控悬浮窗 — 单核视角，一眼看清卡顿根源**

*An always-on-top performance monitor for AutoCAD, built around the metric that actually matters: single-core saturation.*

[![License: MIT](https://img.shields.io/badge/License-MIT-82a9ff.svg)](LICENSE)
[![Platform: Windows](https://img.shields.io/badge/Platform-Windows%2010%2F11-82a9ff.svg)]()
[![Tauri](https://img.shields.io/badge/Tauri-2-72c6a5.svg)](https://v2.tauri.app)

简体中文 · [English](#english)

</div>

---

## 为什么做这个工具

AutoCAD 的 2D 运算主要吃**单核 CPU**。任务管理器显示的“总 CPU 8%”可能对应 20 个核里 1 个核打满、其余空闲。CAD Pulse 直接展示这个关键差异，并把性能现象映射到可执行的排查建议。

- **单核口径**（100% = 一个核满载）+ 最忙核 + 全部逻辑核实时条形图
- **自动诊断**：单核满载 → 清理图纸垃圾数据；GPU 忙 → 检查硬件加速；低负载仍卡 → 检查外部参照与杀毒扫描
- **石墨色玻璃 HUD + 托盘常驻**：画图时一眼可读，不需要时折叠或隐藏

## 截图

| 悬浮 HUD | 详情面板 |
|:---:|:---:|
| ![HUD](screenshots/hud.png) | ![Dashboard](screenshots/dashboard.png) |

> 图为真实 AutoCAD 运行数据。指标使用 CPU 蓝、GPU 青绿、内存紫作为常态识别色，负载升高后转为琥珀/红色；托盘图标为随 CPU 负载变色的进度环。

## 功能

- **悬浮 HUD**（置顶 / 拖动 / 折叠 / 隐藏）：单核 CPU 大数字、近 60 秒曲线、诊断状态、AutoCAD 内存、GPU 负载与最高核实时频率
- **详情面板**（托盘左键 / HUD 详情入口）：真实 CPU/GPU 型号、自动 P/E 核分组、CPU/内存/GPU 的 5/30 分钟曲线与近 5 分钟峰值/均值、IO、运行时长
- **动态负载色彩**：CPU、每核负载与 GPU 按蓝 → 琥珀 → 红变化；系统内存压力使用同一套直观语义
- **自动诊断 + CAD 卡顿速查**：`-PURGE`、`SCALELISTEDIT`、`AUDIT`、`GFXDX12=0`、`LAYOUTREGENCTL=1`、天正图形导出
- **事件日志**：自动记录 AutoCAD 启动/关闭、CPU 持续满载、GPU 繁忙、内存吃紧；本机持久化最近 80 条
- **一键复制摘要**：复制当前负载、统计口径、峰值与诊断结论，失败时有明确反馈
- **Windows 原生 Acrylic**：远程桌面或玻璃不可用时自动回退为高对比度不透明深色界面
- **轻量后台监控**：AutoCAD 未运行时自动降频轮询；支持开机自启、单实例与演示模式

## 下载安装

从 [**Releases**](https://github.com/WikG1018/cad-pulse/releases) 下载 `CAD.Pulse_x.x.x_x64-setup.exe` 安装，也可选择 MSI。无需配置，打开 AutoCAD 后自动开始监控。

> 安装包未做代码签名（个人开源项目），Windows SmartScreen 可能提示“已保护你的电脑”——确认来源后可点“更多信息 → 仍要运行”。

> GPU 指标来自 NVIDIA NVML，为整卡负载而非 AutoCAD 独占值；无 NVIDIA 时自动隐藏 GPU 卡。系统需求：Windows 10/11 x64。

## 使用

**两个界面**：桌面悬浮 HUD（常驻小窗）+ 详情面板（完整数据）。首次启动会自动打开面板一次。

| 想做什么 | 操作 |
|---|---|
| 打开详情面板 | HUD 标题栏四宫格按钮 / 点 HUD 状态行 / 托盘左键 |
| 使用托盘 | 任务栏右下角；悬停查看摘要，右键打开悬浮窗、面板、演示、开机自启或退出 |
| 收起悬浮窗 | 点标题栏横线折叠成迷你条；点 × 隐藏后从托盘找回 |

监控数据说明：

- **CPU 单核口径**：`100% = 一个核满载`；可切换“总量口径”对照任务管理器数据
- **每核负载**：系统全部逻辑核的实时负载，不是 AutoCAD 进程的按核拆分；Windows 通过 `GetLogicalProcessorInformationEx` 的效率类别和组亲和掩码自动划分 P/E 核，同构处理器全部归入 P 组，无法与采集核心数对齐时明确显示“拓扑不可用”
- **动态颜色**：CPU/P 核常态为蓝色，GPU/E 核常态为青绿色，内存常态为紫色；CPU/GPU/每核负载 50–84% 为琥珀色，85% 及以上为红色；系统可用内存低于 4 GB / 2 GB 时分别为琥珀色 / 红色
- **时间范围**：5/30 分钟按数据时间戳计算，切换 0.5/1/2 秒采样不会改变时间含义
- **实时频率**：Windows PDH 的最高核实时频率（含睿频）；不可用时显示“—”
- **等待状态**：AutoCAD 未运行时仍显示系统 CPU、可用内存与每核负载；可开启演示模式体验

## 诊断规则

| 表现 | 结论 | 处理 |
|---|---|---|
| 单核持续 ≥85% 且最忙核同步打满 | **CPU 单线程瓶颈** | 清理 Regapps、重置注释比例、修复图纸；冻结不编辑图层 |
| GPU ≥60% | **渲染管线忙** | 对比硬件加速开关；回退 DX11；使用 Studio 驱动 |
| CPU、GPU 都低但仍卡 | **等待型** | 检查失效外部参照/字体路径、杀毒扫描、天正版本匹配 |
| 系统可用内存 <2 GB | **内存压力** | 关闭大程序；大图拆分外部参照 |

## 开发

```bash
pnpm install
pnpm tauri dev                    # 开发运行
CAD_PULSE_DEMO=1 pnpm tauri dev   # 演示模式
pnpm tauri build                  # 打包（NSIS + MSI）
```

技术栈：Tauri 2 · React 19 · TypeScript；Rust 使用 [sysinfo](https://github.com/GuillaumeGomez/sysinfo)、[nvml-wrapper](https://github.com/Cldfire/nvml-wrapper)、tiny-skia 与 [window-vibrancy](https://github.com/tauri-apps/window-vibrancy)。

设计体系与质量门禁见 [DESIGN.md](DESIGN.md)。欢迎 Issue / PR。

## <a id="english"></a>English

**CAD Pulse** is a lightweight always-on-top performance monitor for AutoCAD on Windows. AutoCAD 2D drafting is mostly single-threaded, so the HUD emphasizes process CPU on a per-core scale (100% = one saturated core) with a 60-second trend, memory, GPU and live boost frequency. The dashboard adds real CPU/GPU model names, Windows-topology-based P/E core grouping, load-aware blue/amber/red colors, time-based 5/30-minute charts, diagnosis, quick commands, persistent events and one-click summary copy. Native dark acrylic has a high-contrast opaque fallback. NVIDIA metrics use NVML and represent whole-GPU load.

## License

[MIT](LICENSE) © WikG1018
