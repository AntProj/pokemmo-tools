// PokeMMO Tools — Windows desktop shell (Tauri v2).
//
// Boots the same React build the website ships, and adds capture commands the
// Box tab uses: `list_windows`, `capture_and_ocr`, and `flash_toast` (an
// always-on-top overlay confirmation). A global hotkey (Ctrl+Shift+B) emits a
// `capture-hotkey` event the frontend listens for.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod capture;
mod ocr;

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

#[derive(Serialize)]
struct WordOut {
    text: String,
    x: f32,
    y: f32,
    w: f32,
    h: f32,
    green: bool,
}

#[derive(Serialize)]
struct CapturePayload {
    text: String,
    width: u32,
    height: u32,
    words: Vec<WordOut>,
    shiny: bool,
    alpha: bool,
    #[serde(rename = "pngBase64")]
    png_base64: String,
}

#[derive(Deserialize)]
struct NormRect {
    x: f32,
    y: f32,
    w: f32,
    h: f32,
}

#[tauri::command]
fn list_windows() -> Vec<capture::WindowInfo> {
    capture::list_windows()
}

/// Capture a window (optionally a normalized sub-rect in 0..1), OCR it, tag each
/// word green (the in-game 31 cue), and detect the shiny/alpha corner mark.
#[tauri::command]
fn capture_and_ocr(hwnd: isize, rect: Option<NormRect>) -> Result<CapturePayload, String> {
    let (mut png, mut width, mut height) =
        capture::capture_window_png(hwnd).map_err(|e| format!("capture failed: {e}"))?;

    if let Some(rc) = rect {
        let img = image::load_from_memory(&png)
            .map_err(|e| e.to_string())?
            .to_rgba8();
        let (iw, ih) = (img.width() as f32, img.height() as f32);
        let x = (rc.x * iw).round().clamp(0.0, iw - 1.0) as u32;
        let y = (rc.y * ih).round().clamp(0.0, ih - 1.0) as u32;
        let w = (rc.w * iw).round().clamp(1.0, iw - x as f32) as u32;
        let h = (rc.h * ih).round().clamp(1.0, ih - y as f32) as u32;
        let sub = image::imageops::crop_imm(&img, x, y, w, h).to_image();
        png = capture::encode_png(&sub).map_err(|e| e.to_string())?;
        width = w;
        height = h;
    }

    let (text, words) = ocr::ocr_png(&png).map_err(|e| format!("ocr failed: {e}"))?;

    let img = image::load_from_memory(&png)
        .map_err(|e| e.to_string())?
        .to_rgba8();

    let (shiny, alpha) = detect_mark(&img, &words);

    let words_out = words
        .into_iter()
        .map(|wd| {
            let green = sample_green(&img, wd.x, wd.y, wd.w, wd.h);
            WordOut { text: wd.text, x: wd.x, y: wd.y, w: wd.w, h: wd.h, green }
        })
        .collect();

    let png_base64 = base64::engine::general_purpose::STANDARD.encode(&png);
    Ok(CapturePayload { text, width, height, words: words_out, shiny, alpha, png_base64 })
}

/// Mean color inside a word box → is it green? (G clearly dominates R and B.)
fn sample_green(img: &image::RgbaImage, x: f32, y: f32, w: f32, h: f32) -> bool {
    let (iw, ih) = (img.width() as i32, img.height() as i32);
    let x0 = (x as i32).clamp(0, iw - 1);
    let y0 = (y as i32).clamp(0, ih - 1);
    let x1 = ((x + w) as i32).clamp(x0 + 1, iw);
    let y1 = ((y + h) as i32).clamp(y0 + 1, ih);
    let (mut r, mut g, mut b, mut n) = (0u64, 0u64, 0u64, 0u64);
    for yy in y0..y1 {
        for xx in x0..x1 {
            let p = img.get_pixel(xx as u32, yy as u32);
            r += p[0] as u64;
            g += p[1] as u64;
            b += p[2] as u64;
            n += 1;
        }
    }
    if n == 0 {
        return false;
    }
    let (r, g, b) = ((r / n) as i64, (g / n) as i64, (b / n) as i64);
    g > 90 && g - r > 30 && g - b > 30
}

