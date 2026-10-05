# Lensight — Investor Pitch (Pre-Seed)

_Draft as of 2026-10-05. Pre-launch. Every product claim below is backed by the project's own documentation: [`info.md`](info.md), [`fixed.md`](fixed.md), [`LIMITATIONS.md`](LIMITATIONS.md) and the 2026-09-24 audit report. Items in `[brackets]` are placeholders for the founder to fill in._

---

## One line

**Lensight is the private AI layer for your browser: ask questions about whatever you're looking at, with your content indexed on your own device and sent to no one unless you choose to.**

## The problem

1. **Copy-paste is the real AI workflow today.** Someone reading a long thread, a dense spec, a research paper or a job posting usually selects the text, opens a chatbot tab, pastes, and asks. It is slow. It loses context such as headings, timestamps and who said what. It has to be repeated for every new page.
2. **Every mainstream AI browser assistant is cloud-first.** ChatGPT's browsing features, Perplexity's Comet browser, Copilot in Edge and Arc all send page content to a cloud model. Gemini in Chrome does some narrow tasks on-device, but it is closed, Chrome-only and not user-configurable. None of them lets the user say "index this locally, and send nothing anywhere."
3. **The content people most want to ask about is the most private.** Messages, work documents and internal dashboards are exactly what users should hesitate to paste into a consumer chatbot. Today they choose between convenience and privacy.

## The solution

Lensight is a Chrome (Manifest V3) extension with a side-panel assistant.

- **Capture what you are viewing:** a web page, a text selection, an imported PDF, or a `.txt`, `.md`, `.csv` or `.json` file.
- **Index it on the device:** cleaning, chunking, embeddings and vector search all run locally in the browser's IndexedDB.
- **Ask a question and get a cited answer.** Every answer links back to the excerpts it used, and the user can click through to the source.
- **Choose where the answer comes from:**
  - **Mode A, fully local:** nothing leaves the device. It works out of the box with zero setup (local excerpt ranking), and can be upgraded with on-device neural embeddings or a local LLM through Ollama.
  - **Mode B, local data with remote AI:** only the few retrieved excerpts and the question go to a provider the user picked (Gemini, OpenAI, OpenRouter, Groq or any OpenAI-compatible endpoint), using the user's own key. Never the full page, never other tabs, never history.
- **Group sources into research sessions** and ask across all of them at once.
- **Stay in control:** a "Context in use" panel shows exactly what is indexed. Users can remove individual excerpts, delete sessions or delete everything, and can export or import their data.

**What's built vs. what's roadmap**

| Built and tested | Experimental | Roadmap |
|---|---|---|
| Web page and selection capture; PDF and file import; local RAG pipeline with citations; research sessions; Modes A and B; Gemini, OpenAI-compatible and Ollama providers; prompt-injection defense; command palette, onboarding, diagnostics, dark mode; desktop companion core library | WhatsApp Web capture (fixture-tested only); desktop companion GUI | Gmail, Google Docs, LinkedIn and YouTube adapters; `.docx`; OCR; extension ↔ desktop companion integration; Free/Pro/Team tiers |

## Why now

- **AI browser assistants are going mainstream.** Copilot ships in Edge, Gemini ships in Chrome, Perplexity built a whole browser (Comet). Users are learning to expect "ask about this page."
- **Every one of them is tied to a vendor's cloud, and most to a vendor's browser.** None is local-first, privacy-first and provider-agnostic at the same time. That is an open gap, not an incremental one.
- **Local AI has become practical.** On-device embeddings run in the browser through WebAssembly (Transformers.js), and local LLM runtimes such as Ollama let users run capable models on their own machine. Lensight is designed to use both today, and to improve as local models improve, without needing its own model.
- **Privacy expectations are rising.** Manifest V3 and store policies push extensions toward least privilege. Lensight was built that way from the first line: it requests `activeTab`, not access to every site; it runs no remote code; it collects no telemetry.

## Product demo narrative

The MVP success flow, as it runs today:

1. **Open any article.** Click the Lensight toolbar icon, which opens the side panel and grants one-time access to that tab only.
2. **Click "Capture this page."** The page is cleaned (navigation, ads and hidden text removed), split into chunks and indexed on the device. A capability badge shows how well Lensight can read this kind of source.
3. **Ask:** "What are the application requirements?"
4. **Retrieval runs locally.** Lensight finds the most relevant excerpts from this page only.
5. **Get an answer with citations.** Click a citation to jump to the original passage.
6. **Check the privacy indicator.** In Mode A it confirms nothing left the device. In Mode B it shows that only the retrieved excerpts went to the provider the user chose.
7. **Clean up.** Remove the source or delete everything when done.

Variations worth showing: import a PDF and ask about page 3; group three tabs into a research session and ask a comparison question; switch to Mode A and show the settings refuse to offer a remote provider.

## Market and competitive positioning

