// pdfjs-dist 6.x ships no type declarations for its worker module. The only
// export used is the handler pdfAdapter.ts installs as `globalThis.pdfjsWorker`
// so pdf.js can parse in the MV3 service worker without a Web Worker.
declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs' {
  export const WorkerMessageHandler: unknown;
}
