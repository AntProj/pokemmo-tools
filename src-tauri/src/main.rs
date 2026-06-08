// PokeMMO Tools — Windows desktop shell (Tauri v2).
//
// Phase 2: a thin shell that boots the same React build the website ships.
// No feature changes. Phase 3 adds the capture/OCR commands (see capture.rs
// and ocr.rs) and registers them here.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running the PokeMMO Tools desktop shell");
}
