# Privacy Policy — Lensight

**Last updated:** 2026-10-05
**Applies to:** the Lensight browser extension, version 0.1.0 and later, until this policy is updated.
**Publisher:** [Publisher / developer name]
**Contact:** [contact email]

> Before publishing, fill in every `[bracketed placeholder]` above and in §12, then host this page at a stable public URL and enter that URL in the Chrome Web Store listing's privacy-policy field. This document describes the code as it ships. If you change what the extension does with data, update this policy before you release the change.

---

## 1. Summary

- Lensight answers questions about web pages, text selections and files **you choose** to give it.
- Everything it stores stays **on your device**, inside your browser profile. **The developer runs no server, receives none of your data, and has no way to see it.**
- There is **no telemetry, analytics, advertising, tracking or crash reporting**.
- Data leaves your device in only two situations, and both happen only after you turn them on in Settings:
  1. **You configure a remote AI provider** (Google Gemini, or an OpenAI-compatible endpoint you enter). When you ask a question, the extension sends your question and the few excerpts it retrieved as most relevant to that provider. It never sends the whole page, other tabs or your browsing history.
  2. **You opt in to the "Transformers.js neural embeddings" option.** The extension downloads a public model file once from Hugging Face. That download contains none of your content.
- You can view, export and delete what is stored, and uninstalling the extension removes all of it.

## 2. What the extension processes

The extension reads content only when you ask it to, by clicking a button or pressing a keyboard shortcut on a tab:

| Data | When it is read | What happens to it |
|---|---|---|
| **Web page content**: visible text, headings, lists, code blocks, links, page title and URL | When you click **Capture this page** after invoking the extension on that tab (toolbar icon or keyboard shortcut) | Cleaned, split into chunks, indexed and stored locally. Hidden page text (`display:none`, `visibility:hidden` and similar) is skipped. |
| **Text selection** | When you click **Capture selection** or press the "ask about selection" shortcut | Stored and indexed locally like a page. |
| **Imported files** (`.txt`, `.md`/`.markdown`, `.csv`, `.json`, text-based `.pdf`) | When you pick a file with **Import file…** | Parsed on your device (PDFs with the bundled pdf.js library) and stored and indexed locally. Files are limited to 25 MB and PDFs to 2,000 pages. |
| **Your questions and the answers** | When you ask a question in the side panel | The question is used to search your local index. In this version, the current answer is held in the side panel's memory only and is not written to storage. |
| **Research sessions**: names and the list of sources in each | When you create or edit a session | Stored locally. |
| **Settings**: privacy mode, provider choice, model name, endpoint URLs, your API key (if you enter one), onboarding and quick-action preferences | When you save Settings | Stored locally in `chrome.storage.local`. Never synced to your Google account (`chrome.storage.sync` is not used). |
| **Diagnostics**: the last 50 events, each holding only a timestamp, area, success or failure, an error code, adapter or provider name, and latency | Automatically, as you use the extension | Stored locally. The format can't hold page text, questions, answers or error messages; this is enforced by code and tested. Shown only in the extension's own Diagnostics view. |

Content you capture can contain other people's personal information, for example the text of an email, a document, or a chat open in the experimental WhatsApp Web capture. That content is handled exactly as described here. It stays local unless you have configured a remote AI provider, in which case relevant excerpts of it may be sent to that provider when you ask a question.

The extension does **not** read your browsing history, bookmarks, cookies, passwords, form data, other tabs, or any page you have not invoked it on. It does not run in the background on the sites you visit.

## 3. Where your data is stored

- **On your device only.** Captured sources, documents, chunks, embeddings and sessions are stored in the extension's own IndexedDB database. Settings, your API key and diagnostics are stored in the extension's `chrome.storage.local` area. If you opt in to Transformers.js, the downloaded model files are kept in the extension's browser cache.
- This storage belongs to the extension's own origin inside your browser profile. Websites can't read it.
- **No developer backend exists.** Nothing is uploaded to the developer, and the extension contains no code that contacts a developer-operated server.
- Search embeddings are always computed on your device in every mode. They are never sent anywhere.

