# CAD Pulse 设计标准 · v3 / Design Standard

> 界面与数据采集的质量门禁。目标是让监控数据在画图时快速可读，并确保指标名称与其真实口径一致。
>
> Quality gates for UI and sampling. Monitoring data must remain readable while drafting, and every metric name must match its actual semantics.

## 1. 原则 / Principles

1. **一屏一个主角 / One protagonist per view**：HUD 只突出 AutoCAD 进程 CPU 核当量；完整指标、每核负载、诊断与日志在仪表盘。
   The HUD emphasizes AutoCAD process core-equivalent CPU; the dashboard contains detailed metrics, per-core load, diagnosis and events.
2. **对比度优先于玻璃感 / Contrast before glass**：原生 Acrylic 只提供模糊，文字下层必须有足够不透明的石墨色表面。
   Native acrylic supplies blur only; text sits on sufficiently opaque graphite surfaces.
3. **颜色承担语义 / Color carries meaning**：CPU 蓝、GPU/能效核青绿、内存紫作为常态识别色；琥珀色表示负载偏高，红色表示饱和或资源压力，绿色用于健康状态与低温。
   Blue identifies CPU/P cores, teal GPU/E cores and purple memory. Amber indicates elevated load, red saturation or pressure, and green healthy state or low temperature.
4. **双语同权 / Equal bilingual support**：中英文共用同一消息结构；中文使用微软雅黑系统栈，英文使用 Segoe UI，数字与命令使用本地 JetBrains Mono。布局必须验证较长英文文案。
   Both languages share one typed message structure. Chinese uses Microsoft YaHei, English Segoe UI, and numbers/commands use bundled JetBrains Mono. Layout checks include longer English text.
5. **容器保持安静 / Quiet containers**：无渐变边框、鼠标追光、呼吸光点和卡片漂浮；动效仅用于数值、负载高度及控件反馈。
   No gradient borders, cursor lighting, breathing dots or floating cards. Motion is limited to values, load bars and control feedback.
6. **先定义口径，再解释瓶颈 / Define metrics before diagnosing**：进程核当量、最忙线程和系统最忙核必须分开；启发式诊断不能把相关性写成因果结论。
   Process core-equivalent, busiest thread and busiest system core are separate concepts. Heuristics must not present correlation as causation.

## 2. 色彩与对比度 / Color and Contrast

唯一事实来源为 `src/styles/theme.css`。The source of truth is `src/styles/theme.css`.

| Token | 值 / Value | 用途 / Use |
|---|---|---|
| `--bg` | `#10151f` | 不依赖玻璃的窗口回退底色 / Opaque window fallback |
| `--surface` / `--surface-raised` | `#171e2a` / `#1c2533` | 面板与控件 / Panels and controls |
| `--text` | `#eef2f8` | 主文字与大数字 / Primary text and large values |
| `--text-secondary` | `#aab5c6` | 标题、重要辅助数据 / Headings and key secondary data |
| `--text-muted` | `#8d99ac` | 说明与次级标签 / Descriptions and secondary labels |
| `--accent` | `#82a9ff` | CPU/P 核常态、焦点 / Normal CPU/P cores and focus |
| `--gpu` | `#6fd3c7` | GPU/E 核常态 / Normal GPU/E cores |
| `--memory` | `#b7a5f8` | 内存常态 / Normal memory state |
| `--ok` / `--warn` / `--danger` | `#72c6a5` / `#efbd72` / `#f08b82` | 健康、偏高、饱和/压力 / Healthy, elevated, saturated/pressure |

动态颜色统一由 `src/types.ts` 计算。Dynamic colors are computed in `src/types.ts`:

- CPU/P 核 `<50%` 蓝色，GPU/E 核 `<50%` 青绿色，内存压力正常时紫色。CPU/P cores below 50% are blue, GPU/E cores teal, and unconstrained memory purple.
- CPU/GPU/每核负载 `50–84%` 琥珀色、`≥85%` 红色。CPU/GPU/per-core load is amber at 50–84% and red at 85% or above.
- 系统可用内存 `<4 GB` 琥珀色、`<2 GB` 红色。Available system memory is amber below 4 GB and red below 2 GB.
- GPU 温度 `<60°C` 绿色、`60–74°C` 琥珀色、`≥75°C` 红色。GPU temperature is green below 60°C, amber at 60–74°C and red at 75°C or above.
- 大数字、曲线、核心条、卡片描边和关键统计共享阈值，不只改变装饰边框。Large values, charts, core bars, card outlines and key statistics share these thresholds.

