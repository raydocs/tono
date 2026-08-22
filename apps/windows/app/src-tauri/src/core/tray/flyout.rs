use std::sync::Mutex;
use std::time::{Duration, Instant};

use anyhow::Result;
use once_cell::sync::Lazy;
use tauri::utils::config::Color;
use tauri::{
    AppHandle, Manager as _, PhysicalPosition, Rect, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};
use tono_logging::{Type, logging, logging_error};

use crate::core::handle;
use crate::feat;
use crate::utils::window_manager::WindowManager;

pub const FLYOUT_LABEL: &str = "tray-flyout";
const FLYOUT_WIDTH: f64 = 280.0;
const FLYOUT_HEIGHT: f64 = 176.0;
const FLYOUT_GAP: f64 = 8.0;
const BLUR_GRACE: Duration = Duration::from_millis(400);

static LAST_SHOWN: Lazy<Mutex<Option<Instant>>> = Lazy::new(|| Mutex::new(None));

fn mark_shown() {
    if let Ok(mut guard) = LAST_SHOWN.lock() {
        *guard = Some(Instant::now());
    }
}

pub fn hide_flyout() {
    let app = handle::Handle::app_handle();
    if let Some(window) = app.get_webview_window(FLYOUT_LABEL) {
        logging_error!(Type::Tray, window.hide());
    }
}

/// Hide on focus loss, but ignore the unfocus that fires right as the window
/// is shown (Windows sends one before the click is fully processed).
pub fn on_blur() {
    let recent = LAST_SHOWN
        .lock()
        .ok()
        .and_then(|guard| *guard)
        .is_some_and(|shown| shown.elapsed() < BLUR_GRACE);
    if recent {
        return;
    }
    hide_flyout();
}

pub async fn toggle_flyout(rect: Rect, cursor: PhysicalPosition<f64>) -> Result<()> {
    let app = handle::Handle::app_handle();
    if let Some(existing) = app.get_webview_window(FLYOUT_LABEL) {
        if existing.is_visible().unwrap_or(false) {
            hide_flyout();
            return Ok(());
        }
        position_flyout(&existing, rect, cursor);
        show_flyout(&existing);
        return Ok(());
    }

    let window = build_flyout(app)?;
    position_flyout(&window, rect, cursor);
    show_flyout(&window);
    Ok(())
}

fn build_flyout(app: &AppHandle) -> Result<WebviewWindow> {
    let builder = WebviewWindowBuilder::new(app, FLYOUT_LABEL, WebviewUrl::App("/tray".into()))
        .title("Tono")
        .inner_size(FLYOUT_WIDTH, FLYOUT_HEIGHT)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .closable(false)
        .decorations(false)
        .always_on_top(true)
        .visible(false)
        .focused(true)
        .skip_taskbar(true)
        .shadow(true)
        .background_color(Color(0, 0, 0, 0));
    // macOS needs macos-private-api for transparent(); Windows/Linux expose it.
    #[cfg(not(target_os = "macos"))]
    let builder = builder.transparent(true);
    let window = builder.build()?;
    #[cfg(windows)]
    round_flyout_corners(&window);
    Ok(window)
}

#[cfg(windows)]
fn round_flyout_corners(window: &WebviewWindow) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND,
    };

    let Ok(raw) = window.hwnd() else {
        return;
    };
    let hwnd = HWND(raw.0 as *mut core::ffi::c_void);
    let preference = DWMWCP_ROUND;
    // SAFETY: hwnd is the live flyout window; the preference pointer is a
    // local that outlives the call.
    let result = unsafe {
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_WINDOW_CORNER_PREFERENCE,
            std::ptr::from_ref(&preference).cast(),
            std::mem::size_of_val(&preference) as u32,
        )
    };
    if let Err(error) = result {
        logging!(warn, Type::Tray, "flyout round corners skipped: {error}");
    }
}

fn show_flyout(window: &WebviewWindow) {
    mark_shown();
    logging_error!(Type::Tray, window.show());
    logging_error!(Type::Tray, window.set_focus());
}

fn position_flyout(window: &WebviewWindow, rect: Rect, cursor: PhysicalPosition<f64>) {
    let app = window.app_handle();
    let monitor = app
        .monitor_from_point(cursor.x, cursor.y)
        .ok()
        .flatten()
        .or_else(|| app.primary_monitor().ok().flatten());
    let scale = monitor.as_ref().map(|item| item.scale_factor()).unwrap_or(1.0);
    let icon_pos = rect.position.to_physical::<f64>(scale);
    let icon_size = rect.size.to_physical::<f64>(scale);

    let flyout_w = (FLYOUT_WIDTH * scale).round() as i32;
    let flyout_h = (FLYOUT_HEIGHT * scale).round() as i32;
    let gap = (FLYOUT_GAP * scale).round() as i32;

    let icon_x = icon_pos.x.round() as i32;
    let icon_y = icon_pos.y.round() as i32;
    let icon_w = icon_size.width.round() as i32;
    let icon_h = icon_size.height.round() as i32;

    let (mon_x, mon_y, mon_w, mon_h) = match monitor {
        Some(item) => {
            let pos = item.position();
            let size = item.size();
            (pos.x, pos.y, size.width as i32, size.height as i32)
        }
        None => (0, 0, 1920, 1080),
    };

    let mut x = icon_x + icon_w - flyout_w;
    let above = icon_y - flyout_h - gap;
    let below = icon_y + icon_h + gap;
    let mut y = if above >= mon_y { above } else { below };

    let max_x = mon_x + mon_w - flyout_w;
    let max_y = mon_y + mon_h - flyout_h;
    x = x.clamp(mon_x, max_x.max(mon_x));
    y = y.clamp(mon_y, max_y.max(mon_y));

    logging!(
        debug,
        Type::Tray,
        "tray flyout at ({x},{y}) size {flyout_w}x{flyout_h} scale {scale}"
    );
    logging_error!(
        Type::Tray,
        window.set_position(PhysicalPosition::new(x, y))
    );
}

#[tauri::command]
pub async fn tray_flyout_open_dashboard() {
    hide_flyout();
    let _ = WindowManager::show_main_window().await;
}

#[tauri::command]
pub async fn tray_flyout_quit() {
    hide_flyout();
    feat::quit().await;
}
