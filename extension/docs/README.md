# Lensight (MVP)

_Lensight — a local-first AI context assistant._

A local-first browser extension (Manifest V3, WXT + React + TypeScript + Tailwind)
that lets you ask questions about the page you're currently looking at.
Extraction, chunking, embedding, and vector search happen entirely on-device
(IndexedDB); only the retrieved chunks and your question are ever sent to an
AI provider, and only if you configure one.

This is the MVP described in `universal-ai-context-assistant-research.md`
(the architecture spec this codebase implements). See `docs/LIMITATIONS.md`
for an explicit matrix of what is implemented vs. planned.

## What actually works right now

- **Generic web page extraction** (Level 1): strips nav/header/footer/ads,
  keeps headings/paragraphs/lists in document order.
- **Selection-based capture** (Level 3): universal fallback via
  `window.getSelection()`.
- **WhatsApp Web** (Level 2, **Experimental**): sender/text/timestamp
  extraction plus media-placeholder detection, a virtualization-aware
  scroll-and-collect helper, and link/date/timeline quick actions — see
  LIMITATIONS.md for why this is labeled Experimental, not Implemented.
- **PDF import** (Level 5): real `pdfjs-dist` parsing of a locally-imported
  PDF (or, best-effort, a PDF URL open in the tab) — per-page text,
  title/author metadata, and link annotations. Text-based PDFs only; no OCR.
- **Local file import** (Level 5): `.txt`, `.md`, `.csv`, `.json` (and
  `.pdf`, via the PDF adapter). `.docx` is explicitly Planned, not faked.
- **Multi-tab / research sessions**: group several captured sources into a
  named session and ask questions retrieved across all of them at once.
- **Settings page** (`entrypoints/options/`): pick your privacy mode and AI
  provider, and configure a real API key (masked, stored only in
  `chrome.storage.local`, never shown again in plaintext).
- **Local processing pipeline**: cleaning/normalization → paragraph/heading
  aware chunking (~300-500 tokens, overlap, never mid-sentence) → embedding
  → IndexedDB storage → cosine-similarity retrieval.
- **Zero-setup default**: a deterministic, offline "hashing" embedding
  provider and an "extractive local" answer provider mean the whole pipeline
  works with no network access and no API key.
- **Two remote AI providers** you can configure with your own key: Google
  Gemini, and any OpenAI-compatible endpoint (OpenAI, OpenRouter, Groq, or a
  local Ollama server).
- **Prompt-injection defense**: a strict system/user/untrusted-context
  template (`src/core/security/promptTemplate.ts`) with unit tests proving
  injected text inside retrieved content cannot alter the real instructions.

## NOT implemented (see LIMITATIONS.md for the full matrix)

Gmail, Google Docs, LinkedIn, YouTube transcripts, `.docx` import,
scanned/OCR PDFs, fully-local (Mode A) neural embeddings/generation by
default, and the desktop companion are all **explicitly out of scope for
this pass** — they are later phases in the research doc, not
partially-faked features here.

## Quickstart

```bash
npm install
npm run dev      # wxt dev server — loads unpacked in Chrome for live development
npm run build    # wxt build — production build to .output/chrome-mv3
npm run test     # vitest unit tests
npm run test:e2e # playwright e2e (see docs/SETUP.md for a caveat in sandboxed environments)
```

See `docs/SETUP.md` for loading the unpacked extension in Chrome and
configuring a remote AI provider.

## Privacy modes

See `docs/PRIVACY.md`. In short: Mode B (local data, remote AI) is the
shipped default behavior once you configure a provider; with no provider
configured, everything — including "generation" — stays on-device via the
Basic Local Mode extractive provider, i.e. Mode A-equivalent for the
included pipeline (a full Mode A with neural local generation is a later
phase; see LIMITATIONS.md).

## Documentation index

- `docs/ARCHITECTURE.md` — pipeline diagram, interfaces
- `docs/PRIVACY.md` — modes, what leaves the device and when
- `docs/PRIVACY_POLICY.md` — user-facing privacy policy (fill placeholders, then host it for the store listing)
- `docs/STORE_SUBMISSION.md` — what is done and what remains before Chrome Web Store submission
- `docs/SECURITY.md` — threat table, prompt injection defense
- `docs/SETUP.md` — install, build, load unpacked, configure a provider
- `docs/LIMITATIONS.md` — Implemented / Partial / Not supported / Planned matrix
