# Lensight — Desktop Companion

A small, optional Tauri desktop app that sits alongside the browser
extension in `../ai-context-assistant/`. This is Phase 7 of the research
doc (`../universal-ai-context-assistant-research.md`), built here for the
first time — the extension's Phase 8 pass (error handling, onboarding,
diagnostics, polish, command palette, keyboard shortcuts, context
transparency / citation click-through) did **not** touch this directory and
is untouched by this pass.

**This companion is entirely optional.** Nothing in the extension requires
it:

- Mode A's zero-install path (hashing embeddings + `extractiveLocalProvider`)
  works with the companion never installed.
- Mode A's real-local-generation path (`OllamaProvider`, in
  `ai-context-assistant/src/core/ai/providers/ollamaProvider.ts`) already
  talks directly to a user-installed Ollama daemon at
  `http://localhost:11434` — **that code path is untouched by this pass**
  and does not go through the companion.
- Mode B/C (remote providers) never involve this companion at all.

What the companion adds, when a user chooses to run it, is desktop-side
convenience: an Ollama health view, a fixed local HTTP API a future
desktop-aware extension feature could reach, and a native (less
sandboxed) file picker. None of it is wired into the extension's runtime
in this pass — the extension's own `ollamaProvider.ts` contract is not
modified, and there is no code in `ai-context-assistant/` that calls this
companion's API yet. This ships the companion itself, ready for that future
wiring.

## Why two crates (`core` + `src-tauri`)

- `core` (`lensight-companion-core`) has **zero** GUI/windowing
  dependency. It holds the Ollama health-check logic, the local HTTP API
  (via `axum`), the OCR stub, and the file-picker *contract types* (not the
  picker itself). It compiles and its tests run in any environment with a
  plain Rust toolchain — including this sandbox.
- `src-tauri` (`lensight-companion`) is the real Tauri
  application: it depends on `core`, adds the Tauri runtime, the native
  file-picker *implementation* (`tauri-plugin-dialog`), and the HTML/JS
  shell in `../ui/`. It additionally requires a native webview toolkit
  (`webkit2gtk` + `gtk`/`gdk` + friends on Linux; WebView2 on Windows;
  WKWebView on macOS) to compile and link.

This split is deliberate, not incidental: it is what let the
GUI-independent logic be actually compiled and unit tested here, in an
environment that cannot build the GUI shell (see below).

## Build status in this environment (real, not claimed)

### `core` — compiles and tests pass

```
$ cargo check -p lensight-companion-core
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 18.11s

$ cargo test -p lensight-companion-core
running 14 tests
test native_file_picker::tests::always_includes_an_all_files_fallback_filter ... ok
test native_file_picker::tests::default_filters_match_localfileadapter_supported_extensions_exactly ... ok
test ocr::tests::always_returns_not_implemented_never_fake_text ... ok
test native_file_picker::tests::picked_file_round_trips_through_json ... ok
test ocr::tests::empty_input_also_returns_not_implemented_not_empty_success ... ok
test ocr::tests::response_conversion_never_carries_text ... ok
test ollama::tests::trailing_slash_in_base_url_is_normalized_in_the_report ... ok
test ollama::tests::reports_not_running_when_nothing_is_listening ... ok
test server::tests::health_endpoint_reports_companion_ok_and_ollama_status ... ok
test server::tests::ocr_endpoint_returns_not_implemented_never_fake_output ... ok
test ollama::tests::reachable_status_reports_the_base_url ... ok
test ollama::tests::unreachable_status_when_daemon_errors ... ok
test server::tests::health_endpoint_reports_reachable_when_ollama_responds ... ok
test server::tests::serve_binds_to_loopback_only_and_returns_working_health_route ... ok

test result: ok. 14 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
```

