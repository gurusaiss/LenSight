# Chrome Web Store submission checklist

Status as of **2026-10-05** (after the DEP-01 / CDN / privacy-policy pass). Nothing below has been published or submitted.

## Resolved in code

| Item | Status | Evidence |
|---|---|---|
| DEP-01: production dependency advisories | **Resolved.** `npm audit --omit=dev` went from 9 (2 critical, 7 high) to **0**. | `pdfjs-dist` 3.11.174 → 6.4.299. `@xenova/transformers` 2.17.2 → `@huggingface/transformers` 4.3.0. |
| CVE-2024-4367 (pdf.js eval) | **Resolved by upgrade.** The vulnerable code path no longer exists upstream. | `tests/unit/pdfAdapterSafety.test.ts` checks the installed version and the shipped build. |
| Leftover `cdn.jsdelivr.net` string in `background.js` | **Removed at the source.** The library's CDN default is stripped before bundling, and the build fails if the string reappears in any emitted file. | `wxt.config.ts` (`stripTransformersCdnDefault`, `assertNoCdnInBundle`). A grep of `.output/chrome-mv3/` finds no matches. |
| `eval` in bundled libraries (a likely reviewer question) | **Gone.** The build emits no `eval` warning, and `background.js` contains no `eval(` or `new Function(`. | `npm run build` output |
| Privacy policy text | **Written.** Placeholders still need filling in (see below). | [`PRIVACY_POLICY.md`](PRIVACY_POLICY.md) |

## Still required before submitting (not code — needs a person)

1. **Host the privacy policy and link it.**
   - Fill in `[Publisher / developer name]` and `[contact email]` (twice) in `docs/PRIVACY_POLICY.md`, plus the optional address line if your jurisdiction needs one.
   - Publish it at a stable public URL of your choice, for example GitHub Pages or your own site.
   - Paste that URL into the Developer Dashboard → *Privacy* tab → privacy policy field.
   - Fill in the dashboard's data-use disclosures so they match the policy: the extension handles website content and user-provided content (files, selections) locally, transfers excerpts only to the AI provider the user configures, does not sell data, and does not use it for unrelated purposes. Certify Limited Use compliance.
   - Single-purpose statement. A suggestion: "Answer the user's questions about web pages, selections and files they explicitly provide, with on-device indexing."
   - Permission justifications are in the `wxt.config.ts` comments and in the table in `docs/PRIVACY.md` → Permissions. The policy's §7 has the same table.
   - "Remote code: No". All code, including the ONNX Runtime WASM, is packaged.

2. **Manually verify the toolbar-icon and keyboard-shortcut flows in a real headed Chrome.** Automation can't click the toolbar icon or fire browser commands, so the `activeTab` grant itself has only been verified with a test-only host permission standing in for it. Someone should do these once on a normal website, with the extension loaded from `.output/chrome-mv3/`:
   - Toolbar icon → popup → **Open side panel** → **Capture this page**. Expected: the page text is captured, with no access-denied error.
   - Select some text on a page → **Ctrl+Shift+Y** (**Cmd+Shift+Y** on macOS). Expected: the side panel opens and captures the selection.
   - **Ctrl+Shift+E** (**Cmd+Shift+E** on macOS). Expected: the side panel opens.
   - On a `chrome://` page. Expected: a clear "can't read this page" message.
   - Record the Chrome version and the result. If a shortcut conflicts, it can be rebound at `chrome://extensions/shortcuts`.

3. **Recommended, not a hard store requirement:** run the Transformers.js option once with real network access to Hugging Face, to confirm the real `Xenova/all-MiniLM-L6-v2` download and inference end to end. The runtime pipeline (packaged WASM, ONNX session in the service worker) has been verified in real Chromium only with a synthetic model, because this build sandbox blocks huggingface.co.

## Known, accepted for submission (disclose if asked)

- **Five high-severity `npm audit` advisories remain in dev/build tooling only:** `braces`, reached through `tailwindcss@3` → `chokidar`/`micromatch`/`fast-glob`. `npm audit` lists the affected range as `braces *`, so no patched `braces` release exists. The only offered fix is Tailwind CSS 4, a breaking CSS-framework migration that changes class semantics and the color palette. Treat that as a separate UI change, re-checked with axe. These packages are build-time only and are not in the shipped package (`npm audit --omit=dev` → 0).
- Package size is 16.84 MB, of which 14.26 MB is the ONNX Runtime WASM for the optional local-embedding feature. Dropping that feature would save the 14.26 MB.
- `background.js` is ~2.33 MB. pdf.js parses in the service worker's own thread, because MV3 service workers can't spawn Web Workers.
