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
/// `cpu_single_pct` is process-wide core-equivalent CPU: all acad.exe threads
/// summed, where 100.0 equals one logical core's work. It is not the load of a
/// single core or thread. `cpu_total_pct` is normalized by logical-core count.
#[derive(Serialize, Clone, Debug, Default)]
pub struct StatsPayload {
    pub running: bool,
    pub demo: bool,
    pub pid: u32,
    pub cpu_single_pct: f32,
    pub cpu_total_pct: f32,
    pub busiest_core_pct: f32,
    /// Busiest acad.exe thread, measured from its own kernel/user time deltas.
    /// None means warming up or unavailable; 100% is one logical core's work.
    pub busiest_thread_pct: Option<f32>,
    pub busiest_thread_id: Option<u32>,
    pub thread_count: u32,
    /// AutoCAD UI-thread responsiveness, measured by a WM_NULL round trip.
    /// `None` means the probe could not run (no window, access denied, or a
    /// non-Windows build) and is not evidence either way. `Some(false)` means
    /// the message pump missed the deadline: the only direct sign of a stall.
    pub ui_responsive: Option<bool>,
    /// Round-trip latency of a successful probe, or the timeout that was missed.
    pub ui_response_ms: Option<u32>,
    /// Seconds since the UI thread first missed a probe; 0 while responsive.
    pub ui_stall_sec: u64,
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
// AutoCAD per-thread CPU (Windows)
//
// Thread times are cumulative 100 ns units. Sampling their delta gives a true
// per-thread core-equivalent value regardless of which logical core ran it.
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, Default)]
pub struct ThreadSample {
    pub busiest_pct: Option<f32>,
    pub busiest_id: Option<u32>,
    pub count: u32,
}

#[cfg(windows)]
mod thread_cpu {
    use super::ThreadSample;
    use std::collections::HashMap;
    use std::time::Instant;