## 4. What leaves your device, by privacy mode

You choose a privacy mode in Settings.

### Mode A — Fully local

Nothing you capture, ask or receive leaves your device. The extension enforces this in the component that selects the AI provider, independently of the Settings screen: in Mode A it builds only a local provider, and it refuses any Ollama address that is not on your own machine (`localhost`, `127.x.x.x` or `::1`) before sending anything.

The available answer engines in Mode A are:

- **Basic local mode** (default): ranks and shows the most relevant excerpts. No network.
- **Ollama**: sends your question and the retrieved excerpts to an Ollama program you installed and run on your own computer (default `http://localhost:11434`). The request stays on your machine. What that program does is governed by your own Ollama installation.

If you also opt in to **Transformers.js neural embeddings**, the extension downloads the public model `Xenova/all-MiniLM-L6-v2` once from Hugging Face (`huggingface.co`, plus any Hugging Face file-storage host it redirects the download to). This download sends **none** of your content. Like any web request, it reveals your IP address and browser user-agent to Hugging Face. The model then runs entirely on your device, using a runtime that is packaged inside the extension and never loaded from a CDN.

### Mode B — Local data, remote AI

Capture, indexing, embeddings and search all stay on your device. When you ask a question **and** have configured a remote provider, the extension sends one HTTPS request to that provider containing:

- a fixed system instruction,
- your question,
- the text of the excerpts retrieved as most relevant (by default only from the current source, or from the sources in the session you selected), each truncated to at most 4,000 characters and labelled with a random excerpt ID,
- the model name, and your API key, which authenticates you to the provider.

It does **not** send the full page or document, other sources, other tabs, browsing history, your settings, your stored data or any identifier created by the extension. Requests go directly from your browser to the provider. They never pass through a developer server. The extension refuses to save a remote endpoint that uses plain `http://`, so your key and excerpts are never sent unencrypted.

If no remote provider is configured, Mode B behaves like Mode A: nothing leaves the device.

### Mode C — User configured

Mode C uses the same local-first pipeline and the same rules as Mode B: you choose which provider, if any, receives the retrieved excerpts and your question. In this version, Modes B and C behave identically in code. Only Mode A applies additional restrictions.

## 5. Third-party AI providers

You decide whether to use a third-party provider, and you supply your own account and API key. The extension can send data only to:

| Provider | Address contacted | Configured by |
|---|---|---|
| **Google Gemini API** | `generativelanguage.googleapis.com` | You select "Gemini" and enter your Gemini API key |
| **OpenAI-compatible endpoint**, for example OpenAI, OpenRouter, Groq, or a self-hosted server | The base URL you enter (default `https://api.openai.com/v1`) | You select "OpenAI-compatible" and enter the URL and key |
| **Ollama** | The Ollama URL you enter (default `http://localhost:11434`) | You select "Ollama". Local-only in Mode A |
| **Hugging Face** (model download only, no user content) | `huggingface.co` and the Hugging Face storage hosts it redirects to | You select "Transformers.js neural embeddings" |

Once data reaches a third-party provider, **that provider's own terms and privacy policy govern how it is handled**, including retention, logging, human review and use for model training. The developer has no control over and no visibility into that processing. Those terms differ between providers and between free and paid tiers, and they change over time, so review them before you configure a provider:

- Google Gemini API terms: https://ai.google.dev/gemini-api/terms
- For an OpenAI-compatible endpoint, the terms of whichever service you point it at.

## 6. What the developer does not do

- No telemetry, analytics, usage statistics, advertising identifiers, fingerprinting or crash reporting are collected or sent anywhere.
- No data is sold, rented, shared with or transferred to anyone by the developer, because the developer never receives any.
- No user data is used for advertising, for creditworthiness or lending decisions, or for any purpose unrelated to the extension's single purpose of answering your questions about content you chose to give it.
- No remotely hosted code is executed. All program code, including the pdf.js and ONNX Runtime (WebAssembly) components, ships inside the extension package.

