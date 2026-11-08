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
    /// Average current CPU frequency in MHz.
    pub cpu_freq_mhz: u64,
    pub mem_mb: f64,
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

#[derive(Clone, Copy, Debug, Default)]
struct GpuSample {
    pct: f32,
    mem_mb: f64,
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
    let util = device.utilization_rates().ok()?;
    let mem = device.memory_info().ok()?;
    Some(GpuSample {
        pct: util.gpu as f32,
        mem_mb: mem.used as f64 / 1_048_576.0,
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

/// Synthetic waveform so the UI can be shown off without AutoCAD running.
fn demo_payload(start: &Instant) -> StatsPayload {
    let t = start.elapsed().as_secs_f64();
    let wave = |phase: f64, amp: f64, base: f64, speed: f64| base + amp * (t * speed + phase).sin();
    let cpu = (wave(0.0, 34.0, 56.0, 0.10) + 4.0 * (t * 1.7).sin()).clamp(2.0, 100.0);
    let busiest = (cpu * 1.14 + 3.0).clamp(0.0, 100.0);
    let gpu = wave(2.1, 16.0, 14.0, 0.05).clamp(0.0, 100.0);
    StatsPayload {
        running: true,
        demo: true,
        pid: 4242,
        cpu_single_pct: cpu as f32,
        cpu_total_pct: (cpu * 20.0 / 100.0) as f32,
        busiest_core_pct: busiest as f32,
        // 20 logical cores; one of them carries the load, others idle-ish.
        cores: (0..20)
            .map(|i| {
                if i == 7 {
                    busiest as f32
                } else if i % 5 == 0 {
                    (6.0 + 5.0 * ((t * 0.2) + i as f64).sin()).clamp(0.0, 100.0) as f32
                } else {
                    (2.0 + 3.0 * ((t * 0.15) + i as f64 * 0.7).sin()).clamp(0.0, 100.0) as f32
                }
            })
            .collect(),
        cpu_freq_mhz: (3300.0 + 240.0 * (t * 0.2).sin()).round().max(800.0) as u64,
        mem_mb: 1180.0 + 240.0 * (t / 45.0).sin() + 18.0 * (t * 0.9).sin(),
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
                let payload = demo_payload(&demo_start);
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
            sys.refresh_cpu_specifics(sysinfo::CpuRefreshKind::everything());
            sys.refresh_cpu_usage();
            let cores: Vec<f32> = sys.cpus().iter().map(|c| c.usage()).collect();
            let core_count = cores.len().max(1) as f32;
            let busiest_core = cores.iter().cloned().fold(0.0_f32, f32::max);
            let cpu_freq_mhz = if cores.is_empty() {
                0
            } else {
                sys.cpus().iter().map(|c| c.frequency()).sum::<u64>() / cores.len() as u64
            };
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
                        cpu_freq_mhz,
                        mem_mb: p.memory() as f64 / 1_048_576.0,
                        gpu_pct: gpu.map(|g| g.pct),
                        gpu_mem_mb: gpu.map(|g| g.mem_mb),
                        gpu_temp_c: gpu.and_then(|g| g.temp_c),
                        gpu_clock_mhz: gpu.and_then(|g| g.clock_mhz),
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
                        cpu_freq_mhz,
                        mem_mb: 0.0,
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
