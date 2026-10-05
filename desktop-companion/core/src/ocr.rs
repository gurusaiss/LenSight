//! OCR: explicitly **Planned**, never faked.
//!
//! Matches this project's Implemented/Experimental/Planned convention
//! (see `docs/LIMITATIONS.md` in `ai-context-assistant/`) — the scanned/
//! image-only PDF row there is already "Not supported... Explicitly Planned
//! only", and this module is the desktop-side half of that same honest gap.
//! `extract_text` always returns `OcrError::NotImplemented`; it never
//! returns placeholder or fabricated text, regardless of input.

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OcrError {
    /// The only variant this module can currently return. Kept as an enum
    /// (rather than a bare string) so a future real implementation can add
    /// variants like `EngineNotInstalled` or `UnsupportedImageFormat`
    /// without changing every call site's error handling shape.
    NotImplemented,
}

pub struct OcrResult {
    pub error: OcrError,
}

/// JSON-serializable shape returned by the `/ocr` HTTP endpoint.
#[derive(Debug, Serialize)]
pub struct OcrResponse {
    pub status: &'static str,
    /// Always `null` — see module docs. Present (rather than omitted) so
    /// callers can rely on the field existing in every response shape.
    pub text: Option<String>,
    pub message: &'static str,
}

impl From<OcrResult> for OcrResponse {
    fn from(result: OcrResult) -> Self {
        match result.error {
            OcrError::NotImplemented => OcrResponse {
                status: "not_implemented",
                text: None,
                message: "OCR is Planned, not Implemented. No text was extracted; \
                          this endpoint never returns fabricated OCR output. \
                          Scanned/image-only PDFs and images are not readable by this companion yet.",
            },
        }
    }
}

/// Attempt OCR on raw image bytes. Always fails with `NotImplemented` in
/// this pass — the `_image_bytes` parameter exists to document the intended
/// real signature (a future engine, e.g. `tesseract`/`leptess` bindings,
/// would consume the same bytes) without pretending any bytes are read now.
pub fn extract_text(_image_bytes: &[u8]) -> OcrResult {
    OcrResult {
        error: OcrError::NotImplemented,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn always_returns_not_implemented_never_fake_text() {
        let result = extract_text(&[1, 2, 3]);
        assert_eq!(result.error, OcrError::NotImplemented);
    }

    #[test]
    fn empty_input_also_returns_not_implemented_not_empty_success() {
        let result = extract_text(&[]);
        assert_eq!(result.error, OcrError::NotImplemented);
    }

    #[test]
    fn response_conversion_never_carries_text() {
        let response: OcrResponse = extract_text(b"fake-image-bytes").into();
        assert_eq!(response.status, "not_implemented");
        assert!(response.text.is_none());
        assert!(!response.message.is_empty());
    }
}
