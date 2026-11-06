use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};

use percent_encoding::percent_decode_str;
use tauri::ipc::{InvokeBody, Request, Response};

/// Returns true if `arg` looks like a path to a PDF file.
fn is_pdf_arg(arg: &str) -> bool {
    !arg.starts_with('-') && arg.to_ascii_lowercase().ends_with(".pdf")
}

/// Picks the first PDF path out of a command line (the first element is the executable).
pub fn pdf_from_args<I, S>(args: I) -> Option<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    args.into_iter()
        .skip(1)
        .map(|a| a.as_ref().to_string())
        .find(|a| is_pdf_arg(a))
}

/// Reads a whole file and hands the raw bytes to the frontend (no JSON number-array overhead).
#[tauri::command]
pub async fn read_file(path: String) -> Result<Response, String> {
    let p: PathBuf = Path::new(&path).to_path_buf();
    let meta = fs::metadata(&p).map_err(|e| format!("Cannot open {path}: {e}"))?;
    if !meta.is_file() {
        return Err(format!("{path} is not a file"));
    }
    let bytes = fs::read(&p).map_err(|e| format!("Cannot read {path}: {e}"))?;
    Ok(Response::new(bytes))
}

/// The PDF (if any) passed on the command line when the app was launched, e.g. from Explorer.
#[tauri::command]
pub fn get_launch_file() -> Option<String> {
    pdf_from_args(std::env::args())
}

/// The signed-in Windows user, used as the default author of annotations.
#[tauri::command]
pub fn get_username() -> Option<String> {
    std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .ok()
        .filter(|name| !name.trim().is_empty())
}

/// Replaces `path` with `data` without ever leaving a half-written file behind: the bytes go to a
/// temporary file in the same folder first, are flushed to disk, and only then renamed over the
/// target. If anything fails the original file is untouched and the temporary file is removed.
pub fn atomic_write(path: &Path, data: &[u8]) -> Result<(), String> {
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| format!("Invalid file name: {}", path.display()))?;
    let tmp = path.with_file_name(format!(".{name}.{}.tmp", std::process::id()));

    let write = || -> std::io::Result<()> {
        let mut file = File::create(&tmp)?;
        file.write_all(data)?;
        file.sync_all()?;
        Ok(())
    };
    if let Err(e) = write() {
        let _ = fs::remove_file(&tmp);
        return Err(format!("Cannot write {}: {e}", path.display()));
    }
    // On Windows, rename replaces an existing file.
    if let Err(e) = fs::rename(&tmp, path) {
        let _ = fs::remove_file(&tmp);
        return Err(format!("Cannot replace {}: {e}", path.display()));
    }
    Ok(())
}

/// Saves the raw request body to the file named (percent-encoded) in the `path` header. The file
/// bytes travel as the body rather than as an argument to avoid JSON-encoding megabytes.
#[tauri::command]
pub async fn write_file_atomic(request: Request<'_>) -> Result<(), String> {
    let InvokeBody::Raw(data) = request.body() else {
        return Err("Expected the file contents as raw bytes".into());
    };
    let encoded = request
        .headers()
        .get("path")
        .and_then(|v| v.to_str().ok())
        .ok_or("Missing path header")?;
    let path = percent_decode_str(encoded)
        .decode_utf8()
        .map_err(|e| format!("Invalid path: {e}"))?;
    atomic_write(Path::new(path.as_ref()), data)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("pdfreader-test-{label}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn picks_first_pdf_argument() {
        let args = ["app.exe", "--flag", "C:/docs/a.PDF", "b.pdf"];
        assert_eq!(pdf_from_args(args), Some("C:/docs/a.PDF".to_string()));
    }

    #[test]
    fn ignores_executable_and_non_pdf() {
        assert_eq!(pdf_from_args(["viewer.pdf", "notes.txt"]), None);
        assert_eq!(pdf_from_args(["app.exe"]), None);
    }

    #[test]
    fn atomic_write_creates_and_replaces_files() {
        let dir = temp_dir("replace");
        let target = dir.join("doc.pdf");

        atomic_write(&target, b"first").unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"first");

        atomic_write(&target, b"second, and longer").unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"second, and longer");

        // A shorter write must not leave the tail of the previous contents behind.
        atomic_write(&target, b"x").unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"x");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn atomic_write_leaves_no_temporary_files() {
        let dir = temp_dir("tmp");
        atomic_write(&dir.join("doc.pdf"), b"data").unwrap();
        let names: Vec<String> = fs::read_dir(&dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, vec!["doc.pdf".to_string()]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn atomic_write_failure_keeps_the_original_and_cleans_up() {
        let dir = temp_dir("fail");
        let target = dir.join("doc.pdf");
        atomic_write(&target, b"original").unwrap();

        // A non-empty directory in the way makes the final rename fail.
        let blocked = dir.join("blocked.pdf");
        fs::create_dir(&blocked).unwrap();
        fs::write(blocked.join("child"), b"x").unwrap();
        assert!(atomic_write(&blocked, b"new").is_err());

        assert_eq!(fs::read(&target).unwrap(), b"original");
        let leftovers: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|n| n.ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "temporary file left behind: {leftovers:?}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn atomic_write_supports_non_ascii_names() {
        let dir = temp_dir("unicode");
        let target = dir.join("résumé 日本語.pdf");
        atomic_write(&target, b"ok").unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"ok");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn username_is_never_blank() {
        if let Some(name) = get_username() {
            assert!(!name.trim().is_empty());
        }
    }
}
