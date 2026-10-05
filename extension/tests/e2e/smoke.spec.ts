import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * E2E smoke test.
 *
 * SCOPE / HONEST LIMITATION: driving the full built extension (content
 * script -> chrome.runtime messaging -> background service worker ->
 * IndexedDB -> side panel UI) inside a headless Playwright Chromium context
 * is possible in principle (via a persistent context + `--load-extension`,
 * non-headless "new headless" mode) but is flaky and heavy for an MVP smoke
 * test, and asserting against the side panel's rendered UI headlessly is
 * impractical in this environment. Per the task's own guidance ("can be a
 * light smoke test... use judgment, note limitations honestly if something
 * can't be tested"), this test instead:
 *
 *   1. Opens the real static HTML fixture (tests/e2e/fixtures/article.html)
 *      in a real Chromium page via Playwright.
 *   2. Injects a bundle (tests/e2e/fixtures/harness.bundle.js, built by
 *      tests/e2e/build-harness.mjs from the *actual* source modules —
 *      genericWebAdapter.ts, clean.ts, chunk.ts) that runs the real
 *      extraction + cleaning + chunking pipeline against that page's real
 *      DOM.
 *   3. Asserts extraction succeeded and at least one chunk was produced.
 *
 * This verifies the real adapter/processing code end-to-end against a real
 * browser DOM, which is the part of the pipeline most sensitive to actual
 * DOM behavior. It intentionally does NOT verify the chrome.runtime message
 * plumbing or the side panel UI rendering — those are structurally simple
 * (typed message passing, React rendering already covered by TypeScript)
 * and are the documented gap in this smoke test's coverage.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('generic web adapter extracts and chunks a real static article page', async ({ page }) => {
  const fixturePath = path.join(__dirname, 'fixtures/article.html');
  await page.goto(`file://${fixturePath}`);

  const bundlePath = path.join(__dirname, 'fixtures/harness.bundle.js');
  await page.addScriptTag({ path: bundlePath });

  const result = await page.evaluate(() => (window as any).__extractAndChunk());

  expect(result).not.toBeNull();
  expect(result.title).toContain('Test Article');
  // Boilerplate (nav/header/footer/aside) must be stripped out.
  expect(result.blockCount).toBeGreaterThan(0);
  expect(result.chunkCount).toBeGreaterThanOrEqual(1);
  expect(result.firstChunkText).toContain('Local-first software');
  // Boilerplate lines must not leak into the extracted chunk text.
  expect(result.firstChunkText).not.toContain('Site Header');
  expect(result.firstChunkText).not.toContain('All rights reserved');
});
