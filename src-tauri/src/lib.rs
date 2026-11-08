mod sampler;
mod tray;

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Manager, WindowEvent};

/// Per-window glass status: acrylic may succeed on one window and fail on
/// another depending on session type, so each window reports its own.
static GLASS_HUD: AtomicBool = AtomicBool::new(false);
static GLASS_DASH: AtomicBool = AtomicBool::new(false);

/// Deep violet acrylic tint (r, g, b, a).
const GLASS_TINT: (u8, u8, u8, u8) = (22, 15, 46, 170);

fn try_apply_glass(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("hud") {
        let ok = window_vibrancy::apply_acrylic(&w, Some(GLASS_TINT)).is_ok();
        GLASS_HUD.store(ok, Ordering::Relaxed);
    }
    if let Some(w) = app.get_webview_window("dashboard") {
        let ok = window_vibrancy::apply_acrylic(&w, Some(GLASS_TINT)).is_ok();
        GLASS_DASH.store(ok, Ordering::Relaxed);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = sampler::SamplerState::new();
    let handles = Arc::new(tray::TrayHandles {
        demo_item: std::sync::Mutex::new(None),
    });

    tauri::Builder::default()
        // single-instance must be registered first: a second launch focuses
        // the existing windows instead of spawning a competing tray icon.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("hud") {
                let _ = w.show();
            }
            if let Some(w) = app.get_webview_window("dashboard") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .manage(state.clone())
        .manage(handles.clone())
        .invoke_handler(tauri::generate_handler![
            set_sample_interval,
            set_demo,
            open_dashboard,
            toggle_hud_window,
            glass_enabled
        ])
        .setup(move |app| {
            let app_handle = app.handle().clone();
            tray::init(&app_handle, state.clone(), handles.clone())?;
            try_apply_glass(&app_handle);
            sampler::spawn(app_handle, state);
            Ok(())
        })
        .on_window_event(|window, event| {
            // Close buttons / Alt+F4 hide windows instead of destroying them:
            // the app keeps living in the tray, and "show" from the tray
            // still works afterwards.
            if let WindowEvent::CloseRequested { api, .. } = event
                && matches!(window.label(), "dashboard" | "hud")
            {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Show + focus the dashboard window (tray left-click, HUD status line).
pub fn show_dashboard(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("dashboard") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

pub fn toggle_hud(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("hud") {
        match w.is_visible() {
            Ok(true) => {
                let _ = w.hide();
            }
            _ => {
                let _ = w.show();
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Frontend commands
// ---------------------------------------------------------------------------

#[tauri::command]
fn set_sample_interval(ms: u64, state: tauri::State<'_, Arc<sampler::SamplerState>>) {
    state.interval_ms.store(ms.max(250), Ordering::Relaxed);
}

#[tauri::command]
fn set_demo(
    on: bool,
    state: tauri::State<'_, Arc<sampler::SamplerState>>,
    handles: tauri::State<'_, Arc<tray::TrayHandles>>,
) {
    state.demo.store(on, Ordering::Relaxed);
    // keep the tray check-item in sync when toggled from the UI
    if let Some(item) = handles.demo_item.lock().unwrap().as_ref() {
        let _ = item.set_checked(on);
    }
}

#[tauri::command]
fn open_dashboard(app: AppHandle) {
    show_dashboard(&app);
}

#[tauri::command]
fn toggle_hud_window(app: AppHandle) {
    toggle_hud(&app);
}

/// Whether the native dark-glass backdrop is active for the given window
/// (frontend lowers its own background opacity when true, keeps the solid
/// fallback when false).
#[tauri::command]
fn glass_enabled(label: String) -> bool {
    match label.as_str() {
        "hud" => GLASS_HUD.load(Ordering::Relaxed),
        "dashboard" => GLASS_DASH.load(Ordering::Relaxed),
        _ => false,
    }
}