    type Handle = *mut core::ffi::c_void;
    const TH32CS_SNAPTHREAD: u32 = 0x0000_0004;
    const THREAD_QUERY_LIMITED_INFORMATION: u32 = 0x0800;
    const INVALID_HANDLE_VALUE: Handle = -1_isize as Handle;

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct ThreadEntry32 {
        size: u32,
        usage: u32,
        thread_id: u32,
        owner_process_id: u32,
        base_priority: i32,
        delta_priority: i32,
        flags: u32,
    }

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn CreateToolhelp32Snapshot(flags: u32, process_id: u32) -> Handle;
        fn Thread32First(snapshot: Handle, entry: *mut ThreadEntry32) -> i32;
        fn Thread32Next(snapshot: Handle, entry: *mut ThreadEntry32) -> i32;
        fn OpenThread(access: u32, inherit_handle: i32, thread_id: u32) -> Handle;
        fn GetThreadTimes(
            thread: Handle,
            creation: *mut u64,
            exit: *mut u64,
            kernel: *mut u64,
            user: *mut u64,
        ) -> i32;
        fn CloseHandle(handle: Handle) -> i32;
    }

    #[derive(Clone, Copy)]
    struct ThreadTime {
        creation: u64,
        total: u64,
        at: Instant,
    }

    #[derive(Default)]
    pub struct ThreadCpuSampler {
        pid: Option<u32>,
        previous: HashMap<u32, ThreadTime>,
    }

    impl ThreadCpuSampler {
        pub fn reset(&mut self) {
            self.pid = None;
            self.previous.clear();
        }

        pub fn sample(&mut self, pid: u32) -> ThreadSample {
            if self.pid != Some(pid) {
                self.previous.clear();
                self.pid = Some(pid);
            }
            let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0) };
            if snapshot == INVALID_HANDLE_VALUE {
                return ThreadSample::default();
            }

            let now = Instant::now();
            let mut current = HashMap::new();
            let mut result = ThreadSample::default();
            let mut entry = ThreadEntry32 {
                size: std::mem::size_of::<ThreadEntry32>() as u32,
                usage: 0,
                thread_id: 0,
                owner_process_id: 0,
                base_priority: 0,
                delta_priority: 0,
                flags: 0,
            };
            let mut ok = unsafe { Thread32First(snapshot, &mut entry) } != 0;
            while ok {
                if entry.owner_process_id == pid {
                    result.count += 1;
                    if let Some(times) = read_thread_times(entry.thread_id) {
                        if let Some(previous) = self.previous.get(&entry.thread_id)
                            && previous.creation == times.0
                            && times.1 >= previous.total
                        {
                            let elapsed = now.duration_since(previous.at).as_secs_f64();
                            if elapsed > 0.0 {
                                let pct = usage_pct(times.1 - previous.total, elapsed);
                                if result.busiest_pct.is_none_or(|best| pct > best) {
                                    result.busiest_pct = Some(pct);
                                    result.busiest_id = Some(entry.thread_id);
                                }
                            }
                        }
                        current.insert(
                            entry.thread_id,
                            ThreadTime {
                                creation: times.0,
                                total: times.1,
                                at: now,
                            },
                        );
                    }
                }
                ok = unsafe { Thread32Next(snapshot, &mut entry) } != 0;
            }
            unsafe { CloseHandle(snapshot) };
            self.previous = current;
            result
        }
    }

    /// Returns (creation time, kernel + user time), all in 100 ns units.
    fn read_thread_times(thread_id: u32) -> Option<(u64, u64)> {
        let handle = unsafe { OpenThread(THREAD_QUERY_LIMITED_INFORMATION, 0, thread_id) };
        if handle.is_null() {
            return None;
        }
        let (mut creation, mut exit, mut kernel, mut user) = (0_u64, 0_u64, 0_u64, 0_u64);
        let ok =
            unsafe { GetThreadTimes(handle, &mut creation, &mut exit, &mut kernel, &mut user) }
                != 0;
        unsafe { CloseHandle(handle) };
        ok.then_some((creation, kernel.saturating_add(user)))
    }

    fn usage_pct(delta_100ns: u64, elapsed_secs: f64) -> f32 {
        if elapsed_secs <= 0.0 {
            return 0.0;
        }
        (delta_100ns as f64 / 100_000.0 / elapsed_secs).clamp(0.0, 100.0) as f32
    }

    #[cfg(test)]
    mod tests {
        #[test]
        fn thread_time_delta_uses_core_equivalent_scale() {
            assert_eq!(super::usage_pct(5_000_000, 0.5), 100.0);
            assert_eq!(super::usage_pct(2_500_000, 0.5), 50.0);
            assert_eq!(super::usage_pct(5_000_000, 0.0), 0.0);
        }

        #[test]
        fn samples_a_live_busy_thread() {
            #[link(name = "kernel32")]
            unsafe extern "system" {
                fn GetCurrentProcessId() -> u32;
            }
            let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
            let worker_stop = stop.clone();
            let worker = std::thread::spawn(move || {
                let mut x = 1.0_f64;
                while !worker_stop.load(std::sync::atomic::Ordering::Relaxed) {
                    x = (x * 1.000001).sqrt();
                }
                std::hint::black_box(x);
            });
            std::thread::sleep(std::time::Duration::from_millis(50));
            let mut sampler = super::ThreadCpuSampler::default();
            let pid = unsafe { GetCurrentProcessId() };
            let baseline = sampler.sample(pid);
            assert!(baseline.count >= 2);
            assert!(baseline.busiest_pct.is_none());
            std::thread::sleep(std::time::Duration::from_millis(400));
            let measured = sampler.sample(pid);
            stop.store(true, std::sync::atomic::Ordering::Relaxed);
            worker.join().expect("worker thread");
            assert!(measured.count >= 2);
            let busiest = measured.busiest_pct.expect("second sample has deltas");
            assert!(busiest > 5.0, "busy thread was not measured: {busiest}");
        }
    }
}

#[cfg(windows)]
use thread_cpu::ThreadCpuSampler;

#[cfg(not(windows))]
#[derive(Default)]
pub struct ThreadCpuSampler;

#[cfg(not(windows))]
impl ThreadCpuSampler {
    pub fn reset(&mut self) {}
    pub fn sample(&mut self, _pid: u32) -> ThreadSample {
        ThreadSample::default()
    }
}

// ---------------------------------------------------------------------------
// AutoCAD UI responsiveness (Windows)
//
// CPU load cannot separate "compute-bound" from "blocked": a process can sit at
// 3% while its UI thread waits on a lock, an unreachable network path or a
// modal dialog. A WM_NULL round trip answers that directly — it returns only
// when the target thread pumps its message queue. The probe is read-only:
// nothing that could change AutoCAD state is sent, and the timeout bounds our
// own blocking to one short call per tick.
// ---------------------------------------------------------------------------

