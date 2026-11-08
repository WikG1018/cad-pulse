# Changelog

## v0.1.0 (2026-11-09)

首个公开版本。

### 功能
- 悬浮 HUD：CPU（单核口径）/ 内存实时曲线、每核负载条、GPU·温度、CPU 频率、运行时长、自动诊断行；可拖动、可折叠迷你条、置顶
- 详情面板：5/30 分钟三曲线卡（峰值/均值/频率/显存）、每核实时负载、事件日志（启动/关闭/CPU 持续满载/GPU 繁忙/内存吃紧，本地持久化）、诊断建议、CAD 卡顿速查命令、一键复制摘要
- 托盘：环形图标实时变色（紫→琥珀→红）、悬停多行摘要、左键开面板、右键菜单（悬浮窗/面板/演示模式/开机自启/退出）
- AutoCAD 未运行自动降频轮询；演示模式（环境变量 `CAD_PULSE_DEMO=1` 或界面开关）
- Windows 原生 Acrylic 暗色玻璃（远程桌面下自动回退）；单实例保护；窗口关闭转为后台驻留

### 技术
- Tauri 2 + React 18 + TypeScript；Rust：sysinfo / nvml-wrapper / tiny-skia / window-vibrancy / autostart / single-instance
- 设计体系见 [DESIGN.md](DESIGN.md)：语义 HSL token、Inter + JetBrains Mono、渐变边框、rAF 数字滚动、WCAG AA 对比度
