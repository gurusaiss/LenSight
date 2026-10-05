//! Core, GUI-free logic for the Lensight desktop companion.
//!
//! This crate deliberately has NO dependency on Tauri, webkit2gtk, or any
//! windowing toolkit, so it can be built and unit-tested in any environment
//! with a working Rust toolchain — including this one, where the full
//! Tauri GUI shell's system dependencies (webkit2gtk, etc.) are not
//! installed. See the workspace root `README.md` for exactly what was and
//! wasn't verified here.
//!
//! What this crate provides, matching the task's Part 1 scope:
//! (a) an Ollama daemon health-check/status function,
//! (b) a small local HTTP API (axum) on `127.0.0.1:47291` with a health
//!     endpoint the browser extension (or a future desktop-aware provider)
//!     can reach,
//! (c) NOT a native file picker — that genuinely needs a GUI toolkit
//!     (`rfd`/Tauri's dialog plugin) and lives in `src-tauri` instead, where
//!     it's real code but only buildable with the GUI shell (see README),
//! (d) an explicit, honest OCR stub — `ocr::extract_text` always returns
//!     `OcrError::NotImplemented`. No fake OCR.

pub mod native_file_picker;
pub mod ocr;
pub mod ollama;
pub mod server;

/// Fixed local port the companion listens on. Chosen once and documented
/// (not configurable via the API itself) so the browser extension can be
/// hardcoded to reach it without a discovery step — matching the task's
/// "a fixed port (e.g. 47291)" instruction.
pub const DEFAULT_PORT: u16 = 47291;

/// Default Ollama daemon base URL — matches `ollamaProvider.ts`'s
/// `DEFAULT_OLLAMA_BASE_URL` constant exactly (`http://localhost:11434`, not
/// `127.0.0.1`) in the browser extension
/// (`src/core/ai/providers/ollamaProvider.ts`), so the companion checks the
/// same daemon the extension itself would talk to directly if a user chose
/// not to run the companion at all (the companion is optional — see
/// README.md).
pub const DEFAULT_OLLAMA_BASE_URL: &str = "http://localhost:11434";