| | Local-first default | Provider choice (incl. local) | Works in your existing browser | Honest per-source capability levels | Citations to source |
|---|---|---|---|---|---|
| **Lensight** | **Yes** | **Yes** | **Yes (Chrome)** | **Yes (L1–L7)** | **Yes** |
| ChatGPT browser features | No (cloud) | No | Web + apps | No | Varies |
| Perplexity (Comet) | No (cloud) | No | No (own browser) | No | Search-grounded |
| Copilot in Edge | No (cloud) | No | Edge only | No | — |
| Gemini in Chrome | Partial (Nano for narrow tasks) | No | Chrome only | No | — |
| Arc / Arc Search | No (cloud) | No | No (own browser) | No | — |
| OSS "Ollama + browser" extensions | Yes, if configured | Local only | Yes | No | Usually not |

Positioning summary: the big platforms have the reach, but their business model is their cloud. The open-source local tools have the privacy, but not the product: no adapters, no RAG, no citations, no polished UX. Lensight sits between them. **Its moat is privacy, honesty about limitations, and an adapter architecture that makes new sources cheap to add. It is not model quality, and it does not train models.**

[fill in: market sizing, e.g. browser-extension users / knowledge workers / privacy-conscious professionals, with sources]

## Business model (designed for, not yet built)

Lensight has **no revenue and no pricing in the product today.** The architecture was designed so that tiers can be added as configuration rather than a rewrite: the provider abstractions and the Session/Source data model already support usage limits.

| Tier | Intended offer |
|---|---|
| **Free** | Fully local mode and basic remote-provider use, with a fair-use cap on any Lensight-provided convenience defaults. Users bringing their own key are always unlimited. |
| **Pro** | Larger local knowledge base, advanced automations, multi-tab intelligence, bundled with a maintained default provider. |
| **Team** | Shared sessions and knowledge with explicit opt-in sharing and enterprise-style controls. |

Cost structure today is near zero. The tooling is free and open source, no backend exists, and users pay their own AI provider (or nothing, in local mode). Paid tiers that bundle a provider or add team features would introduce hosting and inference costs, so they need to be modeled before launch.

## Traction and proof points

**Stated plainly: Lensight is pre-launch. It has no users, no revenue and no store listing yet.** It was built by one technical founder using AI-assisted engineering. The proof offered is technical rigor, which is unusually strong for this stage:

- **224 passing unit tests** in 26 files on the extension, plus **18 passing tests** on the desktop companion core. All green on 2026-10-05.
- **A full security and quality audit was already done before launch.** It found 52 real issues (9 high priority), and **44 were fixed** at the root cause, most with a test written to fail on the original code first. The findings included:
  - Imported files silently indexed as `[object Object]` on Chrome
  - A path where "fully local" mode could send page content to a remote server
  - A "current source only" filter that searched everything
  - Prompt-injection escapes via Unicode and homoglyph tricks, now covered by 19 adversarial tests
  - A manifest that requested access to every site, contrary to the privacy docs
- **All production dependency advisories resolved**, from 9 (2 critical) to **0**. That included upgrading pdf.js past CVE-2024-4367.
- **Store-review hardening:** no remote code. The build fails if a CDN URL appears in the bundle. No `eval` in the shipped code.
- **Accessibility:** axe-core WCAG 2.1 A/AA violations went from 12 to 0 across light and dark mode.
- **Verified in a real Chromium build**, not just in unit tests: file import, scoped questions, settings validation, PDF parsing in the service worker, local WASM embedding with a test model.
- **A submission-ready privacy policy** and a documented capability matrix that labels unverified features as unverified.

The point for investors: the hardest part of a privacy product is being trustworthy, and Lensight's record of finding and fixing its own privacy bugs before launch is evidence of that.

## Roadmap

1. **Launch (next):** manual browser verification, hosted privacy policy, Chrome Web Store listing, real-network validation of local and remote providers.
2. **Source breadth:** a hardened WhatsApp Web adapter; Gmail, Google Docs, LinkedIn and YouTube transcripts; `.docx`; OCR for scanned PDFs.
3. **Local AI depth:** connect the extension to the desktop companion; ship the companion app; native-app integration.
4. **Scale:** faster search for large local libraries, reranking, per-source provider choice.
5. **Monetization:** Pro and Team tiers on the existing architecture.

[fill in: timeline and milestones tied to the raise]

## Team

[founder background]

[fill in: advisors, planned hires]

## The ask

[fill in: raise amount / use of funds]

Suggested structure for the use-of-funds slide: launch and distribution, source-adapter breadth, desktop companion, and early go-to-market. [fill in: percentages]

## Risks and honest caveats

