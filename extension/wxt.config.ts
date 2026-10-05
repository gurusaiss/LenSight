import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'wxt';

/**
 * ONNX Runtime WASM binary shipped inside the package for the optional
 * Transformers.js embedding provider (audit CMP-03). Without this,
 * Transformers.js points onnxruntime-web at cdn.jsdelivr.net at runtime —
 * remotely hosted code, which MV3 / Chrome Web Store policy prohibits.
 *
 * Only one binary is needed: `onnxruntime-web/webgpu` (what
 * @huggingface/transformers imports) is aliased below to the CPU-only
 * `onnxruntime-web/wasm` bundle. That build embeds its Emscripten loader
 * (no runtime `import()`, which a service worker forbids) and needs just
 * `ort-wasm-simd-threaded.wasm` (14 MB, versus 27 MB for the WebGPU/asyncify
 * binary). WASM is Transformers.js's default browser device anyway. See
 * src/core/ai/embeddings/transformersEmbeddingProvider.ts.
 */
const ORT_WASM_FILES = ['ort-wasm-simd-threaded.wasm'];

const CDN_HOST = 'cdn.jsdelivr.net';

/**
 * DEP-01 / CDN leftover. @huggingface/transformers' browser build runs this
 * at module load (src/backends/onnx.js):
 *
 *   if (!(self instanceof ServiceWorkerGlobalScope) && ORT.versions.web && !ORT.wasm.wasmPaths) {
 *     const wasmPathPrefix = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${version}/dist/`;
 *     ORT.wasm.wasmPaths = { mjs: ..., wasm: ... };
 *   }
 *
 * In this extension that branch can never run: the library only loads in the
 * background service worker (skipped by its own guard), and
 * configureTransformersEnv() sets `wasmPaths` to the packaged file before any
 * session is created. Because it sits in module-init code, though, no runtime
 * setting can keep the remote-code URL out of background.js, and a store
 * reviewer's static scan can't tell that it's dead. Builds on
 * @xenova/transformers 2.x kept that package's equivalent module-init default
 * (a jsdelivr URL for its own dist/ directory) for the same reason.
 *
 * So the branch is removed from the library source before bundling. The
 * match is exact, and the build fails if it stops matching (for example after
 * a library upgrade), so the patch can never silently stop applying.
 * `assertNoCdnInBundle` then fails the build if the CDN host appears in any
 * emitted file, whatever its origin.
 */
const TRANSFORMERS_CDN_DEFAULT_RE =
  /if \(\s*\/\/ @ts-ignore[^\n]*\n\s*!\(typeof ServiceWorkerGlobalScope !== "undefined" && self instanceof ServiceWorkerGlobalScope\) && ONNX_ENV\.versions\?\.web && !ONNX_ENV\.wasm\.wasmPaths\s*\) \{\s*const wasmPathPrefix = `https:\/\/cdn\.jsdelivr\.net\/npm\/onnxruntime-web@\$\{ONNX_ENV\.versions\.web\}\/dist\/`;[\s\S]*?ONNX_ENV\.wasm\.wasmPaths = \{[\s\S]*?\n\s*\};\n\s*\}\n/g;

function stripTransformersCdnDefault(): Plugin {
  return {
    name: 'strip-transformers-cdn-default',
    enforce: 'pre',
    transform(code, id) {
      if (!/[\\/]@huggingface[\\/]transformers[\\/]dist[\\/]transformers\.web(\.min)?\.js$/.test(id)) return null;
      const matches = code.match(TRANSFORMERS_CDN_DEFAULT_RE);
      if (!matches || matches.length !== 1) {
        this.error(
          `strip-transformers-cdn-default: expected exactly 1 CDN wasmPaths default block in ${id}, found ${matches?.length ?? 0}. ` +
            'The library changed; update TRANSFORMERS_CDN_DEFAULT_RE in wxt.config.ts.',
        );
      }
      return { code: code.replace(TRANSFORMERS_CDN_DEFAULT_RE, ''), map: null };
    },
  };
}

