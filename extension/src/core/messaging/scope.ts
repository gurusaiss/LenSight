/**
 * Retrieval scope for a question asked from the side panel (audit issue
 * FUN-02).
 *
 * SessionPanel tells the user the scope is either "current source only"
 * (no active session) or "everything in session X". Before this helper, the
 * side panel's `ask()` never sent the current source id at all, so with no
 * session selected the background retrieved from EVERY source ever captured
 * — and in Mode B those unrelated sources' chunks were sent to the remote AI
 * provider. This makes the scope explicit and refuses to ask unscoped.
 */
export type AskScope =
  | { ok: true; sessionId: string; sourceIds?: undefined }
  | { ok: true; sourceIds: string[]; sessionId?: undefined }
  | { ok: false; error: string };

export function resolveAskScope(activeSessionId: string | null, currentSourceId: string | null): AskScope {
  if (activeSessionId) return { ok: true, sessionId: activeSessionId };
  if (currentSourceId) return { ok: true, sourceIds: [currentSourceId] };
  return {
    ok: false,
    error: 'Capture a page, selection, or file first (or pick a research session) — there is nothing in scope to ask about yet.',
  };
}
