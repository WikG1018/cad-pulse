use serde::Serialize;
use std::ffi::OsStr;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};
use tauri::{AppHandle, Emitter};

use crate::tray;

/// One sample pushed to the frontend every tick (1 Hz by default).
///
/// `cpu_single_pct` uses the per-core convention: 100.0 = one core fully used,
/// which is the number that matters for AutoCAD's mostly single-threaded 2D
/// pipeline. `cpu_total_pct` is the task-manager style normalized figure.
#[derive(Serialize, Clone, Debug, Default)]
pub struct StatsPayload {
    pub running: bool,
    pub demo: bool,
    pub pid: u32,
    pub cpu_single_pct: f32,
    pub cpu_total_pct: f32,
    pub busiest_core_pct: f32,
    /// Per-logical-core usage, one entry per core (0-100).
    pub cores: Vec<f32>,
    /// P/E classification for each logical processor, aligned with `cores`.
    pub core_types: Vec<String>,
    pub cpu_model: String,
    /// Highest logical-core frequency in MHz (0 = unavailable).
    pub cpu_freq_mhz: u64,
    pub mem_mb: f64,
    pub gpu_model: Option<String>,
    pub gpu_pct: Option<f32>,
    pub gpu_mem_mb: Option<f64>,
    pub gpu_temp_c: Option<u32>,
    pub gpu_clock_mhz: Option<u32>,
    pub sys_cpu_pct: f32,
    pub sys_mem_avail_mb: f64,
    pub io_read_bps: f64,
    pub io_write_bps: f64,
    pub uptime_sec: u64,
    pub ts: u64,
}

/// Shared sampler state, managed by tauri and touched from menu/commands.
pub struct SamplerState {
    pub demo: AtomicBool,
    pub interval_ms: AtomicU64,
}

impl SamplerState {
    pub fn new() -> Arc<Self> {
        // CAD_PULSE_DEMO=1 starts in demo mode so the UI can be explored
        // before AutoCAD is ever launched.
        let demo = std::env::var("CAD_PULSE_DEMO")
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false);
        Arc::new(Self {
            demo: AtomicBool::new(demo),
            interval_ms: AtomicU64::new(1000),
        })
    }
}

#[derive(Clone, Debug, Default)]
struct GpuSample {
    model: String,
    pct: Option<f32>,
    mem_mb: Option<f64>,
    temp_c: Option<u32>,
    clock_mhz: Option<u32>,
}

/// NVML is initialized once; the handle lives for the process lifetime.
static NVML: OnceLock<Mutex<Option<nvml_wrapper::Nvml>>> = OnceLock::new();

fn gpu_stats() -> Option<GpuSample> {
    let cell = NVML.get_or_init(|| Mutex::new(nvml_wrapper::Nvml::init().ok()));
    let guard = cell.lock().ok()?;
    let nvml = guard.as_ref()?;
    let device = nvml.device_by_index(0).ok()?;
    Some(GpuSample {
        model: device
            .name()
            .ok()
            .filter(|name| !name.trim().is_empty())
            .unwrap_or_else(|| "NVIDIA GPU".into()),
        pct: device.utilization_rates().ok().map(|util| util.gpu as f32),
        mem_mb: device
            .memory_info()
            .ok()
            .map(|mem| mem.used as f64 / 1_048_576.0),
        temp_c: device
            .temperature(nvml_wrapper::enum_wrappers::device::TemperatureSensor::Gpu)
            .ok(),
        clock_mhz: device
            .clock_info(nvml_wrapper::enum_wrappers::device::Clock::Graphics)
            .ok(),
    })
}

fn now_ts() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

// ---------------------------------------------------------------------------
// Live CPU frequency (Windows)
//
// `CallNtPowerInformation.CurrentMhz` and sysinfo's `frequency()` both report
// the static base clock on modern Intel/AMD (HWP) parts — a 14600KF forever
// reads 3.5 GHz instead of boosting to 5.3. Task Manager computes the real
// clock as base × "% Processor Performance" (a PDH counter that exceeds 100%
// while boosting). We do the same and take the busiest processor group/core.
// ---------------------------------------------------------------------------

