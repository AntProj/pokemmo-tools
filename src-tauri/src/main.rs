// PokeMMO Tools — Windows desktop shell (Tauri v2).
//
// Boots the same React build the website ships, and adds two capture commands
// the Box tab uses: `list_windows` and `capture_and_ocr`. A global hotkey
// (Ctrl+Shift+B) fires a `capture-hotkey` event the frontend listens for.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod capture;
mod ocr;

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use tauri::Emitter;

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

/// Capture a window (optionally a normalized sub-rect in 0..1), OCR it, and tag
/// each word with whether its cell is green (the in-game 31 cue).
#[tauri::command]
fn capture_and_ocr(hwnd: isize, rect: Option<NormRect>) -> Result<CapturePayload, String> {
    let (mut png, mut width, mut height) =
        capture::capture_window_png(hwnd).map_err(|e| format!("capture failed: {e}"))?;

    // Optional crop to a calibrated sub-rect of the window.
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

    // Green sampling needs pixels — decode the (possibly cropped) PNG once more.
    let img = image::load_from_memory(&png)
        .map_err(|e| e.to_string())?
        .to_rgba8();
    let words_out = words
        .into_iter()
        .map(|wd| {
            let green = sample_green(&img, wd.x, wd.y, wd.w, wd.h);
            WordOut { text: wd.text, x: wd.x, y: wd.y, w: wd.w, h: wd.h, green }
        })
        .collect();

    let png_base64 = base64::engine::general_purpose::STANDARD.encode(&png);
    Ok(CapturePayload { text, width, height, words: words_out, png_base64 })
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

fn main() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_shortcut("CmdOrCtrl+Shift+B")
                .expect("failed to register capture hotkey")
                .with_handler(|app, _shortcut, event| {
                    if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        let _ = app.emit("capture-hotkey", ());
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![list_windows, capture_and_ocr])
        .run(tauri::generate_context!())
        .expect("error while running the PokeMMO Tools desktop shell");
}
