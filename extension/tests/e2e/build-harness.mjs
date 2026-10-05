// Bundles the real extraction + cleaning + chunking pipeline (the same
// modules the content script uses) into a single browser-runnable IIFE, so
// the Playwright e2e smoke test can exercise the actual pipeline logic
// against a real DOM in a real Chromium page — without needing to drive the
// full extension-messaging round trip (content script -> background ->
// IndexedDB), which is impractical to assert against headlessly. This is a
// deliberate, documented scope limitation of the e2e smoke test.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

const entry = path.join(__dirname, 'harness-entry.ts');
const outfile = path.join(__dirname, 'fixtures/harness.bundle.js');

await build({
  entryPoints: [entry],
  bundle: true,
  format: 'iife',
  globalName: '__harness',
  outfile,
  absWorkingDir: root,
  target: 'es2020',
  platform: 'browser',
});

console.log('Built e2e harness bundle ->', outfile);
