/**
 * A tiny, storage-backed handoff for the "ask-about-selection" keyboard
 * shortcut (see wxt.config.ts's `commands` block and
 * entrypoints/background.ts's `chrome.commands.onCommand` listener).
 *
 * The command fires in the background service worker, which has no UI of
 * its own to run an extraction in (see background.ts's comment on why it
 * only opens the side panel). Previously it stopped there — the side panel
 * opened but nothing else happened, silently breaking the command's own
 * stated description ("Capture the current text selection and open the
 * assistant"). This module lets the background worker leave a short-lived
 * "please do this once you're open" note in `chrome.storage.local`, which
 * the side panel (entrypoints/sidepanel/App.tsx) reads once on mount,
 * consumes (clears), and acts on for real.
 *
 * Kept intentionally tiny and pure where possible (see `isFresh`) so the
 * time-based logic is unit-testable without a chrome.storage mock.
 */

export type PendingSidePanelAction = 'extract-selection';

export interface PendingActionRecord {
  action: PendingSidePanelAction;
  requestedAt: number;
}

const STORAGE_KEY = 'pendingSidePanelAction';

/** A pending action older than this is treated as stale and ignored — e.g.
 * the side panel was already open from an earlier session and only gets
 * focused much later, well after the keyboard shortcut that queued it. */
export const PENDING_ACTION_MAX_AGE_MS = 15_000;

export function isFresh(requestedAt: number, now: number): boolean {
  return now - requestedAt >= 0 && now - requestedAt <= PENDING_ACTION_MAX_AGE_MS;
}

function hasChromeStorage(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.storage?.local;
}

/** Called from the background worker's command listener. */
export async function setPendingSidePanelAction(action: PendingSidePanelAction): Promise<void> {
  if (!hasChromeStorage()) return;
  const record: PendingActionRecord = { action, requestedAt: Date.now() };
  await chrome.storage.local.set({ [STORAGE_KEY]: record });
}

/** Narrows an untrusted stored value to a fresh, known pending action. */
export function freshActionFromRecord(record: unknown, now: number): PendingSidePanelAction | null {
  if (typeof record !== 'object' || record === null) return null;
  const { action, requestedAt } = record as Partial<PendingActionRecord>;
  if (action !== 'extract-selection' || typeof requestedAt !== 'number') return null;
  return isFresh(requestedAt, now) ? action : null;
}

/** Called from the side panel on mount. Reads and immediately clears
 * the pending action (so it never re-fires on a later open), and returns it
 * only if still fresh. */
export async function consumePendingSidePanelAction(): Promise<PendingSidePanelAction | null> {
  if (!hasChromeStorage()) return null;
  const stored = await chrome.storage.local.get([STORAGE_KEY]);
  const record = stored[STORAGE_KEY];
  if (record === undefined) return null;
  await chrome.storage.local.remove(STORAGE_KEY);
  return freshActionFromRecord(record, Date.now());
}

/**
 * FUN-05: if the side panel is ALREADY open when the keyboard shortcut
 * fires, it never re-mounts, so a mount-time read alone never saw the
 * request (and the background now writes it right after opening the panel,
 * so even a fresh mount can race it). Subscribing to storage changes covers
 * both cases. Returns an unsubscribe function.
 */
export function subscribeToPendingSidePanelAction(onAction: (action: PendingSidePanelAction) => void): () => void {
  if (!hasChromeStorage() || !chrome.storage.onChanged) return () => {};
  const listener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
    if (areaName !== 'local' || !changes[STORAGE_KEY]?.newValue) return;
    consumePendingSidePanelAction()
      .then((action) => {
        if (action) onAction(action);
      })
      .catch((err) => console.warn('[pendingAction] failed to consume pending action', err));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
