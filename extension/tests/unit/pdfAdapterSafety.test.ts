import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

/**
 * Audit SEC-05 / DEP-01. On pdfjs-dist 3.x, GHSA-wgrm-67xf-hhpq
 * (CVE-2024-4367) was mitigated by passing isEvalSupported:false. DEP-01
 * upgraded to 6.x, where the eval glyph path and the option no longer exist,
 * so the mitigation is now "the installed pdf.js is a patched version and its
 * shipped build has no eval glyph compiler". Both are checked against the
 * real installed package, not a mock. Non-web link annotations must still not
 * be recorded. The getDocument tests mock pdf.js only to observe the options
 * passed; real parsing is covered by pdfAdapter.test.ts.
 */
const getDocument = vi.fn();
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({ getDocument }));
vi.mock('pdfjs-dist/legacy/build/pdf.worker.mjs', () => ({ WorkerMessageHandler: {} }));

const require = createRequire(import.meta.url);
const pdfjsRoot = dirname(require.resolve('pdfjs-dist/package.json'));

function versionAtLeast(actual: string, min: string): boolean {
  const a = actual.split(/[.-]/).map(Number);
  const b = min.split('.').map(Number);
  for (let i = 0; i < b.length; i += 1) {
    if ((a[i] ?? 0) !== b[i]) return (a[i] ?? 0) > b[i];
  }
  return true;
}

describe('pdf.js version is patched for CVE-2024-4367 (DEP-01)', () => {
  it('installed pdfjs-dist is at or above the first patched release', async () => {
    const { PDFJS_MIN_PATCHED_VERSION } = await import('../../src/core/adapters/pdfAdapter');
    const { version } = JSON.parse(readFileSync(join(pdfjsRoot, 'package.json'), 'utf8')) as { version: string };
    expect(versionAtLeast(version, PDFJS_MIN_PATCHED_VERSION)).toBe(true);
  });

  it('the bundled legacy build has no eval-based glyph compiler left to disable', () => {
    for (const file of ['pdf.mjs', 'pdf.worker.mjs']) {
      const src = readFileSync(join(pdfjsRoot, 'legacy/build', file), 'utf8');
      expect(src).not.toContain('isEvalSupported');
      // The 3.x glyph fast path built `new Function("c", "size", ...)`.
      expect(src).not.toMatch(/new Function\(\s*["']c["']\s*,\s*["']size["']/);
    }
  });

  it('pdfAdapter no longer passes the removed isEvalSupported option', async () => {
    const { PDF_SAFE_OPTIONS } = await import('../../src/core/adapters/pdfAdapter');
    expect('isEvalSupported' in PDF_SAFE_OPTIONS).toBe(false);
  });
});

describe('pdfAdapter hardening (SEC-05)', () => {
  it('calls getDocument with XFA, font-face loading and system fonts off', async () => {
    getDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: async () => ({
          getTextContent: async () => ({ items: [{ str: 'hello' }] }),
          getAnnotations: async () => [
            { subtype: 'Link', url: 'https://ok.example/' },
            { subtype: 'Link', unsafeUrl: 'javascript:alert(1)' },
            { subtype: 'Link', unsafeUrl: 'file:///etc/passwd' },
          ],
        }),
        getMetadata: async () => ({ info: {} }),
      }),
    });
    const { pdfAdapter } = await import('../../src/core/adapters/pdfAdapter');
    const { links } = await pdfAdapter.extractFromBytes(new Uint8Array([1, 2, 3]), 'file://x.pdf');
    const opts = getDocument.mock.calls[0][0];
    expect(opts.enableXfa).toBe(false);
    expect(opts.disableFontFace).toBe(true);
    expect(opts.useSystemFonts).toBe(false);
    expect(links.map((l) => l.url)).toEqual(['https://ok.example/']);
  });

  it('caps the number of pages parsed and says so in the document', async () => {
    const getPage = vi.fn(async () => ({
      getTextContent: async () => ({ items: [{ str: 'p' }] }),
      getAnnotations: async () => [],
    }));
    getDocument.mockReturnValue({
      promise: Promise.resolve({ numPages: 5_000, getPage, getMetadata: async () => ({ info: {} }) }),
    });
    const { pdfAdapter, MAX_PDF_PAGES } = await import('../../src/core/adapters/pdfAdapter');
    const { document } = await pdfAdapter.extractFromBytes(new Uint8Array([1]), 'file://big.pdf');
    expect(getPage).toHaveBeenCalledTimes(MAX_PDF_PAGES);
    expect(document.text).toContain(`Only the first ${MAX_PDF_PAGES} of 5000 pages`);
  });
});