已按 WCAG 相对亮度公式计算：文本色与全部动态数据色在 `#10151f`、`#171e2a`、`#192334`、`#1c2533` 上的最低对比度为 **5.35:1**，全部超过普通文本 4.5:1 的要求。新增文本色必须重新计算。

Using the WCAG relative-luminance formula, the minimum contrast of text and dynamic data colors against `#10151f`, `#171e2a`, `#192334` and `#1c2533` is **5.35:1**. Recalculate before adding text colors.

SVG 图表使用明确十六进制色值，不在 SVG 属性中依赖 CSS 变量解析，避免 WebView2 下曲线变黑。SVG charts use explicit hex colors rather than relying on CSS variable resolution, preventing black chart lines in WebView2.

## 3. 字体与间距 / Typography and Spacing

- 界面 / UI：`Microsoft YaHei UI` → `Microsoft YaHei` → `Segoe UI` → system sans-serif。
- 数字/命令 / Numbers and commands：本地 `JetBrains Mono`，启用 tabular numbers，无网络依赖。Bundled JetBrains Mono uses tabular numbers and has no network dependency.
- 正文 13px；辅助信息 11–12px；卡片标题 13–14px；仪表盘标题 20px。Body text is 13px, supporting text 11–12px, card titles 13–14px and the dashboard heading 20px.
- HUD 主数值 52px；仪表盘 CPU 主数值 42px；其他指标 34px。The HUD primary value is 52px, dashboard CPU 42px and other metrics 34px.
- 间距以 4px 为基数，常用 8/12/14/16/20；窗口圆角 8px、面板 12px、控件 7px。窗口圆角必须与 DWM 原生圆角一致，避免四角出现双重弧线。Spacing uses a 4px base. Window, panel and control radii are 8/12/7px; CSS and DWM window radii must match to avoid double corners.

## 4. 窗口与信息架构 / Windows and Information Architecture

- HUD 展开 `320×252`，常驻状态条 `360×48`；尺寸必须同步 `Hud.tsx` 与 `tauri.conf.json`。The expanded HUD is 320×252 and the status bar 360×48; keep component and Tauri configuration dimensions synchronized.
- 状态条顺序：进程 CPU 核当量环与数值 → GPU → 内存 → 最高频率 → 状态灯 → 展开按钮。除按钮外，任意指标区域都可拖动；无 AutoCAD 时内存栏显示系统可用内存。界面无响应时，频率位让给“无响应 N 秒”，宽度不变。The order is process core-equivalent CPU, GPU, memory, peak frequency, status light and expand. Every non-button metric area starts dragging; without AutoCAD, memory switches to system available memory. While the UI is unresponsive, the frequency slot carries the stall age instead, keeping the same width.
- 仪表盘默认 `1040×940`，最小 `920×680`；小窗口通过正文滚动访问全部内容。The dashboard defaults to 1040×940 with a 920×680 minimum; body scrolling exposes all content in smaller windows.
- 仪表盘顺序：性能概览 → CPU/GPU 硬件型号 → 指标卡 → 按 P/E 核分组的每核负载 → 诊断/速查/事件。Dashboard order: overview, hardware, metric cards, P/E-grouped system core load, diagnosis/quick commands/events.
- P/E 分类来自 Windows `GetLogicalProcessorInformationEx` 的 `EfficiencyClass` 与 `GROUP_AFFINITY`，按实际置位顺序映射到每个逻辑线程，兼容稀疏掩码；同构处理器全部显示为 P，不按核心编号或 CPU 型号猜测。多处理器组与 `sysinfo` 核心数不一致时，硬件摘要和核心图统一显示“拓扑不可用”。P/E classification uses Windows efficiency classes and affinity masks in dense set-bit order, including sparse masks. Homogeneous processors are P; never guess from model or core index. Topology/sample count mismatches degrade consistently to unavailable.
- 无 NVIDIA 时隐藏 GPU 指标卡；温度、时钟、显存允许独立显示“—”。Without NVIDIA, hide the GPU card. Temperature, clock and VRAM may independently show “—”.
- CPU 实时频率不可用时显示“—”，不能显示 `0 GHz`。Unavailable CPU frequency displays “—”, never 0 GHz.

