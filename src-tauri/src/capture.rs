// Win32 window enumeration + capture (GDI).
//
// We capture a *window by handle* with PrintWindow(PW_RENDERFULLCONTENT) so the
// summary panel is at a fixed position regardless of where the window sits or
// what's in front of it. PrintWindow handles DWM/DirectComposition content;
// exclusive-fullscreen DirectX may still come back black — run PokéMMO
// borderless-windowed (documented in DESKTOP.md).
//
// Targets windows-rs 0.58. If you bump the crate, the HWND representation and a
// couple of GDI constant types are the things most likely to need small tweaks.

use serde::Serialize;
use std::ffi::c_void;
use windows::core::Result as WinResult;
use windows::Win32::Foundation::{BOOL, HWND, LPARAM, RECT, TRUE};
use windows::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits,
    GetWindowDC, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
    SRCCOPY,
};
// PrintWindow + its flags live in the Xps module in windows-rs (not
// WindowsAndMessaging), behind the Win32_Storage_Xps feature.
use windows::Win32::Storage::Xps::{PrintWindow, PW_RENDERFULLCONTENT};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindowRect, GetWindowTextLengthW, GetWindowTextW, IsWindowVisible,
};

#[derive(Serialize, Clone)]
pub struct WindowInfo {
    pub hwnd: isize,
    pub title: String,
}

extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
    unsafe {
        let list = &mut *(lparam.0 as *mut Vec<WindowInfo>);
        if !IsWindowVisible(hwnd).as_bool() {
            return TRUE;
        }
        let len = GetWindowTextLengthW(hwnd);
        if len == 0 {
            return TRUE;
        }
        let mut buf = vec![0u16; (len + 1) as usize];
        let read = GetWindowTextW(hwnd, &mut buf);
        if read > 0 {
            let title = String::from_utf16_lossy(&buf[..read as usize]);
            list.push(WindowInfo {
                hwnd: hwnd.0 as isize,
                title,
            });
        }
    }
    TRUE
}

/// All visible, titled top-level windows.
pub fn list_windows() -> Vec<WindowInfo> {
    let mut result: Vec<WindowInfo> = Vec::new();
    unsafe {
        let _ = EnumWindows(Some(enum_proc), LPARAM(&mut result as *mut _ as isize));
    }
    // PokéMMO first if present, then alphabetical.
    result.sort_by(|a, b| {
        let ap = a.title.to_lowercase().contains("pokemmo");
        let bp = b.title.to_lowercase().contains("pokemmo");
        bp.cmp(&ap).then(a.title.cmp(&b.title))
    });
    result
}

/// Capture a window into a PNG. Returns (png_bytes, width, height).
pub fn capture_window_png(hwnd_raw: isize) -> WinResult<(Vec<u8>, u32, u32)> {
    unsafe {
        let hwnd = HWND(hwnd_raw as *mut c_void);

        let mut rect = RECT::default();
        GetWindowRect(hwnd, &mut rect)?;
        let width = (rect.right - rect.left).max(1);
        let height = (rect.bottom - rect.top).max(1);

        let hdc_window = GetWindowDC(hwnd);
        let hdc_mem = CreateCompatibleDC(hdc_window);
        let hbm = CreateCompatibleBitmap(hdc_window, width, height);
        let old = SelectObject(hdc_mem, hbm);

        // PW_RENDERFULLCONTENT — captures DWM/DirectComposition content.
        let printed = PrintWindow(hwnd, hdc_mem, PW_RENDERFULLCONTENT);
        if !printed.as_bool() {
            // Fallback: straight blit of the window DC.
            let _ = BitBlt(hdc_mem, 0, 0, width, height, hdc_window, 0, 0, SRCCOPY);
        }

        // Pull pixels as 32-bit, top-down (negative height) BGRA.
        let mut bmi = BITMAPINFO::default();
        bmi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
        bmi.bmiHeader.biWidth = width;
        bmi.bmiHeader.biHeight = -height;
        bmi.bmiHeader.biPlanes = 1;
        bmi.bmiHeader.biBitCount = 32;
        bmi.bmiHeader.biCompression = BI_RGB.0 as u32;

        let mut buf = vec![0u8; (width * height * 4) as usize];
        let scanlines = GetDIBits(
            hdc_mem,
            hbm,
            0,
            height as u32,
            Some(buf.as_mut_ptr() as *mut c_void),
            &mut bmi,
            DIB_RGB_COLORS,
        );

        // Clean up GDI objects before bailing on errors.
        SelectObject(hdc_mem, old);
        let _ = DeleteObject(hbm);
        let _ = DeleteDC(hdc_mem);
        ReleaseDC(hwnd, hdc_window);

        if scanlines == 0 {
            return Err(windows::core::Error::from_win32());
        }

        // BGRA → RGBA and force opaque alpha (PrintWindow often leaves alpha 0).
        for px in buf.chunks_exact_mut(4) {
            px.swap(0, 2);
            px[3] = 255;
        }

        let img = image::RgbaImage::from_raw(width as u32, height as u32, buf)
            .ok_or_else(windows::core::Error::from_win32)?;
        let png = encode_png(&img).map_err(|_| windows::core::Error::from_win32())?;
        Ok((png, width as u32, height as u32))
    }
}

pub fn encode_png(img: &image::RgbaImage) -> Result<Vec<u8>, image::ImageError> {
    use image::ImageEncoder;
    let mut out = Vec::new();
    image::codecs::png::PngEncoder::new(&mut out).write_image(
        img.as_raw(),
        img.width(),
        img.height(),
        image::ExtendedColorType::Rgba8,
    )?;
    Ok(out)
}