const UI_PROBE_TIMEOUT_MS: u32 = 200;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UiReply {
    /// The message pump answered; value is the round-trip latency in ms.
    Replied(u32),
    /// No answer within the budget: the UI thread is not pumping messages.
    Stalled(u32),
    /// No window to probe, or the OS refused it. Says nothing about load.
    Unavailable,
}

/// Accumulates how long the UI thread has been unreachable across ticks.
///
/// Kept apart from the probe so the rule is testable without real windows or
/// real sleeps: a single missed probe is jitter, a run of them is a freeze.
#[derive(Default, Debug)]
pub struct StallTracker {
    started: Option<Instant>,
}

impl StallTracker {
    /// Whole seconds since the first miss in the current run; 0 once a reply lands.
    pub fn record(&mut self, replied: bool, now: Instant) -> u64 {
        if replied {
            self.started = None;
            return 0;
        }
        let started = *self.started.get_or_insert(now);
        now.saturating_duration_since(started).as_secs()
    }

    pub fn reset(&mut self) {
        self.started = None;
    }
}

#[cfg(windows)]
mod window_probe {
    use std::time::Instant;

    use super::UiReply;

    const WM_NULL: u32 = 0x0000;
    const GW_OWNER: u32 = 4;
    const ERROR_ACCESS_DENIED: i32 = 5;
    const ERROR_INVALID_WINDOW_HANDLE: i32 = 1400;

