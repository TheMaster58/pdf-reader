//! Renders the first page of a PDF to pixels using the PDF renderer built into Windows
//! (`Windows.Data.Pdf`), so no PDF library has to ship with the app.

use std::sync::mpsc::channel;
use std::thread;
use std::time::Duration;

use windows::core::{Error, Result, HRESULT};
use windows::Data::Pdf::{PdfDocument, PdfPageRenderOptions};
use windows::Graphics::Imaging::{
    BitmapAlphaMode, BitmapDecoder, BitmapPixelFormat, BitmapTransform, ColorManagementMode,
    ExifOrientationMode,
};
use windows::Storage::Streams::{DataWriter, InMemoryRandomAccessStream};
use windows::UI::Color;
use windows::Win32::System::WinRT::{RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED};

/// Smallest and largest thumbnail edge we will produce, in pixels.
pub const MIN_EDGE: u32 = 16;
pub const MAX_EDGE: u32 = 1024;

/// An image as 32-bit premultiplied BGRA, top row first.
pub struct Bitmap {
    pub width: u32,
    pub height: u32,
    pub bgra: Vec<u8>,
}

const E_FAIL: HRESULT = HRESULT(0x80004005u32 as i32);

fn fail(message: &str) -> Error {
    Error::new(E_FAIL, message)
}

/// A render that takes longer than this is abandoned so Explorer is never left waiting.
const RENDER_TIMEOUT: Duration = Duration::from_secs(20);

/// Pixels of page 1 scaled so the longer side is `max_edge`, on a white page.
///
/// Fails for anything Explorer should show a plain icon for: documents that need a password,
/// corrupt files, files with no pages, and renders that time out.
///
/// The work happens on a thread of its own. Explorer calls thumbnail providers on single-threaded
/// apartment threads, and blocking one of those while waiting for a WinRT async operation deadlocks:
/// the operation's completion is delivered to the very thread that is blocked. A fresh thread
/// initialised as a multithreaded apartment has no such dependency.
pub fn render_first_page(pdf: &[u8], max_edge: u32) -> Result<Bitmap> {
    let data = pdf.to_vec();
    let (tx, rx) = channel();
    thread::Builder::new()
        .name("pdf-thumbnail".into())
        .spawn(move || {
            let _ = tx.send(render_on_this_thread(&data, max_edge));
        })
        .map_err(|_| fail("could not start the render thread"))?;
    rx.recv_timeout(RENDER_TIMEOUT).unwrap_or_else(|_| Err(fail("rendering timed out")))
}

/// Uninitialises WinRT when dropped, so it runs after every WinRT object below has been released.
struct WinRtScope(bool);

impl Drop for WinRtScope {
    fn drop(&mut self) {
        if self.0 {
            unsafe { RoUninitialize() };
        }
    }
}

