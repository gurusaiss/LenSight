import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/ui/styles.css';

/**
 * Lightweight quick-action entry point (per spec: "popup remains as a
 * lightweight quick-action entry point"). The side panel (entrypoints/sidepanel)
 * is the primary UI since it persists across navigation; the popup offers
 * a couple of one-click shortcuts and a way to open the side panel.
 */
function PopupApp() {
  const [windowId, setWindowId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Resolve the window BEFORE the click: chrome.sidePanel.open() must run
  // synchronously inside the click's user gesture, and the old code awaited
  // chrome.tabs.query() first, which can drop the gesture (FUN-05). Failures
  // are shown, not swallowed with window.close().
  useEffect(() => {
    chrome.windows
      .getCurrent()
      .then((w) => setWindowId(w.id ?? null))
      .catch((err) => setError(`Couldn't find the current window: ${String(err?.message ?? err)}`));
  }, []);

  const openSidePanel = () => {
    if (windowId == null || !chrome.sidePanel?.open) {
      setError('The side panel API is unavailable in this browser.');
      return;
    }
    chrome.sidePanel
      .open({ windowId })
      .then(() => window.close())
      .catch((err: unknown) => setError(`Couldn't open the side panel: ${String((err as Error)?.message ?? err)}`));
  };

  return (
    <div className="p-3 text-sm">
      <h1 className="mb-2 text-sm font-bold">Lensight</h1>
      <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
        Local-first context assistant. Extraction and indexing stay on-device.
      </p>
      <button
        type="button"
        onClick={openSidePanel}
        disabled={windowId == null}
        className="w-full rounded bg-slate-900 dark:bg-slate-100 dark:text-slate-900 px-2 py-1 text-xs text-white disabled:opacity-50"
      >
        Open side panel
      </button>
      {error && (
        <p role="alert" className="mt-2 text-xs text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}

const container = document.getElementById('root')!;
createRoot(container).render(
  <React.StrictMode>
    <PopupApp />
  </React.StrictMode>,
);
