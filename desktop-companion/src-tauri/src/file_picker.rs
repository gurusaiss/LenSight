//! Native file picker — the real, GUI-dependent implementation. Lives here
//! (not in `core`) because it genuinely requires `tauri-plugin-dialog`,
//! which depends on the platform's native windowing toolkit. The
//! GUI-independent *contract types* (`PickedFile`, `FileFilter`,
//! `default_import_filters()`) are shared from
//! `lensight_companion_core::native_file_picker` so this
//! function and the extension's own file-format support stay in sync — see
//! that module's doc comment.
//!
//! This is intentionally "less restrictive than the browser's file input"
//! per the task: `tauri_plugin_dialog`'s native dialog can browse the whole
//! filesystem (subject to OS permissions) rather than the sandboxed picker
//! a web `<input type="file">` triggers, and it returns real filesystem
//! paths the Rust side can read directly (e.g. for a future "read this file
//! for me" companion feature), which a browser file input deliberately
//! never exposes.

use lensight_companion_core::native_file_picker::{default_import_filters, PickedFile};
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub fn pick_files(app: tauri::AppHandle) -> Result<Vec<PickedFile>, String> {
    let filters = default_import_filters();
    let mut dialog = app.dialog().file();
    for filter in &filters {
        let ext_refs: Vec<&str> = filter.extensions.iter().map(String::as_str).collect();
        dialog = dialog.add_filter(&filter.label, &ext_refs);
    }

    let picked = dialog.blocking_pick_files();

    let Some(paths) = picked else {
        // User cancelled the dialog — not an error, just an empty result.
        return Ok(vec![]);
    };

    paths
        .into_iter()
        .map(|p| {
            let path_buf = p
                .into_path()
                .map_err(|e| format!("could not resolve picked file path: {e}"))?;
            let metadata = std::fs::metadata(&path_buf)
                .map_err(|e| format!("could not stat {}: {e}", path_buf.display()))?;
            Ok(PickedFile {
                name: path_buf
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default(),
                path: path_buf.to_string_lossy().to_string(),
                size_bytes: metadata.len(),
            })
        })
        .collect()
}
