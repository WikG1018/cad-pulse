use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Wry};
use tauri_plugin_autostart::ManagerExt;

use crate::sampler::{SamplerState, StatsPayload};

pub const TRAY_ID: &str = "main";

/// Menu ids
const ID_TOGGLE_HUD: &str = "toggle-hud";
const ID_OPEN_DASHBOARD: &str = "open-dashboard";
const ID_DEMO: &str = "demo";
const ID_AUTOSTART: &str = "autostart";
const ID_QUIT: &str = "quit";

/// Handle to the demo check-item so commands can keep its tick in sync.
pub struct TrayHandles {
    pub demo_item: Mutex<Option<CheckMenuItem<Wry>>>,
}

static TICK_COUNT: AtomicU32 = AtomicU32::new(0);

pub fn init(
    app: &AppHandle,
    state: Arc<SamplerState>,
    handles: Arc<TrayHandles>,
) -> tauri::Result<()> {
    let toggle_hud = MenuItem::with_id(app, ID_TOGGLE_HUD, "显示/隐藏悬浮窗", true, None::<&str>)?;
    let open_dash = MenuItem::with_id(app, ID_OPEN_DASHBOARD, "打开详情面板", true, None::<&str>)?;
    let demo = CheckMenuItem::with_id(
        app,
        ID_DEMO,
        "演示模式",
        true,
        state.demo.load(Ordering::Relaxed),
        None::<&str>,
    )?;
    let autostart_on = app.autolaunch().is_enabled().unwrap_or(false);
    let autostart = CheckMenuItem::with_id(
        app,
        ID_AUTOSTART,
        "开机自启",
        true,
        autostart_on,
        None::<&str>,
    )?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, ID_QUIT, "退出", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[&toggle_hud, &open_dash, &demo, &autostart, &sep, &quit],
    )?;

    *handles.demo_item.lock().unwrap() = Some(demo.clone());

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(draw_icon(0.0, false))
        .tooltip("CAD Pulse — 等待 AutoCAD…")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| {
            handle_menu_event(app, event.id().as_ref(), &state, &handles)
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                crate::show_dashboard(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

fn handle_menu_event(
    app: &AppHandle,
    id: &str,
    state: &Arc<SamplerState>,
    handles: &Arc<TrayHandles>,
) {
    match id {
        ID_TOGGLE_HUD => crate::toggle_hud(app),
        ID_OPEN_DASHBOARD => crate::show_dashboard(app),
        ID_DEMO => {
            let next = !state.demo.load(Ordering::Relaxed);
            state.demo.store(next, Ordering::Relaxed);
            if let Some(item) = handles.demo_item.lock().unwrap().as_ref() {
                let _ = item.set_checked(next);
            }
        }
        ID_AUTOSTART => {
            let al = app.autolaunch();
            match al.is_enabled() {
                Ok(true) => {
                    let _ = al.disable();
                }
                _ => {
                    let _ = al.enable();
                }
            }
        }
        ID_QUIT => app.exit(0),
        _ => {}
    }
}

/// Called every sampler tick: redraw the ring icon, refresh the tooltip
/// every other tick so hover text does not flicker.
pub fn update(app: &AppHandle, p: &StatsPayload) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    let pct = if p.running {
        p.cpu_single_pct.clamp(0.0, 100.0)
    } else {
        0.0
    };
    let _ = tray.set_icon(Some(draw_icon(pct, p.running)));
    let tick = TICK_COUNT.fetch_add(1, Ordering::Relaxed);
    if tick.is_multiple_of(2) {
        let _ = tray.set_tooltip(Some(tooltip_text(p)));
    }
}

fn tooltip_text(p: &StatsPayload) -> String {
    if !p.running {
        return format!(
            "CAD Pulse\n状态  等待 AutoCAD…\n系统  CPU {:.0}% · 可用内存 {}",
            p.sys_cpu_pct,
            format_mb(p.sys_mem_avail_mb)
        );
    }
    let gpu = match (p.gpu_pct, p.gpu_mem_mb) {
        (Some(g), Some(m)) => format!("{:.0}% ({})", g, format_mb(m)),
        (Some(g), None) => format!("{:.0}%", g),
        _ => "不可用".into(),
    };
    format!(
        "CAD Pulse\nCPU   {:.0}%（单核口径，100% = 1 核满载）\n内存  {}\nGPU   {}\n运行  {}",
        p.cpu_single_pct,
        format_mb(p.mem_mb),
        gpu,
        format_uptime(p.uptime_sec),
    )
}

fn format_mb(mb: f64) -> String {
    if mb >= 1024.0 {
        format!("{:.1} GB", mb / 1024.0)
    } else {
        format!("{:.0} MB", mb)
    }
}

fn format_uptime(s: u64) -> String {
    let h = s / 3600;
    let m = (s % 3600) / 60;
    let sec = s % 60;
    if h > 0 {
        format!("{}:{:02}:{:02}", h, m, sec)
    } else {
        format!("{}:{:02}", m, sec)
    }
}

// ---------------------------------------------------------------------------
// Tray icon: 32x32 progress ring drawn with tiny-skia.
// ---------------------------------------------------------------------------

const ICON_SIZE: u32 = 32;

pub fn draw_icon(pct: f32, running: bool) -> tauri::image::Image<'static> {
    let mut pm = tiny_skia::Pixmap::new(ICON_SIZE, ICON_SIZE).expect("pixmap");
    let (cx, cy, r) = (16.0_f32, 16.0_f32, 11.0_f32);

    // Track ring.
    let track = arc_path(cx, cy, r, -90.0, 360.0);
    stroke(
        &mut pm,
        &track,
        if running {
            (130, 169, 255, 70)
        } else {
            (110, 110, 130, 60)
        },
        5.0,
    );

    // Progress arc.
    if running && pct > 1.0 {
        let sweep = 360.0 * pct.clamp(0.0, 100.0) / 100.0;
        let arc = arc_path(cx, cy, r, -90.0, sweep);
        let color = if pct < 50.0 {
            (130, 169, 255, 255) // data blue
        } else if pct < 85.0 {
            (251, 191, 36, 255) // amber
        } else {
            (248, 113, 113, 255) // red
        };
        stroke(&mut pm, &arc, color, 5.0);
        // Center dot mirrors the load color.
        let mut pb = tiny_skia::PathBuilder::new();
        pb.push_circle(cx, cy, 2.0);
        if let Some(dot) = pb.finish() {
            let mut paint = tiny_skia::Paint::default();
            paint.set_color_rgba8(color.0, color.1, color.2, color.3);
            paint.anti_alias = true;
            pm.fill_path(
                &dot,
                &paint,
                tiny_skia::FillRule::Winding,
                tiny_skia::Transform::identity(),
                None,
            );
        }
    }

    let rgba = un_premultiply(pm.data(), (pm.width() * pm.height()) as usize);
    tauri::image::Image::new_owned(rgba, pm.width(), pm.height())
}

