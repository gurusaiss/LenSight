import { TabAccessDeniedError } from '../errors';

/**
 * On-demand content-script injection (audit issues CMP-01, CMP-02, FUN-03).
 *
 * Before: `entrypoints/content.ts` was a static manifest content script
 * matching `<all_urls>` — i.e. injected into every page the user visits,
 * which Chrome presents as "read and change all your data on all websites",
 * contradicting docs/SECURITY.md + docs/PRIVACY.md ("no `<all_urls>`").
 * Meanwhile the declared `scripting` permission was used by no code path at
 * all, and tabs that were already open when the extension was installed or
 * updated had no content script ("Receiving end does not exist").
 *
 * Now the content script is registered with WXT `registration: 'runtime'`
 * (not in the manifest) and injected only into the tab the user is acting
 * on, via `chrome.scripting.executeScript` under the `activeTab` grant. The
 * content script itself is idempotent (see entrypoints/content.ts), so
 * re-injecting into a tab that already has it is harmless.
 */

/** Output path WXT gives the `content` entrypoint (see .output/chrome-mv3). */
export const CONTENT_SCRIPT_FILE = 'content-scripts/content.js';

export interface TabMessagingDeps {
  sendMessage: (tabId: number, message: unknown) => Promise<unknown>;
  executeScript: (injection: { target: { tabId: number }; files: string[] }) => Promise<unknown>;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Chrome's error when no listener exists in the tab (no content script yet). */
export function isNoReceiverError(err: unknown): boolean {
  const msg = errorText(err);
  return /Receiving end does not exist|Could not establish connection/i.test(msg);
}

/** Chrome's errors when the extension may not script the tab at all. */
export function isAccessDeniedError(err: unknown): boolean {
  const msg = errorText(err);
  return /Cannot access|cannot be scripted|Missing host permission|chrome:\/\/|extensions gallery|permission/i.test(msg);
}

function defaultDeps(): TabMessagingDeps {
  return {
    sendMessage: (tabId, message) => chrome.tabs.sendMessage(tabId, message),
    executeScript: (injection) => chrome.scripting.executeScript(injection),
  };
}

/**
 * Sends `message` to the content script in `tabId`, injecting the content
 * script first if the tab doesn't have it yet. Throws `TabAccessDeniedError`
 * (actionable) when the tab can't be scripted, instead of Chrome's raw
 * "Cannot access contents of url …" text.
 */
export async function sendToContentScript<T = unknown>(
  tabId: number,
  message: unknown,
  deps: TabMessagingDeps = defaultDeps(),
): Promise<T> {
  try {
    return (await deps.sendMessage(tabId, message)) as T;
  } catch (err) {
    if (!isNoReceiverError(err)) throw err;
  }

  try {
    await deps.executeScript({ target: { tabId }, files: [CONTENT_SCRIPT_FILE] });
  } catch (err) {
    if (isAccessDeniedError(err)) throw new TabAccessDeniedError({ cause: err });
    throw err;
  }

  return (await deps.sendMessage(tabId, message)) as T;
}