## 5. 指标与国际化契约 / Metric and i18n Contracts

- `cpu_single_pct` 仅为兼容现有数据契约保留的字段名，真实含义是 `acad.exe` 所有线程累计的进程核当量；100% 等于一个逻辑核工作量，可超过 100%。`cpu_total_pct` 是它除以逻辑核数后的总量口径。
  `cpu_single_pct` is retained for data-contract compatibility. It sums all AutoCAD threads in core-equivalent units, where 100% is one logical core's work and values may exceed 100%. `cpu_total_pct` divides it by logical-core count.
- `busiest_thread_pct` / `busiest_thread_id` / `thread_count` 来自 Windows Toolhelp 线程枚举与 `GetThreadTimes` 的 kernel/user 时间差；100% 表示一个线程占满一个逻辑核。缓存记录创建时间，线程退出即清理，TID 复用或进程变化必须重建基线。首轮和不可用状态为 `None`，不能显示为 0%。该指标不代表已知身份的 AutoCAD 主线程。
  `busiest_thread_pct`, `busiest_thread_id` and `thread_count` use Toolhelp enumeration and `GetThreadTimes` kernel/user deltas; 100% is one thread occupying one logical core. Cached records include creation time, exited threads are removed, and TID reuse or process changes reset the baseline. Warm-up/unavailable values are null, never zero. The TID is not assumed to be AutoCAD's main thread.
- `busiest_core_pct` 与 `cores` 是 Windows 全系统指标，不是 AutoCAD 按核拆分。`busiest_core_pct` and `cores` are Windows system-wide metrics, not AutoCAD per-core attribution.
- `ui_responsive` / `ui_response_ms` / `ui_stall_sec` 来自对 `acad.exe` 主框架窗口的一次 `WM_NULL` 往返（200 ms 上限）。它只回答“界面线程还在不在处理消息”，与负载是两件事：负载说干了多少活，探针说能不能开始干活。不使用 `SMTO_ABORTIFHUNG`，因为 Windows 需 5 秒才判定挂起，会漏掉用户能感知的短冻结。
  `ui_responsive`, `ui_response_ms` and `ui_stall_sec` come from one `WM_NULL` round trip to the acad.exe main frame, capped at 200 ms. They answer only whether the UI thread still pumps messages, which is orthogonal to load: load says how much work happened, the probe says whether work can start. `SMTO_ABORTIFHUNG` is deliberately omitted because Windows needs five seconds to declare a window hung, hiding shorter freezes.
- 窗口句柄按 PID 缓存并用 `IsWindow` 校验，失效才重新枚举。这不只是省开销：窗口所属线程停止泵消息后 Windows 不再枚举它，逐帧重新枚举会把最该报告的故障判成“不可用”。缓存命中前若枚举不到任何窗口，按“未测量”处理。
  The handle is cached per PID and revalidated with `IsWindow`; only a stale handle triggers a new enumeration. This is not merely cheaper: once a window's thread stops pumping, Windows stops enumerating it, so rescanning each tick would downgrade the exact failure worth reporting to "unavailable". A miss before any handle is cached reports "unmeasured".
- `ui_responsive` 的三态不可合并：`Some(true)` 为已应答，`Some(false)` 为超时，`None` 为未测量（无窗口、权限不足、非 Windows）。只有 `Some(false)` 可以参与诊断；缺数据不得推断为无响应。
  The three states of `ui_responsive` must not be collapsed: `Some(true)` replied, `Some(false)` timed out, `None` unmeasured (no window, access denied, non-Windows). Only `Some(false)` may drive diagnosis; missing data must never imply a stall.
- 界面无响应规则优先于所有负载规则；`stall` 级别 2 秒起警告、5 秒转危险。探针可用后，低负载不再判为“等待型卡顿”，直接判为正常——那条旧结论在没有响应证据时只是猜测。
  The unresponsive rule outranks every load rule; the `stall` level warns at two seconds and turns critical at five. With probe data available, low load no longer reads as wait-type lag but as healthy — the old conclusion was a guess without response evidence.