### Chrome Web Store Limited Use

The use of information received from Chrome APIs complies with the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq), including its Limited Use requirements. Page content accessed through the `activeTab` and `scripting` permissions is used only to provide the feature you invoked. It is stored only on your device, and it is transferred only to the AI provider you configured, under the conditions in §4.

## 7. Permissions and why they are needed

| Permission | Purpose |
|---|---|
| `activeTab` | Temporary access to the one tab you invoke the extension on (toolbar icon or keyboard shortcut), so it can capture that page or selection. |
| `scripting` | Injects the capture script into that tab on demand. No content script is registered for all sites. |
| `storage` | Saves your settings, API key, preferences, diagnostics and the short-lived keyboard-shortcut hand-off locally. |
| `sidePanel` | Shows the extension's main interface in Chrome's side panel. |
| Host access to `http://localhost/*` | Lets the extension reach an Ollama program on your own computer. No other site is given elevated access. |

The extension does not request `tabs`, `history`, `bookmarks`, `cookies`, `webRequest` or access to all websites.

## 8. Your controls: view, export and delete

All of these work locally, without contacting anyone:

- **View:** the side panel lists captured sources and sessions, and its **Context in use** panel shows every indexed excerpt for the current source. The **Diagnostics** view shows storage usage, the active privacy mode and providers, and the diagnostic events.
- **Remove an excerpt:** removing an excerpt in **Context in use** deletes it and its embedding, so it is never used in an answer again. The rest of that source, including its stored document copy, is kept.
- **Delete a session:** in the side panel, after confirmation.
- **Delete all data:** in Settings → Data, after confirmation. This erases every captured source, document, excerpt, embedding, session and conversation in the extension's database. Your settings and the diagnostics log stay until you change them or uninstall the extension.
- **Remove your API key:** Settings → **Clear stored key**.
- **Export:** Settings → Data → **Export all data** downloads a JSON file of everything in the extension's database to your computer. Settings and your API key are not included. The file is saved where you choose and is then under your control.
- **Import:** Settings → Data restores a previously exported file. The file is validated before anything is written.
- **Uninstall:** removing the extension makes Chrome delete all of its stored data: the database, settings, API key, diagnostics and any cached model files.

Because the developer holds no copy of your data, the developer can't access, correct, export or delete it on your behalf. The controls above are the complete set, and you are in full control of them. Data you have sent to a third-party AI provider is subject to that provider's own access and deletion processes.

## 9. Security

- Remote requests use HTTPS, and plain-`http://` remote endpoints are refused.
- Your Gemini key is sent in a request header, not in the URL.
- Page content is treated as untrusted. It is fenced off from instructions before being sent to an AI model, to reduce prompt-injection risk.
- Only the extension's own pages can command its background service. Every message is validated.

No system is perfectly secure. Anyone with access to your device or browser profile, such as malware, could read locally stored data, including your API key. Protect your device accordingly.

## 10. Children's privacy

The extension is a general-purpose productivity tool. It is **not directed at children under 13** (or the higher minimum age that applies where you live), and it is not designed or marketed for them. The developer does not knowingly collect personal information from anyone, children included, because the extension sends the developer no data at all. Third-party AI providers you may configure set their own minimum-age requirements in their terms. If you believe a child has used the extension with a third-party provider, contact that provider about data it holds. Uninstalling the extension removes everything stored locally.

## 11. Changes to this policy

If the extension's data practices change, for example a new provider, a new kind of stored data, or any new transmission, this policy will be updated before or together with the release that introduces the change. The "Last updated" date at the top will change, and material changes will be noted in the extension's release notes and Chrome Web Store listing. Data already stored on your device is never newly transmitted because of a policy change without your action in Settings.

## 12. Contact

Questions about this policy or the extension's privacy practices: **[contact email]**

[Optional: postal address or website, if required for your jurisdiction or publisher account.]
