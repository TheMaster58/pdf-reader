//! Windows Explorer thumbnail provider for PDF files: shows the first page as the file's icon.
//!
//! Explorer loads this DLL (registered by the installer) and asks it for a bitmap. Documents that
//! can't be previewed, such as password-protected ones, make it fail, so Explorer falls back to the
//! normal icon.

// MSVC notes that the COM exports could be marked PRIVATE; they must stay public for COM.
#![allow(linker_messages)]

pub mod com;
pub mod render;
