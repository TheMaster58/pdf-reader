//! The COM plumbing that lets Explorer ask for a thumbnail: a class factory plus an object
//! implementing `IInitializeWithStream` (Explorer gives us the file's bytes) and
//! `IThumbnailProvider` (Explorer asks for a bitmap).

use std::ffi::c_void;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

use windows::core::{implement, IUnknown, Interface, Ref, Result, BOOL, GUID, HRESULT};
use windows::Win32::Foundation::{
    CLASS_E_CLASSNOTAVAILABLE, CLASS_E_NOAGGREGATION, E_FAIL, E_INVALIDARG, E_UNEXPECTED, S_FALSE, S_OK,
};
use windows::Win32::Graphics::Gdi::{
    CreateDIBSection, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HBITMAP,
};
use windows::Win32::System::Com::{IClassFactory, IClassFactory_Impl, IStream};
use windows::Win32::UI::Shell::PropertiesSystem::{IInitializeWithStream, IInitializeWithStream_Impl};
use windows::Win32::UI::Shell::{
    IThumbnailProvider, IThumbnailProvider_Impl, WTSAT_ARGB, WTS_ALPHATYPE,
};

use crate::render::{render_first_page, Bitmap};

/// The COM class id registered in the installer (installer-hooks.nsh must use the same value).
pub const CLSID_PDF_THUMBNAIL: GUID = GUID::from_u128(0x8E1CF62A_63CC_4A85_B6C5_C00369B72936);

/// Files bigger than this get no preview: we read the whole file into memory to render it.
const MAX_FILE_BYTES: usize = 256 * 1024 * 1024;

/// Live objects plus server locks. `DllCanUnloadNow` reports whether the DLL can be released.
static LIVE: AtomicUsize = AtomicUsize::new(0);

#[implement(IInitializeWithStream, IThumbnailProvider)]
#[derive(Default)]
struct ThumbnailProvider {
    pdf: Mutex<Vec<u8>>,
}

impl ThumbnailProvider {
    fn new() -> Self {
        LIVE.fetch_add(1, Ordering::SeqCst);
        Self::default()
    }
}

impl Drop for ThumbnailProvider {
    fn drop(&mut self) {
        LIVE.fetch_sub(1, Ordering::SeqCst);
    }
}

/// Reads an IStream to the end, refusing anything over `MAX_FILE_BYTES`.
fn read_all(stream: &IStream) -> Result<Vec<u8>> {
    let mut out = Vec::new();
    let mut chunk = vec![0u8; 256 * 1024];
    loop {
        let mut read = 0u32;
        // S_FALSE just means "fewer bytes than asked"; zero bytes means the end.
        unsafe { stream.Read(chunk.as_mut_ptr() as *mut c_void, chunk.len() as u32, Some(&mut read)).ok()? };
        if read == 0 {
            break;
        }
        out.extend_from_slice(&chunk[..read as usize]);
        if out.len() > MAX_FILE_BYTES {
            return Err(E_FAIL.into());
        }
    }
    Ok(out)
}

/// A top-down 32-bit DIB section holding the pixels, which is what Explorer wants back.
fn to_hbitmap(bitmap: &Bitmap) -> Result<HBITMAP> {
    let info = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: bitmap.width as i32,
            biHeight: -(bitmap.height as i32), // negative = top row first
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };
    let mut bits: *mut c_void = std::ptr::null_mut();
    let hbitmap = unsafe { CreateDIBSection(None, &info, DIB_RGB_COLORS, &mut bits, None, 0)? };
    if bits.is_null() {
        return Err(E_UNEXPECTED.into());
    }
    unsafe { std::ptr::copy_nonoverlapping(bitmap.bgra.as_ptr(), bits as *mut u8, bitmap.bgra.len()) };
    Ok(hbitmap)
}

impl IInitializeWithStream_Impl for ThumbnailProvider_Impl {
    fn Initialize(&self, pstream: Ref<'_, IStream>, _grfmode: u32) -> Result<()> {
        let stream = pstream.ok()?;
        *self.pdf.lock().map_err(|_| E_UNEXPECTED)? = read_all(stream)?;
        Ok(())
    }
}

impl IThumbnailProvider_Impl for ThumbnailProvider_Impl {
    fn GetThumbnail(&self, cx: u32, phbmp: *mut HBITMAP, pdwalpha: *mut WTS_ALPHATYPE) -> Result<()> {
        if phbmp.is_null() || pdwalpha.is_null() || cx == 0 {
            return Err(E_INVALIDARG.into());
        }
        let bitmap = {
            let pdf = self.pdf.lock().map_err(|_| E_UNEXPECTED)?;
            // Any failure (password-protected, corrupt, unsupported) becomes "no thumbnail",
            // and Explorer shows the file type's normal icon instead.
            render_first_page(&pdf, cx)?
        };
        let hbitmap = to_hbitmap(&bitmap)?;
        unsafe {
            *phbmp = hbitmap;
            *pdwalpha = WTSAT_ARGB;
        }
        Ok(())
    }
}

#[implement(IClassFactory)]
struct ClassFactory;

impl IClassFactory_Impl for ClassFactory_Impl {
    fn CreateInstance(
        &self,
        punkouter: Ref<'_, IUnknown>,
        riid: *const GUID,
        ppvobject: *mut *mut c_void,
    ) -> Result<()> {
        if ppvobject.is_null() || riid.is_null() {
            return Err(E_INVALIDARG.into());
        }
        unsafe { *ppvobject = std::ptr::null_mut() };
        if punkouter.is_some() {
            return Err(CLASS_E_NOAGGREGATION.into());
        }
        let provider: IUnknown = ThumbnailProvider::new().into();
        unsafe { provider.query(riid, ppvobject).ok() }
    }

    fn LockServer(&self, flock: BOOL) -> Result<()> {
        if flock.as_bool() {
            LIVE.fetch_add(1, Ordering::SeqCst);
        } else {
            LIVE.fetch_sub(1, Ordering::SeqCst);
        }
        Ok(())
    }
}

/// COM entry point: Explorer asks the DLL for the class factory of our CLSID.
#[no_mangle]
pub extern "system" fn DllGetClassObject(
    rclsid: *const GUID,
    riid: *const GUID,
    ppv: *mut *mut c_void,
) -> HRESULT {
    if rclsid.is_null() || riid.is_null() || ppv.is_null() {
        return E_INVALIDARG;
    }
    unsafe {
        *ppv = std::ptr::null_mut();
        if *rclsid != CLSID_PDF_THUMBNAIL {
            return CLASS_E_CLASSNOTAVAILABLE;
        }
        let factory: IClassFactory = ClassFactory.into();
        factory.query(riid, ppv)
    }
}

/// COM entry point: may the DLL be unloaded yet?
#[no_mangle]
pub extern "system" fn DllCanUnloadNow() -> HRESULT {
    if LIVE.load(Ordering::SeqCst) == 0 {
        S_OK
    } else {
        S_FALSE
    }
}
