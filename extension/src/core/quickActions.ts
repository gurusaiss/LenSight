/**
 * Quick actions shared by the Command Palette and the side panel's
 * customizable quick-action bar. Kept as data (id/label/prompt) rather than
 * JSX so both surfaces stay in sync from one definition, and so
 * order/visibility can be persisted as a plain array of ids in
 * `chrome.storage.local` (see `loadQuickActionPrefs`/`saveQuickActionPrefs`).
 */

export type QuickActionId =
  | 'summarize'
  | 'ask'
  | 'extract-links'
  | 'extract-tasks-dates'
  | 'explain'
  | 'search-context'
  | 'create-session'
  | 'open-settings';

export interface QuickActionDef {
  id: QuickActionId;
  label: string;
  /** For 'ask'-kind actions: the preset question sent through the existing
   * ask()/askQuestion() RAG pipeline — real functionality, not a mockup. */
  prompt?: string;
  /** Only meaningful for WhatsApp sources (per the task's spec); hidden
   * automatically for any other source type in the UI, not just in Settings. */
  whatsappOnly?: boolean;
}

export const QUICK_ACTIONS: QuickActionDef[] = [
  { id: 'summarize', label: 'Summarize', prompt: 'Summarize the captured content in a few concise sentences.' },
  { id: 'ask', label: 'Ask a question', prompt: undefined },
  { id: 'extract-links', label: 'Extract links', prompt: 'List every link/URL mentioned in the captured content, one per line.' },
  {
    id: 'extract-tasks-dates',
    label: 'Extract tasks & dates',
    prompt: 'List any tasks, action items, or dates/deadlines mentioned in this conversation, one per line.',
    whatsappOnly: true,
  },
  { id: 'explain', label: 'Explain this', prompt: 'Explain the captured content in plain language, as if to someone unfamiliar with the topic.' },
  { id: 'search-context', label: 'Search context', prompt: undefined },
  { id: 'create-session', label: 'Create session', prompt: undefined },
  { id: 'open-settings', label: 'Open Settings', prompt: undefined },
];

export const DEFAULT_QUICK_ACTION_ORDER: QuickActionId[] = QUICK_ACTIONS.map((a) => a.id);

export interface QuickActionPrefs {
  order: QuickActionId[];
  hidden: QuickActionId[];
}

const DEFAULT_PREFS: QuickActionPrefs = { order: DEFAULT_QUICK_ACTION_ORDER, hidden: [] };

function hasChromeStorage(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.storage?.local;
}

/** Loads the user's saved quick-action order/visibility, falling back to
 * every action visible in its declared default order. Any unknown/removed
 * ids from a stale save are dropped; any newly-added action id not yet in a
 * saved order is appended, so a future new action always shows up rather
 * than silently being hidden by an old save. */
export async function loadQuickActionPrefs(): Promise<QuickActionPrefs> {
  if (!hasChromeStorage()) return DEFAULT_PREFS;
  const stored = await chrome.storage.local.get(['quickActionOrder', 'quickActionHidden']);
  const validIds = new Set(DEFAULT_QUICK_ACTION_ORDER);
  const savedOrder: QuickActionId[] = Array.isArray(stored.quickActionOrder) ? stored.quickActionOrder : [];
  const order = savedOrder.filter((id): id is QuickActionId => validIds.has(id as QuickActionId));
  for (const id of DEFAULT_QUICK_ACTION_ORDER) {
    if (!order.includes(id)) order.push(id);
  }
  const hidden: QuickActionId[] = Array.isArray(stored.quickActionHidden)
    ? stored.quickActionHidden.filter((id: unknown): id is QuickActionId => validIds.has(id as QuickActionId))
    : [];
  return { order, hidden };
}

export async function saveQuickActionPrefs(prefs: QuickActionPrefs): Promise<void> {
  if (!hasChromeStorage()) return;
  await chrome.storage.local.set({ quickActionOrder: prefs.order, quickActionHidden: prefs.hidden });
}
