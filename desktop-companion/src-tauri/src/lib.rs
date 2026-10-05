//! Tauri application shell. Wires together:
//! - `lensight_companion_core::server` — the local HTTP API
//!   (started as a background tokio task on app setup).
//! - `file_picker::pick_files` — the native file picker command, invoked
//!   from `ui/index.html` via `window.__TAURI__.core.invoke`.
//!
//! This crate is NOT verified to build in this sandbox — it requires a
//! native webview toolkit (webkit2gtk + friends on Linux). See the
//! workspace root README's "Build status in this environment" section for
//! the real `cargo check`/`cargo build` output and error text.

mod file_picker;

use lensight_companion_core::DEFAULT_PORT;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![file_picker::pick_files])
        .setup(|_app| {
            // Start the local HTTP API alongside the GUI. Errors here are
            // logged, not fatal to the whole app — a user should still be
            // able to use the native file picker even if port 47291 is
            // already bound by something else.
            tauri::async_runtime::spawn(async move {
                match lensight_companion_core::server::serve(
                    DEFAULT_PORT,
                    lensight_companion_core::DEFAULT_OLLAMA_BASE_URL,
                )
                .await
                {
                    Ok((addr, handle)) => {
                        println!("companion HTTP API listening on http://{addr}");
                        let _ = handle.await;
                    }
                    Err(err) => {
                        eprintln!(
                            "companion HTTP API failed to start on port {DEFAULT_PORT}: {err}"
                        );
                    }
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the Lensight companion");
}