#[cfg(windows)]
mod live_freq {
    use std::sync::{Mutex, OnceLock};

    const PDH_FMT_DOUBLE: u32 = 0x200;
    const PROCESSOR_INFORMATION: u32 = 11;

    #[repr(C)]
    #[derive(Default, Clone, Copy)]
    struct ProcessorPowerInformation {
        number: u32,
        max_mhz: u32,
        current_mhz: u32,
        mhz_limit: u32,
        max_idle_state: u32,
        current_idle_state: u32,
    }

    #[repr(C)]
    struct FmtValue {
        c_status: u32,
        pad: u32,
        value: f64, // union: double sits at offset 8
    }

    #[link(name = "powrprof")]
    unsafe extern "system" {
        fn CallNtPowerInformation(
            level: u32,
            input: *const core::ffi::c_void,
            input_size: u32,
            output: *mut core::ffi::c_void,
            output_size: u32,
        ) -> i32;
    }

    #[link(name = "pdh")]
    unsafe extern "system" {
        fn PdhOpenQueryW(source: *const u16, user: usize, query: *mut isize) -> i32;
        fn PdhAddEnglishCounterW(
            query: isize,
            path: *const u16,
            user: usize,
            counter: *mut isize,
        ) -> i32;
        fn PdhCollectQueryData(query: isize) -> i32;
        fn PdhGetFormattedCounterValue(
            counter: isize,
            format: u32,
            counter_type: *mut u32,
            value: *mut FmtValue,
        ) -> i32;
        fn PdhExpandWildCardPathW(
            data_source: *const u16, // null = live data
            wildcard: *const u16,
            buffer: *mut u16,
            length: *mut u32,
            detail_level: u32, // PERF_DETAIL_*
        ) -> u32;
        fn PdhCloseQuery(query: isize) -> i32;
    }

    struct PdhState {
        query: isize,
        counters: Vec<isize>,
    }

