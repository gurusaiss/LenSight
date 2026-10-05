import type { SourceAdapter } from './SourceAdapter';
import type { DocumentBlock, SourceMetadata, StructuredDocument } from '../types';

/**
 * EXPERIMENTAL — WhatsApp Web adapter (Level 2 per the research doc's
 * Platform Capability Matrix: fragile, DOM-based, user-triggered only, never
 * background/continuous).
 *
 * This adapter was written against reasonably-current, publicly documented
 * WhatsApp Web DOM conventions (row-based message list, `[data-id]` on each
 * message row, `.copyable-text` holding a `data-pre-plain-text` attribute of
 * the form `[H:MM, D/M/YYYY] Sender: `, `.message-in` / `.message-out` for
 * direction, `.selectable-text` for the message body). **WhatsApp Web's real
 * markup is not open source, is minified/obfuscated in production, and
 * changes without notice — every selector below is a best-effort guess that
 * will likely need maintenance.** This adapter could not be exercised
 * against a real, live web.whatsapp.com session in this environment; it is
 * proven only against the fixture at `tests/fixtures/whatsapp-fixture.html`
 * (see `tests/unit/whatsappAdapter.test.ts`). Do not present this as more
 * than "Experimental" — see docs/LIMITATIONS.md.
 */

export interface WhatsAppMessage {
  /** WhatsApp's own `data-id` for the message row — used to de-duplicate
   * across incremental/virtualized scroll loads. */
  id: string;
  sender?: string;
  /** Raw timestamp string as WhatsApp renders it (e.g. "10:01, 1/1/2024") —
   * intentionally not parsed into a Date here, since its format is locale
   * dependent and best left as a citation-friendly display string. */
  timestamp?: string;
  text: string;
  direction: 'in' | 'out' | 'unknown';
  type: 'text' | 'media';
}

// Best-effort, documented-pattern selectors — see file header. Kept as named
// constants so a future maintainer only has to update this one spot.
const MESSAGE_ROW_SELECTOR = '[data-id]';
const COPYABLE_TEXT_SELECTOR = '.copyable-text[data-pre-plain-text]';
const MESSAGE_BODY_SELECTOR = '.selectable-text';
const MEDIA_SELECTOR = '[data-testid="media-image"], [data-testid="media-video"], [data-testid="media-play"], .media-message';
const CONVERSATION_CONTAINER_SELECTOR = '[data-testid="conversation-panel-messages"], .copyable-area';
const CONTACT_NAME_SELECTOR = '[data-testid="conversation-info-header"] span[title], header span[title]';

// Matches `[10:01, 1/1/2024] Alice: ` -> group1 = "10:01, 1/1/2024", group2 = "Alice"
const PRE_PLAIN_TEXT_RE = /^\[(.+?)\]\s*(.*?):\s*$/;

function parseMessageRow(row: Element): WhatsAppMessage | null {
  const id = row.getAttribute('data-id');
  if (!id) return null;

  const direction: WhatsAppMessage['direction'] = row.classList.contains('message-in')
    ? 'in'
    : row.classList.contains('message-out')
      ? 'out'
      : 'unknown';

  const mediaEl = row.querySelector(MEDIA_SELECTOR);
  const copyableEl = row.querySelector(COPYABLE_TEXT_SELECTOR);

  let sender: string | undefined;
  let timestamp: string | undefined;
  if (copyableEl) {
    const pre = copyableEl.getAttribute('data-pre-plain-text') || '';
    const match = PRE_PLAIN_TEXT_RE.exec(pre.trim());
    if (match) {
      timestamp = match[1];
      sender = match[2] || undefined;
    }
  }

  if (!copyableEl && mediaEl) {
    // Media-only message row (image/video/voice note) with no text body.
    return { id, sender, timestamp, text: '[media message]', direction, type: 'media' };
  }

  const bodyEl = row.querySelector(MESSAGE_BODY_SELECTOR);
  const text = (bodyEl?.textContent || copyableEl?.textContent || '').replace(/\s+/g, ' ').trim();
  if (!text && !mediaEl) return null;

  if (mediaEl && !text) {
    return { id, sender, timestamp, text: '[media message]', direction, type: 'media' };
  }

  return { id, sender, timestamp, text, direction, type: 'text' };
}

