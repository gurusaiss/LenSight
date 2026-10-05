import type { Chunk, DocumentBlock, StructuredDocument } from '../types';
import { cleanText } from './clean';

/**
 * Paragraph/heading-aware chunking, targeting ~300-500 tokens per chunk with
 * overlap, and never splitting mid-sentence — per the RAG/Storage
 * Architecture section of the spec.
 *
 * Token counting: we don't ship a tokenizer for the MVP (no network/model
 * download needed for the default local pipeline), so tokens are estimated
 * from word count using a standard ~1.3 tokens-per-word approximation. This
 * is documented here rather than silently treated as exact.
 */

export const TARGET_MIN_TOKENS = 300;
export const TARGET_MAX_TOKENS = 500;
export const OVERLAP_TOKENS = 60;

const WORDS_TO_TOKENS_RATIO = 1.3;

/**
 * Hard character ceilings (audit SEC-04 / DATA). Token estimation is
 * word-based, so whitespace-free text (minified JS in a <pre>, a base64
 * blob, a URL-stuffed line) of any length counted as ~1-2 "tokens" and could
 * become a single unbounded chunk. These caps bound every chunk regardless of
 * how the text is shaped. They only bite on pathological content: normal
 * prose hits TARGET_MAX_TOKENS (~2.5k chars) first, so the "never split
 * mid-sentence" rule still holds for ordinary text.
 */
export const MAX_UNIT_CHARS = 3_000;
export const MAX_OVERLAP_CHARS = 600;

export function estimateTokens(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.ceil(words * WORDS_TO_TOKENS_RATIO);
}

/** Splits text into sentences without ever cutting a sentence in half.
 * Simple, dependency-free heuristic: split on sentence-ending punctuation
 * followed by whitespace + a capital letter/quote/digit, but keep the
 * punctuation attached to the preceding sentence. */
export function splitSentences(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const parts = trimmed.match(/[^.!?]+[.!?]+(?=\s+|$)|[^.!?]+$/g);
  if (!parts) return [trimmed];
  return parts.map((s) => s.trim()).filter(Boolean);
}

interface Unit {
  text: string;
  /** heading path active at this unit, for citation anchors */
  headingPath: string[];
}

/** Splits a single over-long unit (a >500-token "sentence" with no
 * punctuation, or whitespace-free text) into word groups that respect both
 * TARGET_MAX_TOKENS and MAX_UNIT_CHARS; a single word longer than
 * MAX_UNIT_CHARS is hard-sliced. */
export function splitOversizedText(text: string): string[] {
  if (estimateTokens(text) <= TARGET_MAX_TOKENS && text.length <= MAX_UNIT_CHARS) return [text];
  const words = text.split(/\s+/).filter(Boolean).flatMap((w) => {
    if (w.length <= MAX_UNIT_CHARS) return [w];
    const pieces: string[] = [];
    for (let i = 0; i < w.length; i += MAX_UNIT_CHARS) pieces.push(w.slice(i, i + MAX_UNIT_CHARS));
    return pieces;
  });
  const out: string[] = [];
  let buf: string[] = [];
  let bufChars = 0;
  for (const word of words) {
    const nextChars = bufChars + (buf.length ? 1 : 0) + word.length;
    if (buf.length && (nextChars > MAX_UNIT_CHARS || Math.ceil((buf.length + 1) * WORDS_TO_TOKENS_RATIO) > TARGET_MAX_TOKENS)) {
      out.push(buf.join(' '));
      buf = [];
      bufChars = 0;
    }
    bufChars += (buf.length ? 1 : 0) + word.length;
    buf.push(word);
  }
  if (buf.length) out.push(buf.join(' '));
  return out;
}

