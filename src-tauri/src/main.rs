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
    gender: Option<String>,
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

    let (shiny, alpha) = detect_mark(&img);
    let gender = detect_gender(&img, &words);

    let words_out = words
        .into_iter()
        .map(|wd| {
            let green = sample_green(&img, wd.x, wd.y, wd.w, wd.h);
            WordOut { text: wd.text, x: wd.x, y: wd.y, w: wd.w, h: wd.h, green }
        })
        .collect();

    let png_base64 = base64::engine::general_purpose::STANDARD.encode(&png);
    Ok(CapturePayload { text, width, height, words: words_out, shiny, alpha, gender, png_base64 })
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

/// RGB (0..=255) → HSV with hue in degrees [0,360), s/v in [0,1].
fn rgb_to_hsv(r: u8, g: u8, b: u8) -> (f32, f32, f32) {
    let (rf, gf, bf) = (r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0);
    let max = rf.max(gf).max(bf);
    let min = rf.min(gf).min(bf);
    let d = max - min;
    let mut h = if d == 0.0 {
        0.0
    } else if max == rf {
        60.0 * (((gf - bf) / d) % 6.0)
    } else if max == gf {
        60.0 * (((bf - rf) / d) + 2.0)
    } else {
        60.0 * (((rf - gf) / d) + 4.0)
    };
    if h < 0.0 {
        h += 360.0;
    }
    let s = if max == 0.0 { 0.0 } else { d / max };
    (h, s, max)
}

/// Detect the summary-panel corner mark by hue: a gold/yellow star = shiny, a
/// saturated red beast mark = alpha (normal = neither). Scans the top-left
/// corner of the captured image — reliable once calibrated to the panel.
/// Hue gating separates the marks from orange/brown habitat backgrounds.
fn detect_mark(img: &image::RgbaImage) -> (bool, bool) {
    let (w, h) = (img.width(), img.height());
    if w == 0 || h == 0 {
        return (false, false);
    }
    let x1 = ((w as f32 * 0.22) as u32).max(6).min(w);
    let y1 = ((h as f32 * 0.16) as u32).max(6).min(h);
    let (mut yellow, mut red, mut total) = (0u32, 0u32, 0u32);
    for yy in 0..y1 {
        for xx in 0..x1 {
            let p = img.get_pixel(xx, yy).0;
            let (hue, s, v) = rgb_to_hsv(p[0], p[1], p[2]);
            total += 1;
            if s > 0.45 && v > 0.55 && (42.0..=66.0).contains(&hue) {
                yellow += 1; // gold star
            } else if s > 0.50 && v > 0.40 && (hue >= 348.0 || hue <= 13.0) {
                red += 1; // red beast mark
            }
        }
    }
    if total == 0 {
        return (false, false);
    }
    let yf = yellow as f32 / total as f32;
    let rf = red as f32 / total as f32;
    (yf > 0.012, rf > 0.012)
}

/// Detect gender from the colored ♂/♀ glyph that follows the species name. We
/// anchor to the "Lv." word's line, then sample just to the right of the name
/// for a blue (male) vs pink/magenta (female) hue. Returns None if unclear.
fn detect_gender(img: &image::RgbaImage, words: &[ocr::WordBox]) -> Option<String> {
    let lv = words.iter().find(|w| {
        let t = w.text.to_lowercase();
        t == "lv" || t == "lv." || t.starts_with("lv.") || t.starts_with("lv ")
    })?;
    let cy = lv.y + lv.h * 0.5;
    let gh = lv.h.max(10.0);
    // Rightmost edge of any word on the name line = end of the name.
    let line_right = words
        .iter()
        .filter(|w| ((w.y + w.h * 0.5) - cy).abs() < gh * 0.8)
        .map(|w| w.x + w.w)
        .fold(0.0f32, f32::max);

    let (iw, ih) = (img.width() as i32, img.height() as i32);
    let x0 = ((line_right + 0.1 * gh) as i32).clamp(0, iw - 1);
    let x1 = ((line_right + 2.6 * gh) as i32).clamp(x0 + 1, iw);
    let y0 = ((cy - 0.9 * gh) as i32).clamp(0, ih - 1);
    let y1 = ((cy + 0.9 * gh) as i32).clamp(y0 + 1, ih);

    let (mut male, mut female, mut total) = (0u32, 0u32, 0u32);
    for yy in y0..y1 {
        for xx in x0..x1 {
            let p = img.get_pixel(xx as u32, yy as u32).0;
            let (hue, s, v) = rgb_to_hsv(p[0], p[1], p[2]);
            if s < 0.35 || v < 0.35 {
                continue;
            }
            total += 1;
            if (198.0..=246.0).contains(&hue) {
                male += 1; // blue ♂
            } else if (300.0..=345.0).contains(&hue) || hue >= 345.0 || hue <= 8.0 {
                female += 1; // pink/red ♀
            }
        }
    }
    if total == 0 {
        return None;
    }
    let mf = male as f32 / total as f32;
    let ff = female as f32 / total as f32;
    if mf > 0.12 && male >= female {
        Some("M".into())
    } else if ff > 0.12 {
        Some("F".into())
    } else {
        None
    }
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
