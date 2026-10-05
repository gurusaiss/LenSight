//! Native file picker — **contract types only** live in this GUI-free crate;
//! the actual picker (which genuinely requires a windowing toolkit) is
//! implemented in `src-tauri/src/file_picker.rs` using Tauri's dialog
//! plugin, and is NOT buildable/testable in this sandbox (see the workspace
//! README's "Build status in this environment" section).
//!
//! Why this split exists here rather than putting these types directly in
//! `src-tauri`: the extension's own `localFileAdapter.ts` (browser
//! `<input type="file">`) and this companion's picker should agree on the
//! same result shape — a list of `{ path, name, size_bytes }` the caller
//! can then read/import — so that shape is defined once, here, where it can
//! actually be unit tested (round-trip (de)serialization, filter-building
//! logic) independent of whether a GUI toolkit is available.

use serde::{Deserialize, Serialize};

/// One file the user picked.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PickedFile {
    pub path: String,
    pub name: String,
    pub size_bytes: u64,
}

/// Extension-based filter for the native dialog (e.g. `{ label: "Text",
/// extensions: ["txt", "md"] }`), mirroring Tauri dialog plugin's own filter
/// shape so `src-tauri`'s real implementation can pass these straight
/// through without re-mapping.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FileFilter {
    pub label: String,
    pub extensions: Vec<String>,
}

/// Filters matching what the extension's `localFileAdapter.ts` already
/// supports (txt/md/csv/json/pdf) — deliberately the SAME set, not a
/// superset, so the native picker isn't quietly promising formats the
/// import pipeline can't actually parse yet. `.docx` is excluded here for
/// the same reason `localFileAdapter.ts` throws a "Planned" error for it —
/// see `ai-context-assistant/docs/LIMITATIONS.md`.
pub fn default_import_filters() -> Vec<FileFilter> {
    vec![
        FileFilter {
            label: "Supported documents".to_string(),
            extensions: vec![
                "txt".to_string(),
                "md".to_string(),
                "csv".to_string(),
                "json".to_string(),
                "pdf".to_string(),
            ],
        },
        FileFilter {
            label: "All files".to_string(),
            extensions: vec!["*".to_string()],
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_filters_match_localfileadapter_supported_extensions_exactly() {
        let filters = default_import_filters();
        let supported = filters
            .iter()
            .find(|f| f.label == "Supported documents")
            .expect("expected a 'Supported documents' filter");

        // Deliberately NOT `.docx` — see doc comment above and
        // ai-context-assistant/docs/LIMITATIONS.md's docx row.
        assert_eq!(
            supported.extensions,
            vec!["txt", "md", "csv", "json", "pdf"]
        );
        assert!(!supported.extensions.contains(&"docx".to_string()));
    }

    #[test]
    fn picked_file_round_trips_through_json() {
        let file = PickedFile {
            path: "/home/user/notes.md".to_string(),
            name: "notes.md".to_string(),
            size_bytes: 1234,
        };
        let json = serde_json::to_string(&file).unwrap();
        let back: PickedFile = serde_json::from_str(&json).unwrap();
        assert_eq!(file, back);
    }

    #[test]
    fn always_includes_an_all_files_fallback_filter() {
        let filters = default_import_filters();
        assert!(filters.iter().any(|f| f.extensions == vec!["*".to_string()]));
    }
}
