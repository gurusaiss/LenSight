import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import {
  collectRecentMessages,
  extractDateMentions,
  extractLinksFromMessages,
  parseMessagesFromContainer,
  toConversationTimelineDocument,
  whatsappAdapter,
  type WhatsAppMessage,
} from '../../src/core/adapters/whatsappAdapter';
import { chunkDocument } from '../../src/core/processing/chunk';

const FIXTURE_PATH = path.join(__dirname, '../fixtures/whatsapp-fixture.html');
const FIXTURE_HTML = fs.readFileSync(FIXTURE_PATH, 'utf-8');

function loadFixture() {
  return new JSDOM(FIXTURE_HTML, { url: 'https://web.whatsapp.com/' });
}

describe('whatsappAdapter (EXPERIMENTAL — against a hand-built fixture, not real WhatsApp Web)', () => {
  it('detect() is true only on web.whatsapp.com', () => {
    const dom = loadFixture();
    expect(whatsappAdapter.detect(dom.window.document as unknown as Document)).toBe(true);

    const other = new JSDOM('<html><body></body></html>', { url: 'https://example.com/' });
    expect(whatsappAdapter.detect(other.window.document as unknown as Document)).toBe(false);
  });

  it('reports capability level 2 and low confidence, per the research doc', () => {
    expect(whatsappAdapter.getCapabilityLevel()).toBe(2);
    expect(whatsappAdapter.getConfidence()).toBe('low');
  });

  it('extractCurrentPage() extracts sender, text, timestamp, and marks media placeholders', () => {
    const dom = loadFixture();
    const doc = whatsappAdapter.extractCurrentPage(dom.window.document as unknown as Document);

    expect(doc).not.toBeNull();
    expect(doc!.title).toContain('Alice Example');
    expect(doc!.text).toContain('Hey, are we still on for tomorrow?');
    expect(doc!.text).toContain('Alice Example (10:01, 1/5/2024)');
    expect(doc!.text).toContain('You (10:02, 1/5/2024)');
    // The media-only message has no text body and must be marked, not skipped silently.
    expect(doc!.text).toContain('[media message');
  });

  it('parseMessagesFromContainer parses direction, sender, timestamp, and media type from the fixture DOM', () => {
    const dom = loadFixture();
    const container = dom.window.document.querySelector('[data-testid="conversation-panel-messages"]')!;
    const messages = parseMessagesFromContainer(container);

    expect(messages).toHaveLength(4);
    expect(messages[0]).toMatchObject({
      sender: 'Alice Example',
      timestamp: '10:01, 1/5/2024',
      direction: 'in',
      type: 'text',
    });
    expect(messages[1]).toMatchObject({ direction: 'out', type: 'text' });
    expect(messages[2].type).toBe('media');
    expect(messages[3].text).toContain('Jan 6th');
  });

  it('getMetadata reads the contact name from the conversation header', () => {
    const dom = loadFixture();
    const meta = whatsappAdapter.getMetadata(dom.window.document as unknown as Document);
    expect(meta.title).toBe('Alice Example');
    expect(meta.participants).toEqual(['Alice Example']);
  });

  it('extractLinksFromMessages finds URLs mentioned in message text', () => {
    const dom = loadFixture();
    const container = dom.window.document.querySelector('[data-testid="conversation-panel-messages"]')!;
    const messages = parseMessagesFromContainer(container);
    const links = extractLinksFromMessages(messages);
    expect(links).toContain('https://maps.example.com/place');
  });

  it('extractDateMentions finds relative and named-month date mentions', () => {
    const dom = loadFixture();
    const container = dom.window.document.querySelector('[data-testid="conversation-panel-messages"]')!;
    const messages = parseMessagesFromContainer(container);
    const mentions = extractDateMentions(messages);
    const raws = mentions.map((m) => m.raw.toLowerCase());
    expect(raws.some((r) => r.includes('tomorrow'))).toBe(true);
    expect(raws.some((r) => r.includes('jan'))).toBe(true);
  });

  it('toConversationTimelineDocument + chunkDocument produces ordered chunks with sender/timestamp preserved', () => {
    const dom = loadFixture();
    const container = dom.window.document.querySelector('[data-testid="conversation-panel-messages"]')!;
    const messages = parseMessagesFromContainer(container);
    const meta = whatsappAdapter.getMetadata(dom.window.document as unknown as Document);

    const timelineDoc = toConversationTimelineDocument(messages, meta);
    const chunks = chunkDocument({ ...timelineDoc, id: 'doc_1', sourceId: 'src_1' });

    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0].text).toContain('Alice Example');
    expect(chunks[0].position).toBe(0);
  });
});

