import type { CapabilityLevel, ConfidenceLevel, DocumentBlock, StructuredDocument } from '../types';

/**
 * PDF adapter (Level 5 — file/structured-format extraction, per the research
 * doc's capability matrix). Uses `pdfjs-dist` (Mozilla's real pdf.js, the
 * same engine Firefox/Chrome's built-in PDF viewers are based on) to parse
 * PDF bytes, both for a locally-imported `File`/`ArrayBuffer` and, where
 * feasible, a PDF URL open in the browser tab (via `fetch`, same-origin/CORS
 * permitting — this only works when the tab's PDF is actually reachable by
 * fetch from the extension context, which is not guaranteed for every PDF
 * viewer situation; see docs/LIMITATIONS.md).
 *
 * Deliberate deviation from `SourceAdapter`'s synchronous interface: pdf.js
 * parsing is inherently promise-based (it can lazily fetch/parse large
 * files), so this module exposes an async API instead of literally
 * implementing `extractCurrentPage(doc): StructuredDocument | null`. The
 * *output* is the same `StructuredDocument`/`Chunk` schema every other
 * adapter produces, which is what the RAG pipeline actually depends on.
 *
 * Only text-based PDFs are supported. Scanned/image-only PDFs (no embedded
 * text layer) are explicitly NOT supported — no OCR in this phase. See
 * docs/LIMITATIONS.md.
 */

// pdfjs-dist 6.x (ESM-only `.mjs` builds). The legacy build is used because
// it targets older JS engines and Node, which the unit tests run under.
//
// Worker setup: pdf.js normally parses in a dedicated Web Worker loaded from
// `GlobalWorkerOptions.workerSrc`. Neither option works in the MV3 background
// service worker, which has no `Worker` constructor and forbids dynamic
// `import()` of a URL at runtime (pdf.js's fallback "fake worker" does exactly
// that). pdf.js's supported alternative is to provide the worker module on
// the main thread as `globalThis.pdfjsWorker`. The worker module assigns that
// global itself when it is evaluated, and pdf.js then parses in-thread with no
// `workerSrc`. Both modules are bundled into background.js; nothing is fetched.
// In-thread parsing is fine at MVP scale (a handful of PDFs at a time, not a
// bulk pipeline). Both modules load lazily and are cached, so nothing in this
// module's import graph pulls in pdf.js until a PDF is actually parsed.
type PdfjsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
let pdfjsLibPromise: Promise<PdfjsModule> | null = null;
function loadPdfjs(): Promise<PdfjsModule> {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = (async () => {
      const [lib, worker] = await Promise.all([
        import('pdfjs-dist/legacy/build/pdf.mjs'),
        import('pdfjs-dist/legacy/build/pdf.worker.mjs'),
      ]);
      const g = globalThis as { pdfjsWorker?: { WorkerMessageHandler: unknown } };
      g.pdfjsWorker ??= { WorkerMessageHandler: worker.WorkerMessageHandler };
      return lib;
    })();
  }
  return pdfjsLibPromise;
}

/**
 * Minimum pdfjs-dist version without GHSA-wgrm-67xf-hhpq (CVE-2024-4367).
 * Checked by tests/unit/pdfAdapterSafety.test.ts against the installed package.
 */
export const PDFJS_MIN_PATCHED_VERSION = '4.2.67';

/**
 * Hardened pdf.js options (audit SEC-05).
 *
 * pdfjs-dist <=4.7.76 is flagged by `npm audit` with GHSA-wgrm-67xf-hhpq
 * (CVE-2024-4367): a crafted PDF font could make pdf.js build and run
 * attacker-controlled JavaScript through its `new Function(...)` glyph-path
 * fast path, on by default (`isEvalSupported: true`). On 3.x this adapter
 * mitigated it with `isEvalSupported: false`. DEP-01 upgraded to pdfjs-dist
 * 6.x. Upstream fixed the font-type check in 4.2.67 and later removed the
 * eval glyph path and the `isEvalSupported` option altogether, so the
 * vulnerable code no longer exists to switch off. The flag is therefore no
 * longer passed: it would be a silently ignored no-op that suggests a control
 * that isn't there. The extension CSP (`script-src 'self'`) still blocks eval
 * in extension contexts as a second layer.
 *
 * The remaining flags keep this text-only extraction from reaching out
 * anywhere or running PDF-embedded scripting/XFA.
 */
export const PDF_SAFE_OPTIONS = {
  enableXfa: false,
  disableFontFace: true,
  useSystemFonts: false,
  stopAtErrors: false,
} as const;

/** Upper bound on pages parsed from one PDF, so a hostile/huge file can't
 * pin the background worker indefinitely. */