    fn pdh() -> Option<&'static Mutex<Option<PdhState>>> {
        static S: OnceLock<Mutex<Option<PdhState>>> = OnceLock::new();
        Some(S.get_or_init(|| {
            // Expand the wildcard into per-core paths, then add each one as
            // its own counter — single-value reads are far more reliable than
            // PdhGetFormattedCounterArrayW on multi-wildcard paths.
            let wildcard: Vec<u16> = "\\Processor Information(*)\\% Processor Performance"
                .encode_utf16()
                .chain(std::iter::once(0))
                .collect();
            let mut len: u32 = 0;
            const PDH_MORE_DATA: u32 = 0x8000_07D2;
            const PERF_DETAIL_WIZARD: u32 = 400;
            let rc = unsafe {
                PdhExpandWildCardPathW(
                    std::ptr::null(),
                    wildcard.as_ptr(),
                    std::ptr::null_mut(),
                    &mut len,
                    PERF_DETAIL_WIZARD,
                )
            };
            if rc != PDH_MORE_DATA || len < 2 {
                return Mutex::new(None);
            }
            let mut buf = vec![0u16; len as usize];
            let rc2 = unsafe {
                PdhExpandWildCardPathW(
                    std::ptr::null(),
                    wildcard.as_ptr(),
                    buf.as_mut_ptr(),
                    &mut len,
                    PERF_DETAIL_WIZARD,
                )
            };
            if rc2 != 0 {
                return Mutex::new(None);
            }
            // msz list: NUL-separated, double-NUL terminated. Re-add the NUL
            // terminator to each path — PDH reads until NUL, without it we
            // read out of bounds.
            let paths: Vec<Vec<u16>> = buf[..len.min(buf.len() as u32) as usize]
                .split(|&c| c == 0)
                .filter(|p| !p.is_empty())
                .map(|p| {
                    let mut v = p.to_vec();
                    v.push(0);
                    v
                })
                .collect();

            let mut query = 0isize;
            if unsafe { PdhOpenQueryW(std::ptr::null(), 0, &mut query) } != 0 {
                return Mutex::new(None);
            }
            let mut counters = Vec::new();
            for p in paths {
                let s = String::from_utf16_lossy(&p);
                if s.contains("_Total") {
                    continue;
                }
                let mut c = 0isize;
                if unsafe { PdhAddEnglishCounterW(query, p.as_ptr(), 0, &mut c) } == 0 {
                    counters.push(c);
                }
            }
            if counters.is_empty() {
                unsafe { PdhCloseQuery(query) };
                return Mutex::new(None);
            }
            Mutex::new(Some(PdhState { query, counters }))
        }))
    }

    /// Base clock (MaxMhz) from the power manager; constant per boot.
    fn base_mhz(core_count: usize) -> u64 {
        static BASE: OnceLock<u64> = OnceLock::new();
        *BASE.get_or_init(|| {
            let count = core_count.clamp(1, 128);
            let mut buf = vec![ProcessorPowerInformation::default(); count];
            let size = (count * std::mem::size_of::<ProcessorPowerInformation>()) as u32;
            let ok = unsafe {
                CallNtPowerInformation(
                    PROCESSOR_INFORMATION,
                    std::ptr::null(),
                    0,
                    buf.as_mut_ptr().cast(),
                    size,
                ) == 0
            };
            if ok {
                buf.iter().map(|i| i.max_mhz as u64).max().unwrap_or(0)
            } else {
                0
            }
        })
    }

    /// Highest per-core "% Processor Performance" (>100% while boosting).
    /// Needs two collect rounds; returns None on the very first call.
    fn max_performance_pct() -> Option<f64> {
        let guard = pdh()?.lock().ok()?;
        let st = guard.as_ref()?;
        unsafe {
            if PdhCollectQueryData(st.query) != 0 {
                return None;
            }
            let mut max: f64 = 0.0;
            let mut got_any = false;
            let mut value: FmtValue = std::mem::zeroed();
            for &c in &st.counters {
                if PdhGetFormattedCounterValue(c, PDH_FMT_DOUBLE, std::ptr::null_mut(), &mut value)
                    != 0
                {
                    continue;
                }
                if value.c_status != 0 {
                    continue;
                }
                got_any = true;
                if value.value > max {
                    max = value.value;
                }
            }
            if got_any && max > 0.0 {
                Some(max)
            } else {
                None // counter set warming up (needs two collect rounds)
            }
        }
    }

    /// Highest live core clock in MHz (boost included), Task-Manager style.
    pub fn max_core_mhz(core_count: usize) -> u64 {
        let base = base_mhz(core_count);
        if base == 0 {
            return 0;
        }
        match max_performance_pct() {
            Some(pct) => (base as f64 * pct / 100.0).round() as u64,
            None => base, // PDH warm-up or unavailable: show base until ready
        }
    }
}

#[cfg(windows)]
use live_freq::max_core_mhz;

#[cfg(not(windows))]
fn max_core_mhz(_core_count: usize) -> u64 {
    0 // frequency display is Windows-only; the UI hides it at 0
}

#[cfg(all(test, windows))]
mod tests {
    /// Sanity: live clocks must read back in a plausible range, and the PDH
    /// path must warm up to a real reading (14600KF: base 3500, boost 5300).
    #[test]
    fn freq_reads_live() {
        // Warm the PDH query first.
        let _ = super::max_core_mhz(20);
        std::thread::sleep(std::time::Duration::from_millis(300));
        let idle = super::max_core_mhz(20);
        // Saturate cores, then sample again — should reach boost clocks.
        let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let mut handles = Vec::new();
        for _ in 0..4 {
            let stop = stop.clone();
            handles.push(std::thread::spawn(move || {
                let mut x = 1.0f64;
                while !stop.load(std::sync::atomic::Ordering::Relaxed) {
                    x = (x * 1.000001).sqrt();
                }
                std::hint::black_box(x);
            }));
        }
        std::thread::sleep(std::time::Duration::from_millis(1200));
        let busy = super::max_core_mhz(20);
        stop.store(true, std::sync::atomic::Ordering::Relaxed);
        for h in handles {
            let _ = h.join();
        }
        println!("freq idle={idle} busy={busy}");
        assert!(busy > 400 && busy < 7000, "implausible: {busy}");
    }
}