describe('collectRecentMessages — de-duplication over simulated incremental DOM mutations', () => {
  function buildRow(doc: Document, id: string, sender: string, time: string, text: string) {
    const row = doc.createElement('div');
    row.className = 'message-in';
    row.setAttribute('data-id', id);
    const copyable = doc.createElement('div');
    copyable.className = 'copyable-text';
    copyable.setAttribute('data-pre-plain-text', `[${time}] ${sender}: `);
    const body = doc.createElement('span');
    body.className = 'selectable-text';
    body.textContent = text;
    copyable.appendChild(body);
    row.appendChild(copyable);
    return row;
  }

  it('collects newly appeared rows across simulated scroll iterations without duplicating existing ids', async () => {
    const dom = new JSDOM('<div id="container"></div>');
    const doc = dom.window.document;
    const container = doc.getElementById('container')!;

    // Start with 2 "already loaded" rows (as if scrolled to the bottom).
    container.appendChild(buildRow(doc, 'm3', 'Bob', '09:03', 'third message'));
    container.appendChild(buildRow(doc, 'm4', 'Bob', '09:04', 'fourth message'));

    let scrollCalls = 0;
    // Each "scroll up" simulates WhatsApp's virtualization loading two more
    // older rows, prepended, up to a point where nothing new loads.
    const onScroll = () => {
      scrollCalls += 1;
      if (scrollCalls === 1) {
        container.insertBefore(buildRow(doc, 'm1', 'Bob', '09:01', 'first message'), container.firstChild);
        container.insertBefore(buildRow(doc, 'm2', 'Bob', '09:02', 'second message'), container.firstChild?.nextSibling ?? null);
      }
      // scrollCalls === 2 onward: no more rows load (reached the top).
    };

    const messages = await collectRecentMessages(container, 10, { onScroll, waitTick: () => Promise.resolve(), maxIterations: 10 });

    const ids = messages.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length); // no duplicates
    expect(ids).toEqual(expect.arrayContaining(['m1', 'm2', 'm3', 'm4']));
    expect(messages).toHaveLength(4);
  });

  it('stops early once maxMessages is reached, without over-collecting', async () => {
    const dom = new JSDOM('<div id="container"></div>');
    const doc = dom.window.document;
    const container = doc.getElementById('container')!;
    container.appendChild(buildRow(doc, 'a1', 'Bob', '09:01', 'one'));
    container.appendChild(buildRow(doc, 'a2', 'Bob', '09:02', 'two'));
    container.appendChild(buildRow(doc, 'a3', 'Bob', '09:03', 'three'));

    const messages: WhatsAppMessage[] = await collectRecentMessages(container, 2, {
      onScroll: () => {},
      waitTick: () => Promise.resolve(),
    });

    expect(messages).toHaveLength(2);
  });

  it('terminates (does not loop forever) when no new rows ever appear', async () => {
    const dom = new JSDOM('<div id="container"></div>');
    const doc = dom.window.document;
    const container = doc.getElementById('container')!;
    container.appendChild(buildRow(doc, 'z1', 'Bob', '09:01', 'only message'));

    const messages = await collectRecentMessages(container, 50, {
      onScroll: () => {},
      waitTick: () => Promise.resolve(),
      maxIterations: 25,
    });

    expect(messages).toHaveLength(1);
  });
});
