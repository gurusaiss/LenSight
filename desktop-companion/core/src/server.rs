//! The companion's small local HTTP API, bound to `127.0.0.1` only (never
//! `0.0.0.0`) — this is a same-machine convenience endpoint, not a service
//! meant to be reachable from the network. See `DEFAULT_PORT` in `lib.rs`
//! for the fixed port the extension would be hardcoded to reach.
//!
//! Routes (current scope, matching the task's Part 1 (b)):
//! - `GET /health` — companion liveness + Ollama daemon reachability, so a
//!   future desktop-aware code path (or a diagnostics panel) can show one
//!   combined status without re-implementing the Ollama probe itself.
//! - `POST /ocr` — always returns the explicit "not implemented" response
//!   from `ocr::extract_text` (see `ocr.rs`) — never fake OCR output.
//!
//! Deliberately NOT here: anything that duplicates `ollamaProvider.ts`'s
//! `/api/generate` proxying — the extension already calls Ollama directly
//! and this companion does not intermediate that call in this pass.

use axum::{
    extract::{Request, State},
    http::{header, HeaderValue, Method, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::Serialize;
use std::sync::Arc;

use crate::ocr;
use crate::ollama::{check_ollama_status, OllamaStatus};

/// Shared state handlers need: an HTTP client for probing Ollama, and the
/// configured Ollama base URL (so it's testable with a mock server instead
/// of the real default).
#[derive(Clone)]
pub struct AppState {
    pub http_client: reqwest::Client,
    pub ollama_base_url: String,
}

impl AppState {
    pub fn new(ollama_base_url: impl Into<String>) -> Self {
        Self {
            http_client: reqwest::Client::new(),
            ollama_base_url: ollama_base_url.into(),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct HealthResponse {
    /// Always true if this handler ran at all — the companion process
    /// itself is up. Kept as an explicit field (rather than relying on
    /// "got a 200") so a JSON consumer doesn't have to infer liveness from
    /// HTTP status alone.
    pub companion_ok: bool,
    pub ollama: OllamaStatus,
}

pub async fn health_handler(State(state): State<Arc<AppState>>) -> Json<HealthResponse> {
    let ollama = check_ollama_status(&state.http_client, &state.ollama_base_url).await;
    Json(HealthResponse {
        companion_ok: true,
        ollama,
    })
}

pub async fn ocr_handler() -> (StatusCode, Json<ocr::OcrResponse>) {
    let result = ocr::extract_text(&[]);
    (StatusCode::NOT_IMPLEMENTED, Json(result.into()))
}

/// Origins allowed to read API responses cross-origin: the companion's own
/// Tauri webview (`tauri://localhost` on macOS/Linux, `http(s)://tauri.localhost`
/// on Windows). Audit C-FUN-01: the webview UI (`ui/index.html`) fetches
/// `http://127.0.0.1:47291/health`, which is cross-origin from the webview,
/// and the server sent no `Access-Control-Allow-Origin` — so the status line
/// could never show anything but "not reachable". Web pages are NOT allowed.
pub const ALLOWED_ORIGINS: &[&str] = &["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost"];

/// True if the request's `Host` header names this machine's loopback
/// interface. Audit C-SEC-01: without this, a DNS-rebinding page (a hostile
/// domain re-pointed at 127.0.0.1) is same-origin with the API from the
/// browser's point of view and could read `/health`. Browsers always send the
/// attacker's hostname in `Host`, so rejecting non-loopback hosts closes that.
pub fn is_loopback_host(host: &str) -> bool {
    let name = if let Some(rest) = host.strip_prefix('[') {
        // [::1]:port
        rest.split(']').next().unwrap_or("")
    } else {
        host.rsplit_once(':').map_or(host, |(h, port)| {
            if port.chars().all(|c| c.is_ascii_digit()) { h } else { host }
        })
    };
    name.eq_ignore_ascii_case("localhost")
        || name == "::1"
        || name.parse::<std::net::Ipv4Addr>().map(|ip| ip.is_loopback()).unwrap_or(false)
}

async fn loopback_and_cors_guard(req: Request, next: Next) -> Response {
    let host_ok = req
        .headers()
        .get(header::HOST)
        .and_then(|h| h.to_str().ok())
        .map(is_loopback_host)
        .unwrap_or(false);
    if !host_ok {
        return (StatusCode::MISDIRECTED_REQUEST, "companion API only answers loopback Host headers").into_response();
    }

    let allowed_origin = req
        .headers()
        .get(header::ORIGIN)
        .and_then(|o| o.to_str().ok())
        .filter(|o| ALLOWED_ORIGINS.contains(o))
        .map(str::to_owned);

    // CORS preflight for the webview's POST /ocr (JSON body).
    if req.method() == Method::OPTIONS {
        let mut resp = StatusCode::NO_CONTENT.into_response();
        if let Some(origin) = &allowed_origin {
            let h = resp.headers_mut();
            if let Ok(v) = HeaderValue::from_str(origin) {
                h.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, v);
            }
            h.insert(header::ACCESS_CONTROL_ALLOW_METHODS, HeaderValue::from_static("GET, POST"));
            h.insert(header::ACCESS_CONTROL_ALLOW_HEADERS, HeaderValue::from_static("content-type"));
            h.insert(header::VARY, HeaderValue::from_static("Origin"));
        }
        return resp;
    }

    let mut resp = next.run(req).await;
    if let Some(origin) = allowed_origin {
        if let Ok(v) = HeaderValue::from_str(&origin) {
            resp.headers_mut().insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, v);
            resp.headers_mut().insert(header::VARY, HeaderValue::from_static("Origin"));
        }
    }
    resp
}

/// Build the router. Split out from `serve()` so tests can exercise routes
/// in-process (via `tower::ServiceExt::oneshot` / axum's test client
/// pattern) without binding a real socket.
pub fn build_router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/health", get(health_handler))
        .route("/ocr", post(ocr_handler))
        .layer(middleware::from_fn(loopback_and_cors_guard))
        .with_state(state)
}

/// Bind and serve on `127.0.0.1:{port}`. Returns the actual bound address
/// (useful in tests when `port` is 0, letting the OS pick a free port) and a
/// future that runs the server until the process exits or the returned
/// `tokio::task::JoinHandle` is aborted.
pub async fn serve(
    port: u16,
    ollama_base_url: impl Into<String>,
) -> std::io::Result<(std::net::SocketAddr, tokio::task::JoinHandle<()>)> {
    let state = Arc::new(AppState::new(ollama_base_url));
    let app = build_router(state);

    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port)).await?;
    let addr = listener.local_addr()?;

    let handle = tokio::spawn(async move {
        // In production this runs forever alongside the Tauri app; if it
        // ever exits, that's a real failure worth panicking on rather than
        // silently leaving the API dead while the app looks alive.
        axum::serve(listener, app)
            .await
            .expect("companion HTTP server crashed");
    });

    Ok((addr, handle))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use tower::ServiceExt; // for `oneshot`

    fn state_with_unreachable_ollama() -> Arc<AppState> {
        // Port 1: privileged, essentially always closed — deterministic
        // "not running" without needing a real Ollama daemon in CI/sandbox.
        Arc::new(AppState::new("http://127.0.0.1:1"))
    }

    #[tokio::test]
    async fn health_endpoint_reports_companion_ok_and_ollama_status() {
        let router = build_router(state_with_unreachable_ollama());

        let response = router
            .oneshot(Request::builder().uri("/health").header("host", "127.0.0.1:47291").body(Body::empty()).unwrap())
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);

        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let parsed: serde_json::Value = serde_json::from_slice(&body).unwrap();

        assert_eq!(parsed["companion_ok"], true);
        assert_eq!(parsed["ollama"]["status"], "not_running");
    }

    #[tokio::test]
    async fn health_endpoint_reports_reachable_when_ollama_responds() {
        // Real Ollama-shaped stand-in server, same technique as
        // ollama.rs's own tests.
        let ollama_app = axum::Router::new().route(
            "/api/tags",
            axum::routing::get(|| async { axum::Json(serde_json::json!({ "models": [] })) }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let ollama_addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, ollama_app).await.unwrap();
        });

        let state = Arc::new(AppState::new(format!("http://{ollama_addr}")));
        let router = build_router(state);

        let response = router
            .oneshot(Request::builder().uri("/health").header("host", "127.0.0.1:47291").body(Body::empty()).unwrap())
            .await
            .unwrap();
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let parsed: serde_json::Value = serde_json::from_slice(&body).unwrap();

        assert_eq!(parsed["ollama"]["status"], "reachable");
    }

    #[tokio::test]
    async fn ocr_endpoint_returns_not_implemented_never_fake_output() {
        let router = build_router(state_with_unreachable_ollama());

        let response = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/ocr")
                    .header("host", "127.0.0.1:47291")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::NOT_IMPLEMENTED);

        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let parsed: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(parsed["status"], "not_implemented");
        assert!(parsed["text"].is_null());
    }

    #[tokio::test]
    async fn serve_binds_to_loopback_only_and_returns_working_health_route() {
        // port 0 -> OS picks a free ephemeral port; proves `serve()` itself
        // (not just `build_router`) produces a live, reachable listener.
        let (addr, handle) = serve(0, "http://127.0.0.1:1").await.unwrap();
        assert!(addr.ip().is_loopback());

        let client = reqwest::Client::new();
        let resp = client
            .get(format!("http://{addr}/health"))
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), reqwest::StatusCode::OK);

        handle.abort();
    }

    #[tokio::test]
    async fn rejects_non_loopback_host_header_dns_rebinding_defense() {
        let router = build_router(state_with_unreachable_ollama());
        let response = router
            .oneshot(
                Request::builder()
                    .uri("/health")
                    .header("host", "rebind.attacker.example:47291")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::MISDIRECTED_REQUEST);
    }

    #[tokio::test]
    async fn allows_the_tauri_webview_origin_to_read_health_but_not_web_pages() {
        let router = build_router(state_with_unreachable_ollama());
        let ok = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/health")
                    .header("host", "127.0.0.1:47291")
                    .header("origin", "tauri://localhost")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            ok.headers().get("access-control-allow-origin").and_then(|v| v.to_str().ok()),
            Some("tauri://localhost")
        );

        let web = router
            .oneshot(
                Request::builder()
                    .uri("/health")
                    .header("host", "127.0.0.1:47291")
                    .header("origin", "https://evil.example")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert!(web.headers().get("access-control-allow-origin").is_none());
    }

    #[tokio::test]
    async fn answers_cors_preflight_for_the_webview() {
        let router = build_router(state_with_unreachable_ollama());
        let resp = router
            .oneshot(
                Request::builder()
                    .method("OPTIONS")
                    .uri("/ocr")
                    .header("host", "localhost:47291")
                    .header("origin", "http://tauri.localhost")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::NO_CONTENT);
        assert_eq!(
            resp.headers().get("access-control-allow-origin").and_then(|v| v.to_str().ok()),
            Some("http://tauri.localhost")
        );
    }

    #[test]
    fn loopback_host_parsing() {
        for ok in ["127.0.0.1:47291", "localhost:47291", "LOCALHOST", "[::1]:47291", "127.1.2.3:1"] {
            assert!(is_loopback_host(ok), "{ok} should be loopback");
        }
        for bad in ["evil.example", "127.0.0.1.nip.io:47291", "localhost.evil.example", "0.0.0.0:47291", ""] {
            assert!(!is_loopback_host(bad), "{bad} should NOT be loopback");
        }
    }
}