`cargo check`/`cargo test`/`cargo build` with **no** package flag also only
build `core` — the workspace root `Cargo.toml` sets
`default-members = ["core"]` specifically so the common case ("does the
buildable part still work") doesn't require remembering `-p`.

### `src-tauri` — does NOT build here; real, honest failure

```
$ cargo check -p lensight-companion
error: failed to run custom build command for `gdk-sys v0.18.2`
...
pkg-config output:
  Package gdk-3.0 was not found in the pkg-config search path.
  Perhaps you should add the directory containing `gdk-3.0.pc'
  to the PKG_CONFIG_PATH environment variable
  Package 'gdk-3.0', required by 'virtual:world', not found
  Package 'gdk-3.0', required by 'virtual:world', not found

The system library `gdk-3.0` required by crate `gdk-sys` was not found.
The file `gdk-3.0.pc` needs to be installed and the PKG_CONFIG_PATH environment variable must contain its parent directory.
```

This is Tauri's Linux GTK/WebKitGTK dependency chain (`gdk-sys` →
`gdk-3.0`/`gtk3`/`webkit2gtk-4.1` and related `.pc` files), which this
sandbox does not have installed and cannot install (no package manager
access to system libraries here). **No full desktop app run or GUI was
attempted or verified** — that would require this to succeed first, plus
an actual display/webview runtime, neither of which exist in this
environment. On a real Linux dev machine, installing the OS packages Tauri
documents (e.g. Ubuntu/Debian:
`libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev`,
or the equivalent for your distro) and re-running the same command is
expected to get past this specific error; that was not re-verified here
since those packages cannot be installed in this sandbox.

`src-tauri` is still a real, complete workspace member — not a placeholder
— and is expected to build once those system libraries are present. It is
just not part of the default `cargo check`/`test`/`build` invocation (see
`default-members` above), so that its known-missing system dependency
doesn't make the buildable `core` crate look broken too.

## What's Implemented / Experimental / Planned

| Sub-feature | Status | Notes |
|---|---|---|
| Ollama health-check (`core::ollama::check_ollama_status`) | **Implemented** | Real HTTP GET to `{base_url}/api/tags` with a 2s timeout; three explicit outcomes (`Reachable`/`Unreachable`/`NotRunning`), never a silent guess. Unit tested against real, ephemeral local HTTP servers (not mocked `fetch`) — including a genuine connection-refused case (port 1) and a genuine HTTP-500 case. |
| Local HTTP API on `127.0.0.1:47291` (`core::server`) | **Implemented** | `axum` router bound to `127.0.0.1` only (never `0.0.0.0`); `GET /health` combines companion liveness + the Ollama check above; `POST /ocr` always returns the explicit not-implemented shape (below). Unit tested in-process (`tower::ServiceExt::oneshot`) and via a real bound socket (`serve()` test using an OS-assigned ephemeral port). |
| Nothing in the extension calls this API yet | **Planned** | The extension's `ollamaProvider.ts` is untouched and still talks to Ollama directly; wiring a desktop-aware code path in the extension to prefer this companion's API when reachable is future work, out of this pass's scope. |
| Native file picker — contract types (`core::native_file_picker`) | **Implemented** | `PickedFile`/`FileFilter`/`default_import_filters()` — the latter deliberately matches `localFileAdapter.ts`'s supported extensions exactly (txt/md/csv/json/pdf, explicitly excluding `.docx`, same as the extension). Unit tested (JSON round-trip, filter contents). |
| Native file picker — real implementation (`src-tauri/src/file_picker.rs`, `pick_files` Tauri command) | **Experimental** | Real code using `tauri-plugin-dialog`'s native, less-sandboxed multi-file picker, mapping results into `PickedFile`. Cannot be compiled or exercised in this sandbox (see build status above), so it has never actually run against a real OS file dialog. Treat as unverified until built and run on a real desktop with the required system libraries installed. |
| OCR (`core::ocr::extract_text`) | **Planned** | Always returns `OcrError::NotImplemented`; the `/ocr` HTTP endpoint responds `501 Not Implemented` with `{ "status": "not_implemented", "text": null, "message": "..." }`. No image bytes are ever read, no placeholder/fabricated text is ever returned. Matches `ai-context-assistant/docs/LIMITATIONS.md`'s existing "Scanned / image-only PDF (OCR): Not supported... Explicitly Planned only" row — this is the desktop-side half of that same honest gap, not a new or conflicting claim. |
| Tauri GUI shell / window (`src-tauri`, `ui/index.html`) | **Experimental (code complete, unverified)** | Real `tauri::Builder` wiring (plugin registration, command handler, background HTTP server spawn on `setup`) and a minimal HTML/JS status+picker page. Never actually launched — cannot compile here (see above), so no screenshot or interactive run backs this; treat the shell as reviewed source, not a demonstrated working app. |
| Packaged/bundled binary (installer, `.deb`/`.AppImage`/`.msi`/`.dmg`) | **Not attempted** | Requires `src-tauri` to build first, which it does not here. |

## Directory layout

```
desktop-companion/
├── Cargo.toml              # workspace root (default-members = ["core"])
├── core/                   # GUI-free crate — compiles + tests here
│   ├── Cargo.toml
│   └── src/
│       ├── lib.rs                 # DEFAULT_PORT, DEFAULT_OLLAMA_BASE_URL
│       ├── ollama.rs               # health-check logic + tests
│       ├── server.rs               # axum HTTP API + tests
│       ├── ocr.rs                  # explicit not-implemented stub + tests
│       └── native_file_picker.rs   # picker contract types + tests
├── src-tauri/               # real Tauri shell — does not build here (see above)
│   ├── Cargo.toml
│   ├── build.rs
│   ├── tauri.conf.json
│   ├── icons/               # placeholder PNG icons (32/128/128@2x + icon.png)
│   └── src/
│       ├── main.rs
│       ├── lib.rs            # Builder wiring, spawns core::server on setup
│       └── file_picker.rs    # real tauri-plugin-dialog implementation
└── ui/
    └── index.html            # minimal status view + "Pick file" button
```

## How to build / run

**What's actually been run in this environment** — see "Build status"
above for the exact commands and output.

**On a real desktop with a Rust toolchain and (for the GUI shell) Tauri's
system dependencies installed:**

```bash
# GUI-free core only (always works, matches this pass's verification):
cargo check -p lensight-companion-core
cargo test  -p lensight-companion-core

# Full Tauri app (needs system webview libs — see Tauri's own
# "Prerequisites" docs for your OS, e.g. libwebkit2gtk-4.1-dev/libgtk-3-dev
# on Debian/Ubuntu, or the Tauri CLI's `tauri dev`/`tauri build` once those
# are installed):
cargo check -p lensight-companion
cargo build -p lensight-companion
```

There is no `npm`/Node tooling in this companion — `ui/index.html` is a
static file served directly by the Tauri webview, not a bundled frontend
build, so no separate `frontendDist` build step exists to run.

## Ports and endpoints

- Fixed port: `47291` (`core::DEFAULT_PORT`) — chosen once and documented
  rather than made configurable via the API itself, so a future extension
  integration can be hardcoded to reach it without a discovery step.
- `GET http://127.0.0.1:47291/health` → `{ "companion_ok": true, "ollama": { "status": "reachable" | "unreachable" | "not_running", ... } }`
- `POST http://127.0.0.1:47291/ocr` → always `501` with the not-implemented body above.

Bound to `127.0.0.1` explicitly, never `0.0.0.0` — this is a same-machine
convenience endpoint, not a network service.

## 2026-09-24 audit/remediation pass

- **C-FUN-01 (fixed in code, GUI unverified):** the webview UI's status line
  fetches `http://127.0.0.1:47291/health`, but (a) the Tauri CSP
  (`default-src 'self'`) blocked that connection and (b) the API sent no CORS
  headers, so the status could never show anything but "not reachable". The
  core API now returns `Access-Control-Allow-Origin` for the Tauri webview
  origins only (`tauri://localhost`, `http(s)://tauri.localhost` — never web
  pages) and answers CORS preflight; `tauri.conf.json`'s CSP adds
  `connect-src 'self' ipc: http://ipc.localhost http://127.0.0.1:47291`. The
  CSP change could not be verified by a build here (the `src-tauri` shell
  still fails on missing `gdk-3.0`, as documented above).
- **C-SEC-01 (fixed, tested):** requests whose `Host` header is not a loopback
  name/address are rejected with 421 (DNS-rebinding defense).
- `cargo test` in `core/` after this pass: `test result: ok. 18 passed; 0
  failed` (14 before; +4 for the CORS/Host middleware). `cargo clippy
  --all-targets`: no warnings. `cargo audit`: not installed in this
  environment (`error: no such command: audit`), so no RustSec scan was run.