// ---------------------------------------------------------------------------
// Hybrid CPU topology (Windows)
// EfficiencyClass is per physical core; its group affinity maps that class to
// each logical processor. This avoids brittle core-index or model-name guesses.
// ---------------------------------------------------------------------------

#[cfg(all(windows, target_pointer_width = "64"))]
mod topology {
    use std::collections::BTreeMap;
    use std::sync::OnceLock;

    const RELATION_PROCESSOR_CORE: u32 = 0;
    static CORE_TYPES: OnceLock<Vec<String>> = OnceLock::new();

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetLogicalProcessorInformationEx(
            relationship: u32,
            buffer: *mut core::ffi::c_void,
            returned_length: *mut u32,
        ) -> i32;
    }

    pub fn core_types() -> &'static [String] {
        CORE_TYPES.get_or_init(detect).as_slice()
    }

    fn u16_at(buffer: &[u8], offset: usize) -> Option<u16> {
        Some(u16::from_ne_bytes(
            buffer.get(offset..offset + 2)?.try_into().ok()?,
        ))
    }

    fn u32_at(buffer: &[u8], offset: usize) -> Option<u32> {
        Some(u32::from_ne_bytes(
            buffer.get(offset..offset + 4)?.try_into().ok()?,
        ))
    }

    fn u64_at(buffer: &[u8], offset: usize) -> Option<u64> {
        Some(u64::from_ne_bytes(
            buffer.get(offset..offset + 8)?.try_into().ok()?,
        ))
    }

    fn classify(records: &[(u8, u16, u64)], group_masks: &BTreeMap<u16, u64>) -> Vec<String> {
        let hybrid = records.iter().any(|(efficiency, _, _)| *efficiency > 0);
        let mut types = Vec::new();
        // Iterate set bits densely: a sparse affinity bit number is not a
        // logical-core array index. Groups and bits follow Windows order.
        for (group, mask) in group_masks {
            for bit in 0..64 {
                if mask & (1_u64 << bit) == 0 {
                    continue;
                }
                let efficiency = records
                    .iter()
                    .find(|(_, record_group, record_mask)| {
                        record_group == group && record_mask & (1_u64 << bit) != 0
                    })
                    .map(|(efficiency, _, _)| *efficiency)
                    .unwrap_or(1);
                types.push(if hybrid && efficiency == 0 {
                    "E".into()
                } else {
                    "P".into()
                });
            }
        }
        types
    }

    fn detect() -> Vec<String> {
        let mut length = 0_u32;
        // First call obtains the required byte length; failure is expected.
        unsafe {
            GetLogicalProcessorInformationEx(
                RELATION_PROCESSOR_CORE,
                std::ptr::null_mut(),
                &mut length,
            );
        }
        if length == 0 {
            return Vec::new();
        }
        let mut buffer = vec![0_u8; length as usize];
        let ok = unsafe {
            GetLogicalProcessorInformationEx(
                RELATION_PROCESSOR_CORE,
                buffer.as_mut_ptr().cast(),
                &mut length,
            )
        };
        if ok == 0 {
            return Vec::new();
        }

        // x64 SYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX: header 8 bytes,
        // PROCESSOR_RELATIONSHIP: EfficiencyClass +1, GroupCount +22,
        // GROUP_AFFINITY +24; affinity: Mask +0, Group +8, size 16.
        let used = (length as usize).min(buffer.len());
        let mut offset = 0_usize;
        let mut records = Vec::new();
        let mut group_masks = BTreeMap::<u16, u64>::new();
        while offset + 48 <= used {
            let Some(size) = u32_at(&buffer, offset + 4).map(|v| v as usize) else {
                return Vec::new();
            };
            if size < 48 || offset + size > used {
                return Vec::new();
            }
            let efficiency = buffer[offset + 9];
            let group_count = u16_at(&buffer, offset + 30).unwrap_or(0);
            for i in 0..group_count as usize {
                let affinity = offset + 32 + i * 16;
                if affinity + 16 > offset + size {
                    return Vec::new();
                }
                let (Some(mask), Some(group)) =
                    (u64_at(&buffer, affinity), u16_at(&buffer, affinity + 8))
                else {
                    return Vec::new();
                };
                records.push((efficiency, group, mask));
                *group_masks.entry(group).or_default() |= mask;
            }
            offset += size;
        }

        classify(&records, &group_masks)
    }

    #[cfg(test)]
    mod tests {
        #[test]
        fn classify_uses_dense_sparse_mask_order() {
            let records = [(1, 0, 0b0101), (0, 0, 0b1010)];
            let masks = std::collections::BTreeMap::from([(0, 0b1111)]);
            assert_eq!(super::classify(&records, &masks), ["P", "E", "P", "E"]);
        }

        #[test]
        fn classify_handles_groups_and_homogeneous_cpus() {
            let records = [(1, 1, 0b1001), (0, 0, 0b0010)];
            let masks = std::collections::BTreeMap::from([(0, 0b0010), (1, 0b1001)]);
            assert_eq!(super::classify(&records, &masks), ["E", "P", "P"]);

            let homogeneous = [(0, 0, 0b1010)];
            let masks = std::collections::BTreeMap::from([(0, 0b1010)]);
            assert_eq!(super::classify(&homogeneous, &masks), ["P", "P"]);
        }

        #[test]
        fn topology_matches_sysinfo_logical_cpus() {
            let mut sys = sysinfo::System::new().expect("sysinfo init");
            sys.refresh_cpu_usage();
            let types = super::core_types();
            assert_eq!(types.len(), sys.cpus().len());
            assert!(types.iter().all(|kind| kind == "P" || kind == "E"));
            if types.iter().any(|kind| kind == "E") {
                assert!(types.iter().any(|kind| kind == "P"));
            }
        }
    }
}

