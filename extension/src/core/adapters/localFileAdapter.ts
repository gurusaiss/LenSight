import type { CapabilityLevel, ConfidenceLevel, DocumentBlock, StructuredDocument } from '../types';
import { pdfAdapter } from './pdfAdapter';
import { ExtractionFailedError } from '../errors';

/**
 * Local file import adapter (Level 5, "file/structured-format extraction"
 * per the research doc). Accepts a browser `File` object and normalizes its
 * content into the same `StructuredDocument`/`Chunk` schema every other
 * adapter produces.
 *
 * Like `pdfAdapter`, this is inherently async (`File.text()` /
 * `File.arrayBuffer()` are promise-based), so it does not literally
 * implement `SourceAdapter`'s synchronous methods — same documented
 * deviation as pdfAdapter.ts.
 *
 * Supported: .txt, .md, .csv, .json (all implemented and unit-tested here),
 * .pdf (delegates to pdfAdapter.ts). .docx is explicitly NOT implemented —
 * see `extractLocalFile`'s docx branch and docs/LIMITATIONS.md — rather than
 * faking a lightweight extractor, since no dependency-light, reliable pure-JS
 * docx text extractor was added in this pass.
 */

export type LocalFileKind = 'txt' | 'md' | 'csv' | 'json' | 'pdf' | 'docx' | 'unknown';

export function detectFileKind(file: { name: string; type?: string }): LocalFileKind {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf') || file.type === 'application/pdf') return 'pdf';
  if (name.endsWith('.docx')) return 'docx';
  if (name.endsWith('.csv') || file.type === 'text/csv') return 'csv';
  if (name.endsWith('.json') || file.type === 'application/json') return 'json';
  if (name.endsWith('.md') || name.endsWith('.markdown')) return 'md';
  if (name.endsWith('.txt') || file.type === 'text/plain') return 'txt';
  return 'unknown';
}

export const localFileAdapter = {
  sourceType: 'local-file' as const,

  getCapabilityLevel(): CapabilityLevel {
    return 5;
  },

  getConfidence(kind: LocalFileKind): ConfidenceLevel {
    // Plain-text formats parse deterministically; CSV/JSON parsing can fail
    // on malformed input (falls back to raw text, flagged lower confidence).
    return kind === 'txt' || kind === 'md' ? 'high' : 'medium';
  },
};

/** Splits Markdown/plain text into heading/paragraph blocks the same way
 * genericWebAdapter's output looks, so chunk.ts's heading-path tracking
 * works identically for locally-imported text as for a captured web page. */
function textToBlocks(text: string): DocumentBlock[] {
  const lines = text.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
  const blocks: DocumentBlock[] = [];
  for (const para of lines) {
    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(para);
    if (headingMatch) {
      blocks.push({ type: 'heading', level: headingMatch[1].length, text: headingMatch[2].trim() });
      continue;
    }
    if (/^[-*]\s+/.test(para)) {
      // A run of markdown list items within one blank-line-delimited block.
      para.split('\n').forEach((line) => {
        const item = line.replace(/^[-*]\s+/, '').trim();
        if (item) blocks.push({ type: 'list-item', text: item });
      });
      continue;
    }
    blocks.push({ type: 'paragraph', text: para.replace(/\n/g, ' ') });
  }
  return blocks;
}

/** Minimal CSV parser: handles quoted fields with embedded commas/quotes,
 * per RFC 4180 basics — no external dependency, matching this project's
 * "dependency-free where reasonable" style (see genericWebAdapter.ts). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; } else { inQuotes = false; }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ',') { pushField(); continue; }
    if (ch === '\n') { pushRow(); continue; }
    if (ch === '\r') { continue; }
    field += ch;
  }
  if (field.length > 0 || row.length > 0) pushRow();
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

function csvToBlocks(text: string): DocumentBlock[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [{ type: 'paragraph', text: '' }];
  const [header, ...dataRows] = rows;
  const blocks: DocumentBlock[] = [{ type: 'heading', level: 1, text: `Table (${dataRows.length} rows)` }];
  for (const row of dataRows) {
    const pairs = header.map((col, i) => `${col || `col${i + 1}`}: ${row[i] ?? ''}`).join(', ');
    blocks.push({ type: 'list-item', text: pairs });
  }
  return blocks;
}

/** Flattens JSON into readable "path: value" lines rather than dumping raw
 * JSON syntax at the chunker/embedder, which works far better for retrieval
 * over prose-oriented cosine similarity (hashing embeddings especially). */
function flattenJson(value: unknown, prefix: string, out: string[], maxDepth = 6): void {
  if (maxDepth < 0) return;
  if (value === null || typeof value !== 'object') {
    out.push(`${prefix}: ${JSON.stringify(value)}`);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) { out.push(`${prefix}: []`); return; }
    value.forEach((item, i) => flattenJson(item, `${prefix}[${i}]`, out, maxDepth - 1));
    return;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) { out.push(`${prefix}: {}`); return; }
  for (const [key, v] of entries) {
    flattenJson(v, prefix ? `${prefix}.${key}` : key, out, maxDepth - 1);
  }
}

function jsonToBlocks(text: string): DocumentBlock[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Malformed JSON: fall back to raw text rather than throwing, so the
    // user still gets *something* indexed (flagged 'medium' confidence).
    return [{ type: 'paragraph', text }];
  }
  const lines: string[] = [];
  flattenJson(parsed, '', lines);
  return [
    { type: 'heading', level: 1, text: 'JSON data' },
    ...lines.map((l): DocumentBlock => ({ type: 'list-item', text: l })),
  ];
}

export interface LocalFileExtractionResult {
  document: StructuredDocument;
  kind: LocalFileKind;
  confidence: ConfidenceLevel;
}

/**
 * Extracts a browser `File` into a StructuredDocument. Throws for `docx`
 * (explicitly Planned, not silently faked) and for any other unrecognized
 * extension.
 */
export async function extractLocalFile(file: File): Promise<LocalFileExtractionResult> {
  const kind = detectFileKind(file);
  const url = `file://${file.name}`;

  if (kind === 'pdf') {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { document } = await pdfAdapter.extractFromBytes(bytes, url, file.name);
    return { document, kind, confidence: pdfAdapter.getConfidence() };
  }

  if (kind === 'docx') {
    throw new ExtractionFailedError(
      '.docx import is Planned, not implemented in this phase — no lightweight, reliable pure-JS docx ' +
        'text extractor was added rather than faking support. See docs/LIMITATIONS.md.',
    );
  }

  if (kind === 'unknown') {
    throw new ExtractionFailedError(
      `Unrecognized file type for "${file.name}" — supported: .txt, .md, .csv, .json, .pdf.`,
    );
  }

  const text = await file.text();
  let blocks: DocumentBlock[];
  if (kind === 'csv') blocks = csvToBlocks(text);
  else if (kind === 'json') blocks = jsonToBlocks(text);
  else blocks = textToBlocks(text);

  const title = file.name;
  const document: StructuredDocument = {
    id: '',
    sourceId: '',
    title,
    text: blocks.map((b) => b.text).join('\n\n'),
    blocks,
    metadata: { url, title, timestamps: { capturedAt: Date.now() } },
  };

  return { document, kind, confidence: localFileAdapter.getConfidence(kind) };
}