function assertNoCdnInBundle(): Plugin {
  return {
    name: 'assert-no-cdn-in-bundle',
    enforce: 'post',
    generateBundle(_options, bundle) {
      for (const [fileName, output] of Object.entries(bundle)) {
        const text =
          output.type === 'chunk'
            ? output.code
            : typeof output.source === 'string'
              ? output.source
              : Buffer.from(output.source).toString('latin1');
        if (text.includes(CDN_HOST)) {
          this.error(`assert-no-cdn-in-bundle: "${CDN_HOST}" found in emitted ${fileName}`);
        }
      }
    },
  };
}

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: '.',
  modules: [],
  vite: () => ({
    plugins: [stripTransformersCdnDefault(), assertNoCdnInBundle()],
    resolve: {
      alias: [{ find: /^onnxruntime-web\/webgpu$/, replacement: 'onnxruntime-web/wasm' }],
    },
  }),
  hooks: {
    'build:publicAssets': (_wxt, files) => {
      for (const name of ORT_WASM_FILES) {
        files.push({
          absoluteSrc: resolve('node_modules/onnxruntime-web/dist', name),
          relativeDest: `ort/${name}`,
        });
      }
    },
  },
  manifest: {
    name: 'Lensight',
    description:
      'Lensight — a local-first AI context assistant: ask questions about the page you are viewing. Extraction and indexing happen on-device; only retrieved context is ever sent to an AI provider you choose.',
    version: '0.1.0',
    // Least privilege — every entry is used by a real code path (audit CMP-02;
    // full justification table in docs/PRIVACY.md → "Permissions"):
    // - storage:   chrome.storage.local for settings, onboarding/quick-action
    //              prefs, the diagnostics ring buffer, the shortcut handoff.
    // - activeTab: temporary access to the tab the user invokes the extension
    //              on (toolbar icon / keyboard shortcut) — replaces the old
    //              static `<all_urls>` content script (audit CMP-01).
    // - scripting: chrome.scripting.executeScript injects the content script
    //              into that one tab on demand (src/core/messaging/contentScript.ts).
    //              Previously declared but unused by any code path.
    // - sidePanel: the primary UI (chrome.sidePanel.open).
    permissions: ['storage', 'activeTab', 'sidePanel', 'scripting'],
    // Only localhost — needed so the background service worker can fetch a
    // user's own local Ollama daemon (ollamaProvider.ts / the Ollama option
    // of openAICompatibleProvider.ts) without depending on that daemon
    // sending permissive CORS headers for the extension's origin. No other
    // host is ever requested; remote providers (Gemini, OpenAI-compatible)
    // are called from the background worker using the user's own API key
    // over a normal, un-elevated fetch, same as any other web request.
    host_permissions: ['http://localhost/*'],
    action: {
      default_title: 'Lensight',
    },
    side_panel: {
      default_path: 'sidepanel.html',
    },
    // Keyboard shortcuts (Performance/UI-polish pass): registered via WXT's
    // commands API rather than a page-level listener, so they work even when
    // the side panel isn't focused. Invoking a command also grants
    // `activeTab` for the current tab. Any browser/OS/other-extension
    // conflict is possible and not something this codebase can detect; the
    // user can always rebind at chrome://extensions/shortcuts. Documented in
    // docs/SETUP.md rather than assumed to "just work".
    commands: {
      'open-assistant': {
        suggested_key: { default: 'Ctrl+Shift+E', mac: 'Command+Shift+E' },
        description: 'Open the Lensight side panel',
      },
      'ask-about-selection': {
        suggested_key: { default: 'Ctrl+Shift+Y', mac: 'Command+Shift+Y' },
        description: 'Capture the current text selection and open the assistant',
      },
    },
    // 'wasm-unsafe-eval' is required for WebAssembly.instantiate() in MV3
    // extension pages/service workers (it is part of Chrome's own default
    // MV3 policy); overriding the CSP without it made the Transformers.js
    // option impossible to run (audit CMP-03). It permits compiling WASM
    // only — JavaScript eval()/new Function() remain blocked.
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
  },
});