fn arc_path(cx: f32, cy: f32, r: f32, start_deg: f32, sweep_deg: f32) -> tiny_skia::Path {
    let mut pb = tiny_skia::PathBuilder::new();
    let steps = ((sweep_deg.abs() / 8.0).ceil() as usize).max(2);
    for i in 0..=steps {
        let a = (start_deg + sweep_deg * i as f32 / steps as f32).to_radians();
        let (x, y) = (cx + r * a.cos(), cy + r * a.sin());
        if i == 0 {
            pb.move_to(x, y);
        } else {
            pb.line_to(x, y);
        }
    }
    pb.finish()
        .unwrap_or_else(|| tiny_skia::PathBuilder::new().finish().unwrap())
}

fn stroke(pm: &mut tiny_skia::Pixmap, path: &tiny_skia::Path, rgba: (u8, u8, u8, u8), width: f32) {
    let mut paint = tiny_skia::Paint::default();
    paint.set_color_rgba8(rgba.0, rgba.1, rgba.2, rgba.3);
    paint.anti_alias = true;
    let stroke = tiny_skia::Stroke {
        width,
        line_cap: tiny_skia::LineCap::Round,
        line_join: tiny_skia::LineJoin::Round,
        ..Default::default()
    };
    pm.stroke_path(
        path,
        &paint,
        &stroke,
        tiny_skia::Transform::identity(),
        None,
    );
}

/// tiny-skia stores premultiplied alpha; tauri wants straight RGBA.
fn un_premultiply(data: &[u8], px_count: usize) -> Vec<u8> {
    let mut out = data.to_vec();
    for i in 0..px_count {
        let o = i * 4;
        let a = out[o + 3] as u32;
        if a == 0 || a == 255 {
            continue;
        }
        for c in 0..3 {
            let v = out[o + c] as u32;
            out[o + c] = ((v * 255 + a / 2) / a).min(255) as u8;
        }
    }
    out
}