/** Parses every currently-rendered message row inside `container`, in DOM order. */
export function parseMessagesFromContainer(container: Element): WhatsAppMessage[] {
  const rows = Array.from(container.querySelectorAll(MESSAGE_ROW_SELECTOR));
  const messages: WhatsAppMessage[] = [];
  for (const row of rows) {
    const parsed = parseMessageRow(row);
    if (parsed) messages.push(parsed);
  }
  return messages;
}

function messagesToBlocks(messages: WhatsAppMessage[], conversationTitle: string): DocumentBlock[] {
  const blocks: DocumentBlock[] = [{ type: 'heading', level: 1, text: `WhatsApp conversation: ${conversationTitle}` }];
  for (const m of messages) {
    const who = m.sender ?? (m.direction === 'out' ? 'You' : m.direction === 'in' ? 'Them' : 'Unknown');
    const when = m.timestamp ? ` (${m.timestamp})` : '';
    const body = m.type === 'media' ? '[media message — not extracted, no OCR in this phase]' : m.text;
    blocks.push({ type: 'paragraph', text: `${who}${when}: ${body}` });
  }
  return blocks;
}

export const whatsappAdapter: SourceAdapter = {
  sourceType: 'whatsapp',

  detect(doc: Document): boolean {
    return typeof doc !== 'undefined' && doc.location?.hostname === 'web.whatsapp.com';
  },

  getCapabilityLevel() {
    return 2;
  },

  getConfidence() {
    // DOM-obfuscated, user-triggered only, no structural guarantees from
    // WhatsApp itself — never "high" per the research doc's L2 guidance.
    return 'low';
  },

  getMetadata(doc: Document): SourceMetadata {
    const contactName = doc.querySelector(CONTACT_NAME_SELECTOR)?.getAttribute('title') || doc.title || 'WhatsApp conversation';
    return {
      url: doc.location?.href || 'https://web.whatsapp.com/',
      title: contactName,
      timestamps: { capturedAt: Date.now() },
      participants: contactName ? [contactName] : undefined,
    };
  },

  extractCurrentPage(doc: Document): StructuredDocument | null {
    const container = doc.querySelector(CONVERSATION_CONTAINER_SELECTOR);
    if (!container) return null;
    const messages = parseMessagesFromContainer(container);
    if (messages.length === 0) return null;

    const metadata = this.getMetadata(doc);
    const blocks = messagesToBlocks(messages, metadata.title);
    return {
      id: '',
      sourceId: '',
      title: `WhatsApp: ${metadata.title}`,
      text: blocks.map((b) => b.text).join('\n\n'),
      blocks,
      metadata,
      links: extractLinksFromMessages(messages),
    };
  },

  extractSelection(selection: Selection | null): StructuredDocument | null {
    // No WhatsApp-specific selection handling — falls back to the same
    // universal plain-text capture the generic selectionAdapter provides.
    if (!selection || selection.isCollapsed) return null;
    const text = selection.toString().trim();
    if (!text) return null;
    const url = typeof window !== 'undefined' ? window.location.href : 'https://web.whatsapp.com/';
    return {
      id: '',
      sourceId: '',
      title: 'WhatsApp selection',
      text,
      blocks: [{ type: 'paragraph', text }],
      metadata: { url, title: 'WhatsApp selection', timestamps: { capturedAt: Date.now() } },
    };
  },
};

/**
 * Incrementally scrolls `container` upward (toward older messages) and
 * collects newly-appeared message rows, de-duplicating by `data-id` — this
 * addresses the research doc's virtualization problem (WhatsApp Web only
 * keeps a window of message rows mounted in the DOM at once, so a single
 * synchronous read only sees whatever is currently rendered).
 *
 * The actual "scroll" and "wait for the DOM to settle" steps are injected as
 * callbacks (`onScroll` / `waitTick`) rather than hardcoded, specifically so
 * this can be unit tested against simulated DOM mutations in jsdom (no real
 * scrolling/virtualization physics available there) while still using real
 * `container.scrollTop` manipulation in the actual content script.
 */