function blocksToUnits(blocks: DocumentBlock[]): Unit[] {
  const units: Unit[] = [];
  const headingStack: string[] = [];

  for (const block of blocks) {
    if (block.type === 'heading') {
      const level = Math.min(6, Math.max(1, block.level ?? 1));
      headingStack.splice(level - 1);
      headingStack[level - 1] = block.text.slice(0, 300);
      // Heading text itself becomes a small unit so it can anchor/prefix chunks.
      units.push({ text: block.text, headingPath: [...headingStack] });
      continue;
    }
    const cleaned = cleanText(block.text);
    if (!cleaned) continue;
    if (estimateTokens(cleaned) <= TARGET_MAX_TOKENS && cleaned.length <= MAX_UNIT_CHARS) {
      units.push({ text: cleaned, headingPath: [...headingStack] });
    } else {
      // Oversized paragraph: split into sentence groups that each respect the max.
      const sentences = splitSentences(cleaned);
      let buf = '';
      const pushUnit = (text: string) => {
        for (const piece of splitOversizedText(text)) units.push({ text: piece, headingPath: [...headingStack] });
      };
      for (const sentence of sentences) {
        const candidate = buf ? `${buf} ${sentence}` : sentence;
        if ((estimateTokens(candidate) > TARGET_MAX_TOKENS || candidate.length > MAX_UNIT_CHARS) && buf) {
          pushUnit(buf);
          buf = sentence;
        } else {
          buf = candidate;
        }
      }
      if (buf) pushUnit(buf);
    }
  }
  return units;
}

function takeOverlapSuffix(text: string, maxTokens: number): string {
  const sentences = splitSentences(text);
  let buf = '';
  for (let i = sentences.length - 1; i >= 0; i -= 1) {
    const candidate = buf ? `${sentences[i]} ${buf}` : sentences[i];
    if (estimateTokens(candidate) > maxTokens || candidate.length > MAX_OVERLAP_CHARS) break;
    buf = candidate;
  }
  return buf;
}

export function chunkDocument(doc: StructuredDocument): Chunk[] {
  const blocks: DocumentBlock[] =
    doc.blocks && doc.blocks.length > 0 ? doc.blocks : [{ type: 'paragraph', text: doc.text }];
  const units = blocksToUnits(blocks);

  const chunks: Chunk[] = [];
  let bufferParts: string[] = [];
  let bufferTokens = 0;
  let bufferChars = 0;
  let lastHeadingPath: string[] = [];
  let position = 0;

  const flush = (overlapPrefix?: string) => {
    if (bufferParts.length === 0) return;
    const text = bufferParts.join('\n\n');
    const finalText = overlapPrefix ? `${overlapPrefix}\n\n${text}` : text;
    chunks.push({
      id: '',
      documentId: doc.id,
      sourceId: doc.sourceId,
      text: finalText,
      position: position++,
      sourceAnchor: {
        url: doc.metadata.url,
        headingPath: lastHeadingPath.length ? lastHeadingPath : undefined,
      },
    });
  };

  let pendingOverlap = '';

  for (const unit of units) {
    const unitTokens = estimateTokens(unit.text);
    const wouldBeTokens = bufferTokens + unitTokens;
    const wouldBeChars = bufferChars + unit.text.length;

    if (bufferParts.length > 0 && (wouldBeTokens > TARGET_MAX_TOKENS || wouldBeChars > MAX_UNIT_CHARS)) {
      flush(pendingOverlap || undefined);
      const joined = bufferParts.join('\n\n');
      pendingOverlap = takeOverlapSuffix(joined, OVERLAP_TOKENS);
      bufferParts = [];
      bufferTokens = estimateTokens(pendingOverlap);
      bufferChars = pendingOverlap.length;
    }

    bufferParts.push(unit.text);
    bufferTokens += unitTokens;
    bufferChars += unit.text.length;
    lastHeadingPath = unit.headingPath;

    if (bufferTokens >= TARGET_MIN_TOKENS && bufferTokens <= TARGET_MAX_TOKENS) {
      // Good size — but keep accumulating only if next unit would overflow;
      // simplest correct approach: flush now once we're within target range
      // and the buffer represents at least one full paragraph.
      flush(pendingOverlap || undefined);
      const joined = bufferParts.join('\n\n');
      pendingOverlap = takeOverlapSuffix(joined, OVERLAP_TOKENS);
      bufferParts = [];
      bufferTokens = 0;
      bufferChars = 0;
    }
  }

  if (bufferParts.length > 0) {
    flush(pendingOverlap || undefined);
  }

  return chunks;
}