export const MAX_PDF_PAGES = 2_000;

export interface PdfLink {
  page: number; // 1-indexed
  url: string;
}

export interface PdfExtractionResult {
  document: StructuredDocument;
  links: PdfLink[];
  pageCount: number;
}

const PDF_URL_RE = /\.pdf(?:[?#]|$)/i;

export const pdfAdapter = {
  sourceType: 'pdf' as const,

  getCapabilityLevel(): CapabilityLevel {
    return 5;
  },

  getConfidence(): ConfidenceLevel {
    // Text-based PDFs extract reliably via pdf.js; still "medium" rather
    // than "high" because layout-derived reading order and multi-column
    // PDFs can scramble text order, and scanned PDFs silently yield nothing.
    return 'medium';
  },

  /** True for any URL that looks like a PDF (path or query ending in .pdf). */
  detectUrl(url: string): boolean {
    return PDF_URL_RE.test(url);
  },

  /**
   * Parses PDF bytes into a StructuredDocument. Each page becomes a heading
   * ("Page N") followed by its text as a paragraph block, so the existing,
   * unmodified `chunkDocument()` pipeline naturally attaches the page number
   * to each chunk's `sourceAnchor.headingPath` for citations — no changes
   * needed to the core Chunk schema.
   */
  async extractFromBytes(
    bytes: Uint8Array | ArrayBuffer,
    sourceUrl: string,
    fallbackTitle = 'Imported PDF',
  ): Promise<PdfExtractionResult> {
    const pdfjsLib = await loadPdfjs();
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const loadingTask = pdfjsLib.getDocument({ data, ...PDF_SAFE_OPTIONS });
    const pdf = await loadingTask.promise;

    const blocks: DocumentBlock[] = [];
    const links: PdfLink[] = [];

    const pagesToRead = Math.min(pdf.numPages, MAX_PDF_PAGES);
    for (let pageNum = 1; pageNum <= pagesToRead; pageNum += 1) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: any) => ('str' in item ? item.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();

      blocks.push({ type: 'heading', level: 1, text: `Page ${pageNum}` });
      if (pageText) {
        blocks.push({ type: 'paragraph', text: pageText });
      }

      const annotations = await page.getAnnotations();
      for (const annot of annotations) {
        if (annot.subtype !== 'Link') continue;
        const rawUrl: string | undefined = annot.url ?? annot.unsafeUrl;
        if (!rawUrl) continue;
        // pdf.js can emit a spurious leading "/" on absolute http(s) URLs
        // when no document base URL is supplied to getDocument() (observed
        // with pdf-lib-authored test fixtures with no /Base set) — strip it.
        const url = rawUrl.replace(/^\/+(?=https?:\/\/)/i, '');
        // Only record web links — never javascript:/file:/data: URIs from the PDF.
        if (!/^https?:\/\//i.test(url)) continue;
        links.push({ page: pageNum, url });
      }
    }

    if (pdf.numPages > pagesToRead) {
      blocks.push({
        type: 'paragraph',
        text: `[Only the first ${pagesToRead} of ${pdf.numPages} pages were imported — the import limit is ${MAX_PDF_PAGES} pages per PDF.]`,
      });
    }

    let title = fallbackTitle;
    let author: string | undefined;
    try {
      const meta = await pdf.getMetadata();
      const info = meta?.info as { Title?: string; Author?: string } | undefined;
      if (info?.Title) title = info.Title;
      author = info?.Author || undefined;
    } catch {
      // Some PDFs have no /Info dictionary at all — not an error.
    }

    const text = blocks.map((b) => b.text).join('\n\n');
    const document: StructuredDocument = {
      id: '',
      sourceId: '',
      title,
      text,
      blocks,
      metadata: {
        url: sourceUrl,
        title,
        author,
        timestamps: { capturedAt: Date.now() },
      },
      links: links.map((l) => l.url),
    };

    return { document, links, pageCount: pdf.numPages };
  },

  /**
   * Best-effort extraction of a PDF that's open in the current browser tab,
   * by fetching its bytes. Only works when the extension can actually fetch
   * that URL (same-origin or CORS-permitting; browser-native PDF viewer
   * pages sometimes block this) — this is the "where feasible" caveat from
   * the task description, and failures surface as a thrown error rather
   * than silently returning nothing.
   */
  async extractFromUrl(url: string): Promise<PdfExtractionResult> {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Could not fetch PDF at ${url}: HTTP ${res.status}`);
    }
    const buf = await res.arrayBuffer();
    const fallbackTitle = decodeURIComponent(url.split('/').pop() || 'Imported PDF');
    return this.extractFromBytes(buf, url, fallbackTitle);
  },
};
