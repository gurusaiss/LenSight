import type { EmbeddingProvider } from './EmbeddingProvider';

/**
 * PLUGGABLE UPGRADE — NOT THE DEFAULT.
 *
 * This provider uses @huggingface/transformers (Transformers.js v4, the
 * successor of the superseded `@xenova/transformers` package; DEP-01) to
 * run `Xenova/all-MiniLM-L6-v2` fully on-device on the ONNX Runtime WASM
 * backend for real neural sentence embeddings, corresponding to "Mode A"
 * local embeddings in the privacy architecture.
 *
 * Why it is NOT the default:
 *   - It requires downloading the model weights (tens of MB) on first use,
 *     which means a network fetch the very first time (from Hugging Face,
 *     then cached), which is a materially different trust/latency/storage
 *     tradeoff than the zero-setup, zero-network hashingEmbeddingProvider.
 *   - It is heavier to initialize (WASM runtime spin-up) and not needed to
 *     prove the end-to-end pipeline works.
 *
 * Runtime-selectable via Settings (`embeddingProviderKind: 'transformers'`,
 * see core/ai/providerSelection.ts). The library is bundled into
 * background.js (providerSelection imports this module), but the dynamic
 * import below means nothing *runs* (and no model is downloaded) unless the
 * user opts in.
 */

/** Minimal shape of the Transformers.js `env` object this module configures. */
export interface TransformersEnvLike {
  allowLocalModels: boolean;
  backends: {
    onnx: {
      wasm?: {
        wasmPaths?: string | { wasm?: string; mjs?: string };
        numThreads?: number;
        proxy?: boolean;
      };
    };
  };
}

/** Directory (inside the extension package) holding the ONNX Runtime WASM
 * binary, copied there at build time by wxt.config.ts. */
export const ORT_WASM_DIR = 'ort/';

/** The one ONNX Runtime binary the extension ships: the SIMD CPU build used
 * by `onnxruntime-web/wasm` (wxt.config.ts aliases Transformers.js's
 * `onnxruntime-web/webgpu` import to that build). Upstream names it
 * "threaded", but it runs here with numThreads = 1. */
export const ORT_WASM_FILE = 'ort-wasm-simd-threaded.wasm';

/** Model weights variant: 8-bit quantized (`onnx/model_quantized.onnx`), the
 * same file @xenova/transformers v2 loaded by default, so stored vectors stay
 * comparable across the upgrade. No `device` is passed: Transformers.js's
 * browser default is already `wasm` (the only backend packaged), and `wasm`
 * is not a valid device name under Node, where the unit tests run. */
export const TRANSFORMERS_PIPELINE_OPTIONS = { dtype: 'q8' } as const;

/**
 * Audit CMP-03. Left alone, Transformers.js points ONNX Runtime at
 * cdn.jsdelivr.net for its WASM runtime. In an MV3 extension that is (a)
 * remotely hosted executable code, which Chrome Web Store policy prohibits,
 * and (b) blocked anyway by this extension's CSP. It also first probes for
 * "local" model files at a relative /models/ path that doesn't exist in the
 * package.
 *
 * This points ONNX Runtime at the WASM binary shipped inside the extension,
 * single-threaded (a service worker is not cross-origin isolated, so
 * SharedArrayBuffer threads are unavailable), and skips the local-model
 * probe. Only the `.wasm` path is given, never an `.mjs` loader path: the
 * `onnxruntime-web/wasm` bundle embeds its Emscripten loader, and
 * ONNX Runtime uses that embedded loader only when no `.mjs`/prefix override
 * is set. A prefix string would make it `import()` a loader file at
 * runtime, which a service worker forbids. Model *weights* (data, not code)
 * are still downloaded once from Hugging Face when the user opts in.
 *
 * The library's own CDN default is also removed from the bundle at build time
 * (wxt.config.ts → `stripTransformersCdnDefault`). This runtime config is
 * what actually selects the packaged binary.
 */
export function configureTransformersEnv(env: TransformersEnvLike | undefined, getURL?: (path: string) => string): void {
  if (!env) return;
  env.allowLocalModels = false;
  const wasm = env.backends?.onnx?.wasm;
  if (!wasm) return;
  if (getURL) wasm.wasmPaths = { wasm: getURL(ORT_WASM_DIR + ORT_WASM_FILE) };
  wasm.numThreads = 1;
  wasm.proxy = false;
}

export class TransformersEmbeddingProvider implements EmbeddingProvider {
  name = 'transformers-all-MiniLM-L6-v2';
  modelId = 'Xenova/all-MiniLM-L6-v2';
  dimensions = 384;

  private pipelinePromise: Promise<any> | null = null;

  private async getPipeline() {
    if (!this.pipelinePromise) {
      this.pipelinePromise = (async () => {
        // Dynamic import so this heavy dependency is only ever loaded when a
        // user explicitly opts into this provider.
        const { pipeline, env } = await import('@huggingface/transformers');
        const getURL =
          typeof chrome !== 'undefined' && typeof chrome.runtime?.getURL === 'function'
            ? (path: string) => chrome.runtime.getURL(path)
            : undefined;
        configureTransformersEnv(env as unknown as TransformersEnvLike, getURL);
        return pipeline('feature-extraction', this.modelId, TRANSFORMERS_PIPELINE_OPTIONS);
      })();
    }
    return this.pipelinePromise;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    const extractor = await this.getPipeline();
    const results: Float32Array[] = [];
    for (const text of texts) {
      // mean-pooling + normalize, as recommended for all-MiniLM-L6-v2.
      const output = await extractor(text, { pooling: 'mean', normalize: true });
      results.push(new Float32Array(output.data as Float32Array));
    }
    return results;
  }
}

export const transformersEmbeddingProvider = new TransformersEmbeddingProvider();
