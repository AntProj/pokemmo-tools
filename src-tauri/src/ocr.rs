// On-device OCR via WinRT (Windows.Media.Ocr). Free, no model download, no API
// key, and it returns per-word bounding boxes — which is what makes anchor-based
// parsing of the summary panel robust (find the "IVs:" word, read to its right).
//
// Targets windows-rs 0.58. The OcrEngine factory methods are the most likely
// spot to need a tweak across crate versions.

use serde::Serialize;
use windows::core::{HSTRING, Result as WinResult};
use windows::Globalization::Language;
use windows::Graphics::Imaging::{BitmapDecoder, SoftwareBitmap};
use windows::Media::Ocr::OcrEngine;
use windows::Storage::Streams::{DataWriter, InMemoryRandomAccessStream};

#[derive(Serialize, Clone)]
pub struct WordBox {
    pub text: String,
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

fn engine() -> WinResult<OcrEngine> {
    // Prefer the user's profile languages; fall back to en-US.
    if let Ok(e) = OcrEngine::TryCreateFromUserProfileLanguages() {
        return Ok(e);
    }
    let lang = Language::CreateLanguage(&HSTRING::from("en-US"))?;
    OcrEngine::TryCreateFromLanguage(&lang)
}

/// OCR a PNG. Returns (full_text, words).
pub fn ocr_png(png: &[u8]) -> WinResult<(String, Vec<WordBox>)> {
    // PNG bytes → in-memory stream → SoftwareBitmap.
    let stream = InMemoryRandomAccessStream::new()?;
    let writer = DataWriter::CreateDataWriter(&stream)?;
    writer.WriteBytes(png)?;
    writer.StoreAsync()?.get()?;
    writer.FlushAsync()?.get()?;
    writer.DetachStream()?; // release the stream back so we can seek/read it
    stream.Seek(0)?;

    let decoder = BitmapDecoder::CreateAsync(&stream)?.get()?;
    let bitmap: SoftwareBitmap = decoder.GetSoftwareBitmapAsync()?.get()?;

    let result = engine()?.RecognizeAsync(&bitmap)?.get()?;

    let text = result.Text()?.to_string_lossy();
    let mut words = Vec::new();
    for line in result.Lines()? {
        for word in line.Words()? {
            let r = word.BoundingRect()?;
            words.push(WordBox {
                text: word.Text()?.to_string_lossy(),
                x: r.X,
                y: r.Y,
                w: r.Width,
                h: r.Height,
            });
        }
    }
    Ok((text, words))
}