    #[link(name = "user32")]
    unsafe extern "system" {
        fn EnumWindows(
            callback: Option<unsafe extern "system" fn(isize, isize) -> i32>,
            lparam: isize,
        ) -> i32;
        fn GetWindowThreadProcessId(hwnd: isize, pid: *mut u32) -> u32;
        fn IsWindowVisible(hwnd: isize) -> i32;
        fn IsWindow(hwnd: isize) -> i32;
        fn GetWindow(hwnd: isize, cmd: u32) -> isize;
        fn GetWindowTextLengthW(hwnd: isize) -> i32;
        fn SendMessageTimeoutW(
            hwnd: isize,
            msg: u32,
            wparam: usize,
            lparam: isize,
            flags: u32,
            timeout: u32,
            result: *mut usize,
        ) -> isize;
    }

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn SetLastError(code: u32);
    }

    struct Search {
        pid: u32,
        best: Option<(isize, i32)>,
    }

    unsafe extern "system" fn visit(hwnd: isize, lparam: isize) -> i32 {
        let search = unsafe { &mut *(lparam as *mut Search) };
        let mut owner_pid = 0_u32;
        unsafe { GetWindowThreadProcessId(hwnd, &mut owner_pid) };
        if owner_pid != search.pid {
            return 1;
        }
        // Only the frame is a useful target: visible, unowned and titled.
        // Floating palettes share the same UI thread, so the longest title is
        // a safe tie-break rather than a fragile window-class guess.
        if unsafe { IsWindowVisible(hwnd) } == 0 || unsafe { GetWindow(hwnd, GW_OWNER) } != 0 {
            return 1;
        }
        let title = unsafe { GetWindowTextLengthW(hwnd) };
        if title <= 0 {
            return 1;
        }
        if search.best.is_none_or(|(_, best)| title > best) {
            search.best = Some((hwnd, title));
        }
        1
    }

    fn find(pid: u32) -> Option<isize> {
        let mut search = Search { pid, best: None };
        let ok = unsafe { EnumWindows(Some(visit), &mut search as *mut Search as isize) };
        if ok == 0 {
            return None;
        }
        search.best.map(|(hwnd, _)| hwnd)
    }

    /// Handle cache keyed by PID.
    ///
    /// Enumeration is not just wasted work every tick: Windows stops reporting
    /// a window from a thread that has stopped pumping, so re-enumerating during
    /// a freeze would turn the very state we want to report into "unavailable".
    static CACHE: std::sync::Mutex<Option<(u32, isize)>> = std::sync::Mutex::new(None);

    fn handle(pid: u32) -> Option<isize> {
        let mut cache = CACHE.lock().ok()?;
        match *cache {
            Some((cached_pid, hwnd)) if cached_pid == pid && unsafe { IsWindow(hwnd) } != 0 => {
                return Some(hwnd);
            }
            _ => {}
        }
        let hwnd = find(pid)?;
        *cache = Some((pid, hwnd));
        Some(hwnd)
    }

    fn invalidate() {
        if let Ok(mut cache) = CACHE.lock() {
            *cache = None;
        }
    }

    /// One read-only round trip against PID's main window.
    ///
    /// No SMTO_ABORTIFHUNG: Windows only flags a window "hung" after five
    /// seconds without pumping, which would hide every shorter freeze. Waiting
    /// our own 200 ms catches sub-second stalls that a user still feels.
    pub fn probe(pid: u32, timeout_ms: u32) -> UiReply {
        let Some(hwnd) = handle(pid) else {
            return UiReply::Unavailable;
        };
        let mut result = 0_usize;
        unsafe { SetLastError(0) };
        let started = Instant::now();
        let ok = unsafe { SendMessageTimeoutW(hwnd, WM_NULL, 0, 0, 0, timeout_ms, &mut result) };
        if ok != 0 {
            let ms = started.elapsed().as_millis().min(u32::MAX as u128) as u32;
            return UiReply::Replied(ms);
        }
        match std::io::Error::last_os_error().raw_os_error() {
            // A stale handle or an integrity-level mismatch reports on access,
            // not on load, so never turn it into a stall claim.
            Some(ERROR_INVALID_WINDOW_HANDLE) | Some(ERROR_ACCESS_DENIED) => {
                invalidate();
                UiReply::Unavailable
            }
            // ERROR_TIMEOUT (1460) is the documented result; a few builds
            // leave the error at 0 for the same outcome.
            _ => UiReply::Stalled(timeout_ms),
        }
    }

    #[cfg(test)]
    mod probe_tests {
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::sync::mpsc;
        use std::time::Duration;

        use super::UiReply;

        const WS_POPUP: u32 = 0x8000_0000;
        const WS_VISIBLE: u32 = 0x1000_0000;
        const PM_REMOVE: u32 = 0x0001;

        /// MSG is never inspected, so a padded buffer avoids layout guessing.
        #[repr(C, align(8))]
        struct Msg([u8; 64]);

        #[link(name = "user32")]
        unsafe extern "system" {
            fn CreateWindowExW(
                ex_style: u32,
                class: *const u16,
                name: *const u16,
                style: u32,
                x: i32,
                y: i32,
                w: i32,
                h: i32,
                parent: isize,
                menu: isize,
                instance: isize,
                param: *mut core::ffi::c_void,
            ) -> isize;
            fn DestroyWindow(hwnd: isize) -> i32;
            fn PeekMessageW(msg: *mut Msg, hwnd: isize, min: u32, max: u32, remove: u32) -> i32;
            fn TranslateMessage(msg: *const Msg) -> i32;
            fn DispatchMessageW(msg: *const Msg) -> isize;
        }

        /// A window that pumps on demand and then freezes is the only honest
        /// way to check both branches: a real target never hangs when asked.
        #[test]
        #[ignore = "needs an interactive Windows desktop"]
        fn probe_separates_pumping_from_frozen() {
            let (tx, rx) = mpsc::channel();
            let stop = std::sync::Arc::new(AtomicBool::new(false));
            let thread_stop = stop.clone();

            let worker = std::thread::spawn(move || {
                let class: Vec<u16> = "STATIC\0".encode_utf16().collect();
                let title: Vec<u16> = "cad-pulse probe target\0".encode_utf16().collect();
                let hwnd = unsafe {
                    CreateWindowExW(
                        0,
                        class.as_ptr(),
                        title.as_ptr(),
                        WS_POPUP | WS_VISIBLE,
                        0,
                        0,
                        200,
                        120,
                        0,
                        0,
                        0,
                        std::ptr::null_mut(),
                    )
                };
                if hwnd == 0 {
                    return;
                }
                let _ = tx.send(hwnd);
                let mut msg = Msg([0; 64]);
                while !thread_stop.load(Ordering::Relaxed) {
                    while unsafe { PeekMessageW(&mut msg, 0, 0, 0, PM_REMOVE) } != 0 {
                        unsafe {
                            TranslateMessage(&msg);
                            DispatchMessageW(&msg);
                        }
                    }
                    std::thread::sleep(Duration::from_millis(5));
                }
                // The freeze: sit in a blocking sleep without retrieving messages.
                std::thread::sleep(Duration::from_millis(2500));
                unsafe { DestroyWindow(hwnd) };
            });

            let pid = std::process::id();
            rx.recv_timeout(Duration::from_secs(5))
                .expect("window was not created");
            std::thread::sleep(Duration::from_millis(200));

            match super::probe(pid, 500) {
                UiReply::Replied(ms) => assert!(ms < 500, "latency {ms} ms exceeded the budget"),
                other => panic!("pumping window was not detected: {other:?}"),
            }

            stop.store(true, Ordering::Relaxed);
            std::thread::sleep(Duration::from_millis(200));
            assert_eq!(super::probe(pid, 150), UiReply::Stalled(150));

            worker.join().expect("worker thread");
        }
    }
}

