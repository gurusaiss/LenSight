import { genericWebAdapter } from '../src/core/adapters/genericWebAdapter';
import { selectionAdapter } from '../src/core/adapters/selectionAdapter';
import { whatsappAdapter } from '../src/core/adapters/whatsappAdapter';
import type { SourceAdapter } from '../src/core/adapters/SourceAdapter';
import { AdapterUnavailableError, ExtractionFailedError, userMessageFor } from '../src/core/errors';
import { ensureCitationHighlightStyle, highlightCitationInDocument } from '../src/core/citation/anchorResolver';

/**
 * Content script: registers the available SourceAdapters for the current
 * page and answers extraction/highlight requests from the side panel.
 *
 * Least privilege (audit CMP-01/CMP-02): this script is NOT declared in the
 * manifest for every site. `registration: 'runtime'` keeps it out of
 * `content_scripts`; the side panel injects it on demand into the one tab
 * the user is acting on via `chrome.scripting.executeScript` under the
 * `activeTab` grant (see src/core/messaging/contentScript.ts). With no
 * `matches`, WXT adds no host permission for it either.
 *
 * genericWebAdapter (L1) and selectionAdapter (L3) are the well-tested MVP
 * adapters. whatsappAdapter (L2) is wired in as EXPERIMENTAL — it only
 * activates on web.whatsapp.com (`detect()`), was proven only against a
 * hand-built fixture (not real WhatsApp Web), and is documented as such in
 * docs/LIMITATIONS.md.
 */

const PAGE_ADAPTERS: SourceAdapter[] = [whatsappAdapter, genericWebAdapter];

function pickAdapter(mode: 'page' | 'selection'): SourceAdapter {
  if (mode === 'selection') return selectionAdapter;
  // whatsappAdapter.detect() is host-scoped (web.whatsapp.com only);
  // genericWebAdapter.detect() always returns true — the universal
  // fallback for whole-page extraction on every other site.
  return PAGE_ADAPTERS.find((a) => a.detect(document)) ?? genericWebAdapter;
}

function adapterUsedName(adapter: SourceAdapter): string {
  if (adapter.sourceType === 'selection') return 'selectionAdapter';
  if (adapter.sourceType === 'whatsapp') return 'whatsappAdapter';
  return 'genericWebAdapter';
}

export default defineContentScript({
  registration: 'runtime',
  main(ctx) {
    if (typeof chrome === 'undefined' || !chrome.runtime?.onMessage) return;

    // On-demand injection can run this file more than once in a document
    // (a retry, or after the extension was reloaded/updated). WXT's context
    // tells older copies to stand down when a newer one starts
    // (ctx.onInvalidated), so each copy removes its own listener then —
    // exactly one live listener remains, and an orphaned copy from a previous
    // extension version can never shadow the new one.
    const listener = (message: any, sender: chrome.runtime.MessageSender, sendResponse: (r: unknown) => void) => {
      if (!message || typeof message !== 'object') return false;
      // Only the extension itself may drive this script.
      if (sender.id !== chrome.runtime.id) return false;

      // Real citation click-through (DOM sources): scroll to and briefly
      // highlight the element whose text matches the citation's snippet.
      if (message.type === 'HIGHLIGHT_CITATION') {
        ensureCitationHighlightStyle(document);
        const found = highlightCitationInDocument(document, String(message.snippet ?? '').slice(0, 1_000));
        sendResponse({ ok: true, found });
        return false;
      }

      if (message.type !== 'REQUEST_EXTRACT') {
        return false;
      }

      const mode: 'page' | 'selection' = message.mode === 'selection' ? 'selection' : 'page';
      const adapter = pickAdapter(mode);

      try {
        const doc =
          mode === 'selection'
            ? adapter.extractSelection(window.getSelection())
            : adapter.extractCurrentPage(document);

        if (!doc) {
          // Distinguish "a site-specific adapter's selectors didn't match"
          // from "there is simply no text selected" / "the page has no
          // readable content" — each needs a different, actionable message.
          if (mode === 'selection') {
            throw new ExtractionFailedError('no text is currently selected on the page');
          }
          if (adapter.sourceType === 'whatsapp') {
            throw new AdapterUnavailableError('WhatsApp Web');
          }
          throw new ExtractionFailedError('the page has no readable text content');
        }

        sendResponse({
          ok: true,
          document: doc,
          capabilityLevel: adapter.getCapabilityLevel(),
          confidence: adapter.getConfidence(),
          adapterUsed: adapterUsedName(adapter),
        });
      } catch (err) {
        sendResponse({ ok: false, error: userMessageFor(err, 'Extraction') });
      }
      return false; // response already sent synchronously
    };
    chrome.runtime.onMessage.addListener(listener);
    ctx.onInvalidated(() => chrome.runtime.onMessage.removeListener(listener));
  },
});