export async function collectRecentMessages(
  container: Element,
  maxMessages: number,
  options: {
    maxIterations?: number;
    onScroll?: (container: Element) => void | Promise<void>;
    waitTick?: () => Promise<void>;
  } = {},
): Promise<WhatsAppMessage[]> {
  const maxIterations = options.maxIterations ?? 25;
  const onScroll = options.onScroll ?? ((el: Element) => { (el as any).scrollTop = 0; });
  const waitTick = options.waitTick ?? (() => Promise.resolve());

  const collected = new Map<string, WhatsAppMessage>();
  let previousSize = -1;

  for (let i = 0; i < maxIterations; i += 1) {
    const current = parseMessagesFromContainer(container);
    for (const msg of current) {
      // A later parse of the same data-id can carry more complete info (e.g.
      // WhatsApp lazily fills in data-pre-plain-text) — later write wins,
      // but we don't reorder: the Map preserves first-seen key order.
      collected.set(msg.id, msg);
    }

    if (collected.size >= maxMessages) break;
    if (collected.size === previousSize) break; // no growth: reached the top / nothing new loads
    previousSize = collected.size;

    await onScroll(container);
    await waitTick();
  }

  return Array.from(collected.values()).slice(0, maxMessages);
}

// --- Conversation-intelligence quick actions (built on existing chunk/RAG
// pipeline — no new AI plumbing) ---

const URL_RE = /https?:\/\/[^\s<>()"']+/g;

/** Extracts every URL mentioned across a set of messages (regex over text). */
export function extractLinksFromMessages(messages: WhatsAppMessage[]): string[] {
  const found = new Set<string>();
  for (const m of messages) {
    const matches = m.text.match(URL_RE);
    matches?.forEach((u) => found.add(u.replace(/[.,)]+$/, '')));
  }
  return Array.from(found);
}

// A reasonably robust (not exhaustive) date-mention heuristic: ISO dates,
// D/M/Y or M/D/Y numeric dates, "Month D[, Y]" names, and common relative
// day words. Good enough for a "what dates were mentioned" quick action —
// not a full NLP date parser.
const DATE_RE = new RegExp(
  [
    '\\b\\d{4}-\\d{2}-\\d{2}\\b', // 2024-01-05
    '\\b\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4}\\b', // 1/5/2024, 01-05-24
    '\\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?\\b',
    '\\b(?:today|tomorrow|tonight|yesterday|next\\s+week|this\\s+weekend|next\\s+(?:mon|tues|wednes|thurs|fri|satur|sun)day)\\b',
  ].join('|'),
  'gi',
);

export interface DateMention {
  messageId: string;
  raw: string;
  context: string;
}

/** Extracts date-like mentions from messages, with the message they came from for context. */
export function extractDateMentions(messages: WhatsAppMessage[]): DateMention[] {
  const mentions: DateMention[] = [];
  for (const m of messages) {
    const matches = m.text.match(DATE_RE);
    matches?.forEach((raw) => mentions.push({ messageId: m.id, raw, context: m.text }));
  }
  return mentions;
}

/**
 * Turns extracted messages into a StructuredDocument ordered as a timeline
 * (sender + timestamp preserved per message as block text), reusing the
 * existing block schema so the normal `chunkDocument()` pipeline
 * (`src/core/processing/chunk.ts`) — not reimplemented here — does the
 * actual chunking, exactly as it does for every other adapter.
 */
export function toConversationTimelineDocument(
  messages: WhatsAppMessage[],
  metadata: SourceMetadata,
): StructuredDocument {
  const blocks = messagesToBlocks(messages, metadata.title);
  return {
    id: '',
    sourceId: '',
    title: `WhatsApp: ${metadata.title}`,
    text: blocks.map((b) => b.text).join('\n\n'),
    blocks,
    metadata,
    links: extractLinksFromMessages(messages),
  };
}