#[cfg(not(windows))]
mod window_probe {
    use super::UiReply;

    pub fn probe(_pid: u32, _timeout_ms: u32) -> UiReply {
        UiReply::Unavailable
    }
}

#[cfg(test)]
mod stall_tests {
    use super::StallTracker;
    use std::time::{Duration, Instant};

    #[test]
    fn stall_counts_from_first_miss_and_clears_on_reply() {
        let start = Instant::now();
        let mut tracker = StallTracker::default();
        // One missed probe is jitter, not a stall.
        assert_eq!(tracker.record(false, start), 0);
        assert_eq!(tracker.record(false, start + Duration::from_secs(1)), 1);
        assert_eq!(tracker.record(false, start + Duration::from_secs(3)), 3);
        assert_eq!(
            tracker.record(false, start + Duration::from_millis(4_500)),
            4
        );
        // A reply closes the run, and the next miss starts from zero again.
        assert_eq!(tracker.record(true, start + Duration::from_secs(5)), 0);
        assert_eq!(tracker.record(false, start + Duration::from_secs(6)), 0);
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
    // A freeze every 90 s so the stall UI can be inspected without AutoCAD.
    let stalled = (t % 90.0) > 82.0;
    StatsPayload {
        running: true,
        demo: true,
        pid: 4242,
        cpu_single_pct: cpu as f32,
        cpu_total_pct: (cpu / core_count as f64) as f32,
        busiest_core_pct: busiest as f32,
        busiest_thread_pct: Some((cpu * 0.92 + 5.0).clamp(0.0, 100.0) as f32),
        busiest_thread_id: Some(4243),
        thread_count: 24,
        ui_responsive: Some(!stalled),
        ui_response_ms: Some(if stalled {
            UI_PROBE_TIMEOUT_MS
        } else {
            (2.0 + 4.0 * (t * 1.3).sin().abs()) as u32
        }),
        ui_stall_sec: if stalled {
            ((t % 90.0) - 82.0) as u64
        } else {
            0
        },
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
                .unwrap_or_else(|| "NVIDIA GPU".into()),
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
            .unwrap_or_default();
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
        let mut thread_cpu = ThreadCpuSampler::default();
        let mut stall = StallTracker::default();
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
                thread_cpu.reset();
                stall.reset();
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
                    let thread = thread_cpu.sample(pid.as_u32());
                    // Ask the UI thread whether it is still pumping messages.
                    // Load numbers describe work done; only this describes work
                    // that cannot start.
                    let (ui_responsive, ui_response_ms) =
                        match window_probe::probe(pid.as_u32(), UI_PROBE_TIMEOUT_MS) {
                            UiReply::Replied(ms) => (Some(true), Some(ms)),
                            UiReply::Stalled(ms) => (Some(false), Some(ms)),
                            UiReply::Unavailable => (None, None),
                        };
                    let ui_stall_sec = match ui_responsive {
                        Some(false) => stall.record(false, Instant::now()),
                        _ => {
                            stall.reset();
                            0
                        }
                    };
                    StatsPayload {
                        running: true,
                        demo: false,
                        pid: pid.as_u32(),
                        cpu_single_pct: cpu_single,
                        cpu_total_pct: cpu_single / core_count,
                        busiest_core_pct: busiest_core,
                        busiest_thread_pct: thread.busiest_pct,
                        busiest_thread_id: thread.busiest_id,
                        thread_count: thread.count,
                        ui_responsive,
                        ui_response_ms,
                        ui_stall_sec,
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
                    thread_cpu.reset();
                    stall.reset();
                    StatsPayload {
                        running: false,
                        demo: false,
                        pid: 0,
                        cpu_single_pct: 0.0,
                        cpu_total_pct: 0.0,
                        busiest_core_pct: busiest_core,
                        busiest_thread_pct: None,
                        busiest_thread_id: None,
                        thread_count: 0,
                        ui_responsive: None,
                        ui_response_ms: None,
                        ui_stall_sec: 0,
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