| Risk | Why it matters | Mitigation |
|---|---|---|
| **WhatsApp Web Terms of Service** | WhatsApp's terms prohibit automated or bulk access. Its DOM changes without notice. | WhatsApp is one experimental adapter, not the flagship. Capture is user-triggered, one conversation at a time, on-screen content only, never background or bulk. The risk is disclosed to users. |
| **Free AI provider tiers may change or disappear** | Mode B convenience depends on providers' free tiers and terms. | No single-provider dependency: any OpenAI-compatible endpoint works, users can bring their own key, and fully local mode needs no provider at all. Free-tier claims are treated as time-stamped and re-verified before each release. |
| **Chrome Web Store review** | Extensions that read page content, ship WASM and contact AI APIs get scrutiny. | Least-privilege manifest (`activeTab`, no `<all_urls>`), no remote code, no `eval`, zero production advisories, a written privacy policy and per-permission justifications. Still unproven until submitted. |
| **"Local-first" is a harder sell to non-technical users** | "Just use our cloud AI" is simpler to explain and set up. Zero-install local mode returns ranked excerpts, not fluent answers. Real local generation needs Ollama installed. | Lead with technical and privacy-sensitive users first. Mode B provides a familiar experience with local indexing. The desktop companion is the intended path to simpler local AI setup (not yet integrated). |
| **Platform competition** | Google, Microsoft and others could add a local mode. | Their incentive is their own cloud and browser. Lensight is cross-provider, honest about capability, and built for privacy from the start. |
| **Unverified pieces** | Real-model embedding quality, real Ollama and remote-API calls, the live WhatsApp adapter and the desktop GUI have not been exercised end to end. | Documented explicitly in `LIMITATIONS.md`, and first on the launch checklist. |
| **Single-founder execution** | Bus factor and bandwidth. | [fill in: hiring plan] |

## Closing

Everyone is putting AI into the browser. Lensight is built to be the one users can trust with their private content: local by default, open to any model, and honest about what it can and cannot read. The engineering record is the evidence that it means it.

---

## Prompt for generating the pitch deck (PPT)

Copy everything in the block below into an AI slide-generation tool, and attach or paste this `pitch.md` file with it.

```text
You are designing a professional investor pitch deck for a pre-seed startup called Lensight. Use ONLY the content of the attached pitch.md file as your source. Do not invent any metrics, users, revenue, customers, partnerships, team members, funding history, market-size numbers, or product capabilities that are not in pitch.md. Where pitch.md contains a placeholder in square brackets (for example "[fill in: raise amount / use of funds]" or "[founder background]"), keep it as a clearly visible placeholder on the slide. Do not fill it in.

DECK STRUCTURE: 12 slides, one key idea per slide, in this order:
1. Title: "Lensight" plus the one-line positioning statement from the "One line" section.
2. Problem: the three points from "The problem" (copy-paste workaround, cloud-first assistants, private content).
3. Solution: from "The solution", the capture → index on device → cited answer → choose local or remote flow. Include a small "built / experimental / roadmap" strip based on that section's table.
4. Product / How it works: the 7-step flow from "Product demo narrative", shown as a simple horizontal flow diagram with a visible "on-device boundary" between local retrieval and the AI provider.
5. Why now: the four points from "Why now".
6. Market / Competition: the comparison table from "Market and competitive positioning", simplified to checkmarks, with Lensight's column highlighted. Keep the market-sizing placeholder.
7. Business model: the Free / Pro / Team table from "Business model". State clearly on the slide that it is designed for but not yet built, and that there is no revenue yet.
8. Traction / Proof points: lead with "Pre-launch: no users or revenue yet" stated honestly, then the technical-rigor proof points as 4–6 large-number callouts (224 tests, 18 companion tests, 52 issues found / 44 fixed, 9 → 0 production advisories, 12 → 0 accessibility violations).
9. Roadmap: the five stages from "Roadmap" as a timeline. Keep the timeline placeholder.
10. Team: the "[founder background]" placeholder only.
11. The Ask: the "[fill in: raise amount / use of funds]" placeholder, with an empty use-of-funds chart scaffold using the categories from "The ask".
12. Closing / Vision: the "Closing" paragraph, plus a risks-acknowledged line drawn from "Risks and honest caveats" (optionally move the full risk table to an appendix slide).

TONE: confident, precise, technical-credibility-forward. No hype words ("revolutionary", "game-changing", "disrupt"). No exaggeration. The engineering rigor and honesty about limitations are the pitch, so let the numbers speak and keep the caveats visible rather than hidden.

VISUAL STYLE: clean, modern SaaS aesthetic. Dark-mode friendly: a dark slate or near-black background with high-contrast light text and one restrained accent color (for example a cool blue or teal), since the product itself ships with dark mode. Generous whitespace. Minimal text per slide: a short headline plus at most 3–5 brief bullets or one diagram or table. Use simple line icons, not stock photos. Use one consistent sans-serif type family. Keep all text at accessible contrast (WCAG AA). Large-number callouts for metrics. Simple diagrams for the data flow and the on-device privacy boundary.

SPEAKER NOTES: for each slide, add 2–4 sentences of speaker notes drawn from the matching pitch.md section, including the honest caveat where one applies (for example, that WhatsApp support is experimental and that the business model is not yet built).

OUTPUT: a 12-slide deck (plus an optional appendix slide for the risk table), exportable to PowerPoint (.pptx).
```