- 语言值为 `zh-CN` / `en-US`，保存在 `localStorage` 的 `cadpulse-language`；启动时仅 HUD 在首帧后调用一次 `set_language`，用户切换时也只由操作窗口调用。Rust 同步托盘菜单、tooltip、Dashboard 原生标题，再广播 `language-changed`；接收窗口只更新本地状态，不回传命令，避免回声。原生调用失败必须返回错误并记录日志。
  Language values are zh-CN/en-US under `cadpulse-language`. At startup only the HUD calls `set_language` once after its first render; explicit switches call it only from the acting window. Rust synchronizes native surfaces and broadcasts `language-changed`; recipients update local state without echoing the command. Native failures must propagate and be logged.
- 中英文文字使用相同 `Messages` 类型，缺字段必须由 TypeScript 检出。诊断规则只返回语义等级，文案由 `diagnosisText()` 解析。
  Both dictionaries share the `Messages` type so TypeScript detects missing keys. Diagnostic rules return semantic levels; `diagnosisText()` resolves display text.
- 新事件保存 `kind + value`，不持久化固定语言句子；旧文本日志迁移后按当前语言格式化。复制摘要和日期时间使用当前语言。
  New events store kind + value rather than fixed-language sentences. Migrated legacy events, copied summaries and timestamps follow the active language.
- 型号与硬件标识不翻译；前端负责“未知/不可用”等本地化回退，Rust payload 不返回固定中文。
  Hardware model names remain unchanged. Frontend dictionaries localize unknown/unavailable states; Rust payloads contain no fixed Chinese fallback.

## 6. 交互与降级 / Interaction and Degradation

- 所有点击目标使用原生 `button`/`select`，具备焦点样式与可读标签。All click targets use native buttons/selects with focus styles and accessible labels.
- 关闭窗口只隐藏，托盘继续监控；HUD 与仪表盘保留自绘标题栏和拖动区。Closing hides windows while tray monitoring continues; custom title bars retain drag regions.
- Acrylic 失败/RDP 时使用不透明深色回退，不依赖 `backdrop-filter`。Acrylic failure or RDP uses an opaque dark fallback without relying on backdrop-filter.
- `prefers-reduced-motion` 下停用非必要动画；数字动画遵守同一偏好。Reduced-motion disables nonessential animation, including number transitions.
- 5/30 分钟和统计窗口按 `Stats.ts` 时间戳计算，不随采样率改变含义。Chart and statistics windows use sample timestamps and do not change meaning with sampling rate.

## 7. 每次改动的验收 / Acceptance Gates

- [ ] `npx tsc --noEmit`、`pnpm build`、Rust fmt/clippy/test 通过。TypeScript, production build, Rust formatting, lint and tests pass.
- [ ] 文字对比度 ≥4.5:1，使用工具计算。Text contrast is at least 4.5:1 by calculation.
- [ ] 中英文原生窗口截图检查：曲线可见、无重叠/截断，默认尺寸下内容完整。Capture native windows in both languages; charts are visible, text does not overlap or clip, and default-size content is complete.
- [ ] 实测 HUD 与状态条双向切换、状态条指标区域拖动、仪表盘口径/范围、演示开关与复制摘要。Test HUD/status-bar transitions, metric-area dragging, CPU scale/range, demo and summary copy.
- [ ] 实测语言切换在 HUD、状态条、Dashboard、托盘和原生标题同步，重启后选择保留。Verify language synchronization across every surface and persistence after restart.
- [ ] 检查真实模式、演示模式、GPU 缺失、拓扑不一致与 Acrylic 回退分支。Check real/demo modes, missing GPU, topology mismatch and acrylic fallback.
- [ ] 改动响应性探针时运行 `cargo test -- --ignored`（需要交互桌面）：自建窗口先泵消息再冻结，必须分别得到“已应答”与“超时”。When touching the responsiveness probe, run `cargo test -- --ignored` on an interactive desktop: an owned window is pumped and then frozen, and both the replied and timed-out branches must be observed.