/// Detect the summary-panel corner mark: a yellow star = shiny, a red beast mark
/// = alpha (a normal mon has neither). The mark sits at the panel's top-left, so
/// we anchor to the bounding box of the OCR'd text and scan a small box there.
/// Thresholds are deliberately lenient; the user confirms via the Box checkbox.
fn detect_mark(img: &image::RgbaImage, words: &[ocr::WordBox]) -> (bool, bool) {
    if words.is_empty() {
        return (false, false);
    }
    let min_x = words.iter().map(|w| w.x).fold(f32::MAX, f32::min);
    let min_y = words.iter().map(|w| w.y).fold(f32::MAX, f32::min);
    let mut heights: Vec<f32> = words.iter().map(|w| w.h).filter(|h| *h > 0.0).collect();
    heights.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let med_h = if heights.is_empty() { 14.0 } else { heights[heights.len() / 2] };

    let (iw, ih) = (img.width() as i32, img.height() as i32);
    let x0 = ((min_x - 2.0 * med_h) as i32).clamp(0, iw - 1);
    let y0 = ((min_y - 0.5 * med_h) as i32).clamp(0, ih - 1);
    let x1 = ((min_x + 3.0 * med_h) as i32).clamp(x0 + 1, iw);
    let y1 = ((min_y + 3.0 * med_h) as i32).clamp(y0 + 1, ih);

    let (mut yellow, mut red, mut total) = (0u32, 0u32, 0u32);
    for yy in y0..y1 {
        for xx in x0..x1 {
            let p = img.get_pixel(xx as u32, yy as u32).0;
            let (r, g, b) = (p[0] as i32, p[1] as i32, p[2] as i32);
            total += 1;
            // Bright yellow star: high R+G, low B.
            if r > 170 && g > 150 && b < 120 && (r - b) > 70 && (g - b) > 55 {
                yellow += 1;
            }
            // Saturated red beast mark: high R, low G/B.
            else if r > 150 && g < 100 && b < 100 && (r - g) > 60 && (r - b) > 60 {
                red += 1;
            }
        }
    }
    if total == 0 {
        return (false, false);
    }
    let yf = yellow as f32 / total as f32;
    let rf = red as f32 / total as f32;
    (yf > 0.02, rf > 0.03)
}

/// Show the always-on-top toast overlay near the top of the screen with a short
/// message, then auto-hide it. `ok` tints it green (clean read) vs amber (check).
#[tauri::command]
fn flash_toast(app: tauri::AppHandle, text: String, ok: bool) {
    let Some(win) = app.get_webview_window("toast") else { return };

    // Center horizontally near the top of the primary monitor.
    if let Ok(Some(monitor)) = win.primary_monitor() {
        let size = monitor.size();
        let pos = monitor.position();
        let tw: i32 = 380;
        let x = pos.x + ((size.width as i32 - tw) / 2).max(0);
        let y = pos.y + 48;
        let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
    }

    let _ = win.show();
    let _ = win.set_always_on_top(true);
    let msg = serde_json::to_string(&text).unwrap_or_else(|_| "\"\"".into());
    let _ = win.eval(&format!("window.showToast && window.showToast({}, {})", msg, ok));

    // Auto-hide after ~1.6s.
    let w2 = win.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(1600));
        let _ = w2.hide();
    });
}

fn main() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        let _ = app.emit("capture-hotkey", ());
                    }
                })
                .build(),
        )
        .setup(|app| {
            // Register the global capture hotkey at runtime.
            use tauri_plugin_global_shortcut::GlobalShortcutExt;
            if let Err(e) = app.global_shortcut().register("CmdOrCtrl+Shift+B") {
                eprintln!("could not register capture hotkey: {e}");
            }

            // Pre-create the hidden toast overlay so flashing it later is instant.
            let handle = app.handle().clone();
            WebviewWindowBuilder::new(&handle, "toast", WebviewUrl::App("toast.html".into()))
                .title("")
                .inner_size(380.0, 92.0)
                .position(48.0, 48.0)
                .resizable(false)
                .decorations(false)
                .always_on_top(true)
                .skip_taskbar(true)
                .focused(false)
                .visible(false)
                .build()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![list_windows, capture_and_ocr, flash_toast])
        .run(tauri::generate_context!())
        .expect("error while running the PokeMMO Tools desktop shell");
}