#[cfg(not(all(windows, target_pointer_width = "64")))]
mod topology {
    pub fn core_types() -> &'static [String] {
        &[]
    }
}

fn processor_core_types() -> Vec<String> {
    topology::core_types().to_vec()
}

/// Synthetic waveform so the UI can be shown off without AutoCAD running.
fn demo_payload(start: &Instant, cpu_model: &str) -> StatsPayload {
    let t = start.elapsed().as_secs_f64();
    let wave = |phase: f64, amp: f64, base: f64, speed: f64| base + amp * (t * speed + phase).sin();
    let cpu = (wave(0.0, 34.0, 56.0, 0.10) + 4.0 * (t * 1.7).sin()).clamp(2.0, 100.0);
    let busiest = (cpu * 1.14 + 3.0).clamp(0.0, 100.0);
    let gpu = wave(2.1, 16.0, 14.0, 0.05).clamp(0.0, 100.0);
    let core_types = processor_core_types();
    let core_count = if core_types.is_empty() {
        20
    } else {
        core_types.len()
    };
    let busiest_index = core_count / 3;
    StatsPayload {
        running: true,
        demo: true,
        pid: 4242,
        cpu_single_pct: cpu as f32,
        cpu_total_pct: (cpu / core_count as f64) as f32,
        busiest_core_pct: busiest as f32,
        // Demo load follows the machine's actual logical-core topology.
        cores: (0..core_count)
            .map(|i| {
                if i == busiest_index {
                    busiest as f32
                } else if i % 5 == 0 {
                    (6.0 + 5.0 * ((t * 0.2) + i as f64).sin()).clamp(0.0, 100.0) as f32
                } else {
                    (2.0 + 3.0 * ((t * 0.15) + i as f64 * 0.7).sin()).clamp(0.0, 100.0) as f32
                }
            })
            .collect(),
        core_types: if core_types.is_empty() {
            vec!["P".into(); core_count]
        } else {
            core_types
        },
        cpu_model: cpu_model.to_string(),
        // demo: frequency tracks load like real boost behavior (idle ~2.2G, full ~5.3G)
        cpu_freq_mhz: (2200.0 + 3100.0 * (cpu / 100.0)).round() as u64,
        mem_mb: 1180.0 + 240.0 * (t / 45.0).sin() + 18.0 * (t * 0.9).sin(),
        gpu_model: Some(
            gpu_stats()
                .map(|g| g.model)
                .unwrap_or_else(|| "NVIDIA GPU（演示）".into()),
        ),
        gpu_pct: Some(gpu as f32),
        gpu_mem_mb: Some(2340.0 + 120.0 * (t / 30.0).sin()),
        gpu_temp_c: Some((38.0 + 12.0 * (t / 90.0).sin()).round() as u32),
        gpu_clock_mhz: Some((2100.0 + 300.0 * (t * 0.1).sin()).round() as u32),
        sys_cpu_pct: (12.0 + 7.0 * (t * 0.04).sin()).clamp(0.0, 100.0) as f32,
        sys_mem_avail_mb: 13200.0 + 600.0 * (t / 60.0).sin(),
        io_read_bps: (1.5 + 6.0 * (t * 0.8).sin().max(0.0)) * 1024.0 * 1024.0,
        io_write_bps: (0.6 + 2.4 * (t * 0.5).sin().max(0.0)) * 1024.0 * 1024.0,
        uptime_sec: t as u64,
        ts: now_ts(),
    }
}

