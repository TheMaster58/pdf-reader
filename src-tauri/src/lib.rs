mod commands;

use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be registered first. When a second instance is launched (e.g. the user opens another
        // PDF from Explorer), forward its PDF argument to the running window and focus it.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
            if let Some(path) = commands::pdf_from_args(&argv) {
                let _ = app.emit("open-file", path);
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::read_file,
            commands::get_launch_file,
            commands::get_username,
            commands::write_file_atomic
        ])
        .run(tauri::generate_context!())
        .expect("error while running PDF Reader");
}