fn render_on_this_thread(pdf: &[u8], max_edge: u32) -> Result<Bitmap> {
    // This thread is brand new, so this makes it a multithreaded apartment.
    let _scope = WinRtScope(unsafe { RoInitialize(RO_INIT_MULTITHREADED) }.is_ok());

    if pdf.len() < 8 || !pdf.windows(5).take(1024).any(|w| w == b"%PDF-") {
        return Err(fail("not a PDF"));
    }
    let max_edge = max_edge.clamp(MIN_EDGE, MAX_EDGE);

    // Hand the bytes to the WinRT PDF API through an in-memory stream.
    let source = InMemoryRandomAccessStream::new()?;
    let writer = DataWriter::CreateDataWriter(&source)?;
    writer.WriteBytes(pdf)?;
    writer.StoreAsync()?.join()?;
    writer.DetachStream()?;
    source.Seek(0)?;

    // A document that needs a password makes this call fail, which is exactly what we want.
    let doc = PdfDocument::LoadFromStreamAsync(&source)?.join()?;
    if doc.IsPasswordProtected()? || doc.PageCount()? == 0 {
        return Err(fail("no preview for password-protected or empty documents"));
    }
    let page = doc.GetPage(0)?;

    let size = page.Size()?;
    let (pw, ph) = (size.Width.max(1.0), size.Height.max(1.0));
    let scale = max_edge as f32 / pw.max(ph);
    let width = ((pw * scale).round() as u32).max(1);
    let height = ((ph * scale).round() as u32).max(1);

    let options = PdfPageRenderOptions::new()?;
    options.SetDestinationWidth(width)?;
    options.SetDestinationHeight(height)?;
    options.SetBackgroundColor(Color { A: 255, R: 255, G: 255, B: 255 })?;

    let encoded = InMemoryRandomAccessStream::new()?;
    page.RenderWithOptionsToStreamAsync(&encoded, &options)?.join()?;
    encoded.Seek(0)?;

    // Decode the PNG back to raw pixels.
    let decoder = BitmapDecoder::CreateAsync(&encoded)?.join()?;
    let pixels = decoder
        .GetPixelDataTransformedAsync(
            BitmapPixelFormat::Bgra8,
            BitmapAlphaMode::Premultiplied,
            &BitmapTransform::new()?,
            ExifOrientationMode::IgnoreExifOrientation,
            ColorManagementMode::DoNotColorManage,
        )?
        .join()?
        .DetachPixelData()?;

    let (w, h) = (decoder.PixelWidth()?, decoder.PixelHeight()?);
    if pixels.len() != (w as usize) * (h as usize) * 4 {
        return Err(fail("unexpected pixel buffer size"));
    }
    Ok(Bitmap { width: w, height: h, bgra: pixels.to_vec() })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn fixture(name: &str) -> Vec<u8> {
        let p = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures").join(name);
        std::fs::read(&p).unwrap_or_else(|e| panic!("cannot read {}: {e}", p.display()))
    }

    /// (dark pixels, near-white pixels, total) of an opaque bitmap.
    fn tone(b: &Bitmap) -> (usize, usize, usize) {
        let px = b.bgra.chunks_exact(4);
        let total = px.len();
        let dark = px.clone().filter(|p| p[0] < 100 && p[1] < 100 && p[2] < 100).count();
        let white = px.filter(|p| p[0] > 245 && p[1] > 245 && p[2] > 245).count();
        (dark, white, total)
    }

    #[test]
    fn renders_page_one_at_the_requested_size_and_aspect() {
        let b = render_first_page(&fixture("sample.pdf"), 256).unwrap();
        assert_eq!(b.height, 256, "the long side matches the request");
        let ratio = b.width as f32 / b.height as f32;
        assert!((ratio - 612.0 / 792.0).abs() < 0.01, "US Letter aspect, got {ratio}");
        assert_eq!(b.bgra.len(), (b.width * b.height * 4) as usize);
    }

    #[test]
    fn the_page_is_white_paper_with_some_dark_text() {
        let b = render_first_page(&fixture("sample.pdf"), 512).unwrap();
        let (dark, white, total) = tone(&b);
        assert!(white * 100 / total > 90, "mostly white paper");
        assert!(dark > 50, "text is visible (got {dark} dark pixels)");
        // Fully opaque: no transparent corners that Explorer would draw on its own background.
        assert!(b.bgra.chunks_exact(4).all(|p| p[3] == 255));
    }

    #[test]
    fn it_renders_page_one_and_not_a_later_page() {
        // Page 1 of the sample has a heading; the left margin strip near the top must contain ink.
        let b = render_first_page(&fixture("sample.pdf"), 400).unwrap();
        let top_band = &b.bgra[..(b.width * (b.height / 6) * 4) as usize];
        let ink = top_band.chunks_exact(4).filter(|p| p[0] < 100).count();
        assert!(ink > 20, "heading ink in the top band, got {ink}");
    }

    #[test]
    fn small_and_huge_requests_are_clamped() {
        let small = render_first_page(&fixture("sample.pdf"), 1).unwrap();
        assert_eq!(small.height, MIN_EDGE);
        let huge = render_first_page(&fixture("sample.pdf"), 100_000).unwrap();
        assert_eq!(huge.height, MAX_EDGE);
    }

    #[test]
    fn a_page_rotated_by_ninety_degrees_comes_out_sideways() {
        // The page is 612x792 with /Rotate 90, so it is displayed landscape.
        let b = render_first_page(&fixture("landscape-first.pdf"), 300).unwrap();
        assert_eq!(b.width, 300, "the long side is the width");
        let ratio = b.width as f32 / b.height as f32;
        assert!((ratio - 792.0 / 612.0).abs() < 0.02, "landscape aspect, got {ratio}");
    }

    #[test]
    fn password_protected_documents_have_no_preview() {
        assert!(render_first_page(&fixture("encrypted.pdf"), 256).is_err());
    }

    #[test]
    fn garbage_and_empty_input_fail_instead_of_crashing() {
        assert!(render_first_page(b"", 256).is_err());
        assert!(render_first_page(b"this is definitely not a pdf file", 256).is_err());
        assert!(render_first_page(&[0u8; 4096], 256).is_err());
        // A real header followed by nonsense.
        assert!(render_first_page(b"%PDF-1.7\nnot actually a document", 256).is_err());
        // A real file cut off in the middle.
        let full = fixture("sample.pdf");
        assert!(render_first_page(&full[..full.len() / 3], 256).is_err());
    }

    /// Explorer calls thumbnail providers on single-threaded-apartment threads. Waiting for a WinRT
    /// async operation there used to deadlock (its completion callback needs the very thread that
    /// is blocked), which froze Explorer's thumbnail host.
    #[test]
    fn works_when_called_from_a_single_threaded_apartment() {
        use std::sync::mpsc::channel;
        use std::time::Duration;
        use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED};

        let data = fixture("sample.pdf");
        let (tx, rx) = channel();
        std::thread::spawn(move || {
            unsafe { let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED); }
            let ok = render_first_page(&data, 128).is_ok();
            let _ = tx.send(ok);
            unsafe { CoUninitialize() };
        });
        assert_eq!(
            rx.recv_timeout(Duration::from_secs(20)),
            Ok(true),
            "render_first_page must finish (and succeed) on an STA thread"
        );
    }

    #[test]
    fn repeated_renders_work() {
        let data = fixture("sample.pdf");
        for _ in 0..5 {
            render_first_page(&data, 128).unwrap();
        }
    }
}
