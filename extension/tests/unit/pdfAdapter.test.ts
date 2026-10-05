import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { pdfAdapter } from '../../src/core/adapters/pdfAdapter';

/**
 * Builds a small, REAL PDF at test time with pdf-lib (a separate, independent
 * PDF-writing library from pdfjs-dist) — two pages of known text, a Link
 * annotation with a known URI, and Title/Author document metadata — then
 * proves `pdfAdapter` extracts it correctly via real pdf.js parsing. Nothing
 * here is mocked: both the PDF bytes and the parser are real.
 */
async function buildFixturePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle('Test PDF Title');
  doc.setAuthor('Test Author');
  const font = await doc.embedFont(StandardFonts.Helvetica);

  const page1 = doc.addPage([300, 300]);
  page1.drawText('Hello PDF world, this is page one.', { x: 20, y: 250, size: 14, font });
  page1.drawText('Visit https://example.com for more.', { x: 20, y: 220, size: 12, font });

  const linkAnnot = doc.context.register(
    doc.context.obj({
      Type: 'Annot',
      Subtype: 'Link',
      Rect: [20, 200, 220, 216],
      Border: [0, 0, 0],
      A: { Type: 'Action', S: 'URI', URI: 'https://example.com/' },
    }),
  );
  page1.node.set(doc.context.obj('Annots'), doc.context.obj([linkAnnot]));

  const page2 = doc.addPage([300, 300]);
  page2.drawText('This is the second page of content.', { x: 20, y: 250, size: 14, font });

  return doc.save();
}

describe('pdfAdapter (real pdf-lib-authored fixture, parsed with real pdf.js)', () => {
  it('extracts per-page text into headed blocks (page number as citation anchor)', async () => {
    const bytes = await buildFixturePdf();
    const { document, pageCount } = await pdfAdapter.extractFromBytes(bytes, 'https://example.com/test.pdf');

    expect(pageCount).toBe(2);
    expect(document.text).toContain('Hello PDF world, this is page one.');
    expect(document.text).toContain('This is the second page of content.');

    const pageHeadings = document.blocks!.filter((b) => b.type === 'heading').map((b) => b.text);
    expect(pageHeadings).toEqual(['Page 1', 'Page 2']);
  });

  it('extracts title/author metadata from the PDF', async () => {
    const bytes = await buildFixturePdf();
    const { document } = await pdfAdapter.extractFromBytes(bytes, 'https://example.com/test.pdf');
    expect(document.title).toBe('Test PDF Title');
    expect(document.metadata.author).toBe('Test Author');
  });

  it('extracts at least one Link annotation with its URI, attributed to the correct page', async () => {
    const bytes = await buildFixturePdf();
    const { links } = await pdfAdapter.extractFromBytes(bytes, 'https://example.com/test.pdf');

    expect(links.length).toBeGreaterThanOrEqual(1);
    expect(links[0]).toMatchObject({ page: 1, url: 'https://example.com/' });
    expect(document_links_include(links, 'https://example.com/')).toBe(true);
  });

  it('feeds cleanly into the existing chunking pipeline via chunkDocument, with a page-number heading anchor', async () => {
    const { chunkDocument } = await import('../../src/core/processing/chunk');
    const bytes = await buildFixturePdf();
    const { document } = await pdfAdapter.extractFromBytes(bytes, 'https://example.com/test.pdf');
    const chunks = chunkDocument({ ...document, id: 'doc_1', sourceId: 'src_1' });

    // This tiny 2-page fixture is small enough that chunk.ts's existing
    // (unmodified) buffering logic merges both pages into one chunk before
    // flushing — so we assert the general "some page heading survived as a
    // citation anchor" property here, rather than assuming one chunk per
    // page (chunk.ts, tested independently in chunk.test.ts, decides that).
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks.some((c) => c.sourceAnchor?.headingPath?.some((h) => /^Page \d+$/.test(h)))).toBe(true);
  });

  it('a larger multi-page PDF produces multiple chunks, each anchored to its own page', async () => {
    const { chunkDocument } = await import('../../src/core/processing/chunk');
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const longSentence =
      'This paragraph exists purely to push this page past the chunker\'s minimum token target so each page flushes as its own chunk. ';
    for (let i = 0; i < 4; i += 1) {
      const page = doc.addPage([600, 800]);
      let y = 750;
      for (let line = 0; line < 25; line += 1) {
        page.drawText(longSentence, { x: 20, y, size: 10, font });
        y -= 20;
      }
    }
    const bytes = await doc.save();
    const { document } = await pdfAdapter.extractFromBytes(bytes, 'https://example.com/big.pdf');
    const chunks = chunkDocument({ ...document, id: 'doc_2', sourceId: 'src_2' });

    expect(chunks.length).toBeGreaterThan(1);
    const pagesSeen = new Set(
      chunks.flatMap((c) => c.sourceAnchor?.headingPath?.filter((h) => /^Page \d+$/.test(h)) ?? []),
    );
    expect(pagesSeen.size).toBeGreaterThan(1);
  });

  it('detectUrl() recognizes .pdf URLs, including with a query string', () => {
    expect(pdfAdapter.detectUrl('https://example.com/report.pdf')).toBe(true);
    expect(pdfAdapter.detectUrl('https://example.com/report.pdf?x=1')).toBe(true);
    expect(pdfAdapter.detectUrl('https://example.com/report.html')).toBe(false);
  });

  it('getCapabilityLevel/getConfidence match the research doc L5 designation', () => {
    expect(pdfAdapter.getCapabilityLevel()).toBe(5);
    expect(pdfAdapter.getConfidence()).toBe('medium');
  });
});

function document_links_include(links: { url: string }[], url: string): boolean {
  return links.some((l) => l.url === url);
}