/// Spawn the sampling thread. It never exits; it throttles to 3 s while
/// AutoCAD is not running and returns to the configured rate once found.
pub fn spawn(app: AppHandle, state: Arc<SamplerState>) {
    std::thread::spawn(move || {
        let mut sys = System::new().expect("failed to init sysinfo");
        // Prime pass so the first CPU reading after the first sleep is valid.
        sys.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            ProcessRefreshKind::everything(),
        );
        sys.refresh_cpu_usage();
        sys.refresh_memory();
        let cpu_model = sys
            .cpus()
            .first()
            .map(|cpu| cpu.brand().trim().to_string())
            .filter(|brand| !brand.is_empty())
            .unwrap_or_else(|| "未知 CPU".into());
        let detected_core_types = processor_core_types();
        // sysinfo may expose fewer logical CPUs on multi-group systems. Never
        // align a complete Windows topology with a shorter sysinfo core list.
        let core_types = if detected_core_types.len() == sys.cpus().len() {
            detected_core_types
        } else {
            Vec::new()
        };

        let mut cached_pid: Option<Pid> = None;
        let mut last_io: Option<(Instant, u64, u64)> = None;
        let demo_start = Instant::now();

        loop {
            let base_interval = state.interval_ms.load(Ordering::Relaxed).max(250);
            let not_running = cached_pid.is_none() && !state.demo.load(Ordering::Relaxed);
            let sleep_ms = if not_running { 3000 } else { base_interval };
            std::thread::sleep(Duration::from_millis(sleep_ms));

            // ---- demo mode -------------------------------------------------
            if state.demo.load(Ordering::Relaxed) {
                cached_pid = None;
                last_io = None;
                let payload = demo_payload(&demo_start, &cpu_model);
                let _ = app.emit("perf-tick", &payload);
                tray::update(&app, &payload);
                continue;
            }

            // ---- locate / refresh AutoCAD ---------------------------------
            if let Some(&pid) = cached_pid.as_ref() {
                sys.refresh_processes_specifics(
                    ProcessesToUpdate::Some(&[pid]),
                    true,
                    ProcessRefreshKind::everything(),
                );
            }
            if cached_pid.and_then(|pid| sys.process(pid)).is_none() {
                // Cache miss (first run, or AutoCAD was closed/restarted).
                sys.refresh_processes_specifics(
                    ProcessesToUpdate::All,
                    true,
                    ProcessRefreshKind::everything(),
                );
                let mut best: Option<(Pid, f32)> = None;
                for proc_ in sys.processes_by_exact_name(OsStr::new("acad.exe")) {
                    let usage = proc_.cpu_usage();
                    if best.is_none_or(|(_, b)| usage >= b) {
                        best = Some((proc_.pid(), usage));
                    }
                }
                cached_pid = best.map(|(pid, _)| pid);
                if cached_pid.is_some() {
                    // A second refresh pass for the freshly found pid so the
                    // next tick's CPU delta covers only the sleep window.
                    if let Some(pid) = cached_pid {
                        sys.refresh_processes_specifics(
                            ProcessesToUpdate::Some(&[pid]),
                            true,
                            ProcessRefreshKind::everything(),
                        );
                    }
                }
            }

            // ---- system-wide metrics --------------------------------------
            sys.refresh_memory();
            sys.refresh_cpu_usage();
            let cores: Vec<f32> = sys.cpus().iter().map(|c| c.usage()).collect();
            let core_count = cores.len().max(1) as f32;
            let busiest_core = cores.iter().cloned().fold(0.0_f32, f32::max);
            // Live per-core frequency (boost included). sysinfo's frequency()
            // is a static base clock from the registry on Windows, so a
            // 14600KF would forever read 3.5 GHz instead of boosting to 5.3.
            let cpu_freq_mhz = max_core_mhz(cores.len());
            let sys_cpu = sys.global_cpu_usage();
            let sys_avail_mb = sys.available_memory() as f64 / 1_048_576.0;

            // ---- process metrics ------------------------------------------
            let proc_info = cached_pid.and_then(|pid| sys.process(pid).map(|p| (pid, p)));
            let gpu = gpu_stats();

            let payload = match proc_info {
                Some((pid, p)) => {
                    let cpu_single = p.cpu_usage();
                    let du = p.disk_usage();
                    let now = Instant::now();
                    let (rbps, wbps) = match last_io {
                        Some((t0, r0, w0)) if now > t0 => {
                            let secs = (now - t0).as_secs_f64();
                            (
                                (du.total_read_bytes.saturating_sub(r0)) as f64 / secs,
                                (du.total_written_bytes.saturating_sub(w0)) as f64 / secs,
                            )
                        }
                        _ => (0.0, 0.0),
                    };
                    last_io = Some((now, du.total_read_bytes, du.total_written_bytes));
                    StatsPayload {
                        running: true,
                        demo: false,
                        pid: pid.as_u32(),
                        cpu_single_pct: cpu_single,
                        cpu_total_pct: cpu_single / core_count,
                        busiest_core_pct: busiest_core,
                        cores: cores.clone(),
                        core_types: core_types.clone(),
                        cpu_model: cpu_model.clone(),
                        cpu_freq_mhz,
                        mem_mb: p.memory() as f64 / 1_048_576.0,
                        gpu_model: gpu.as_ref().map(|g| g.model.clone()),
                        gpu_pct: gpu.as_ref().and_then(|g| g.pct),
                        gpu_mem_mb: gpu.as_ref().and_then(|g| g.mem_mb),
                        gpu_temp_c: gpu.as_ref().and_then(|g| g.temp_c),
                        gpu_clock_mhz: gpu.as_ref().and_then(|g| g.clock_mhz),
                        sys_cpu_pct: sys_cpu,
                        sys_mem_avail_mb: sys_avail_mb,
                        io_read_bps: rbps,
                        io_write_bps: wbps,
                        uptime_sec: p.run_time(),
                        ts: now_ts(),
                    }
                }
                None => {
                    last_io = None;
                    StatsPayload {
                        running: false,
                        demo: false,
                        pid: 0,
                        cpu_single_pct: 0.0,
                        cpu_total_pct: 0.0,
                        busiest_core_pct: busiest_core,
                        cores: cores.clone(),
                        core_types: core_types.clone(),
                        cpu_model: cpu_model.clone(),
                        cpu_freq_mhz,
                        mem_mb: 0.0,
                        gpu_model: gpu.as_ref().map(|g| g.model.clone()),
                        gpu_pct: None,
                        gpu_mem_mb: None,
                        gpu_temp_c: None,
                        gpu_clock_mhz: None,
                        sys_cpu_pct: sys_cpu,
                        sys_mem_avail_mb: sys_avail_mb,
                        io_read_bps: 0.0,
                        io_write_bps: 0.0,
                        uptime_sec: 0,
                        ts: now_ts(),
                    }
                }
            };

            let _ = app.emit("perf-tick", &payload);
            tray::update(&app, &payload);
        }
    });
}
