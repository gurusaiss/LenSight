import React, { useEffect, useState } from 'react';
import type { Session } from '../../core/types';

export interface SessionPanelProps {
  sessions: Session[];
  activeSessionId: string | null;
  currentSourceId: string | null;
  onSetActiveSessionId: (id: string | null) => void;
  onRefreshSessions: () => Promise<void>;
  onCreateSession: (name: string) => Promise<string | null>;
  onAddCurrentSourceToSession: (sessionId: string) => Promise<void>;
  onRemoveSourceFromSession: (sessionId: string, sourceId: string) => Promise<void>;
  onDeleteSession: (sessionId: string) => Promise<void>;
}

/**
 * Multi-tab / research sessions UI (Phase 5): lets the user create a
 * session, add the currently-captured source into it, and switch retrieval
 * scope between "just the current source" (scope === null) and "everything
 * in this session" (scope === a session id) — wired straight into
 * useAssistant's `activeSessionId`, which `ask()` already forwards to the
 * background worker's `sessionRetrieve` path.
 */
export default function SessionPanel({
  sessions,
  activeSessionId,
  currentSourceId,
  onSetActiveSessionId,
  onRefreshSessions,
  onCreateSession,
  onAddCurrentSourceToSession,
  onRemoveSourceFromSession,
  onDeleteSession,
}: SessionPanelProps) {
  const [newSessionName, setNewSessionName] = useState('');
  const [expanded, setExpanded] = useState(false);

  // Load once on mount. onRefreshSessions reports its own failures via the
  // side panel's error banner (useAssistant.refreshSessions), so there is
  // nothing to swallow here.
  const refreshRef = React.useRef(onRefreshSessions);
  useEffect(() => {
    void refreshRef.current();
  }, []);

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;

  const handleCreate = async () => {
    const name = newSessionName.trim();
    if (!name) return;
    const id = await onCreateSession(name);
    setNewSessionName('');
    if (id) onSetActiveSessionId(id);
  };

  return (
    <div className="space-y-2 rounded-md border border-slate-200 dark:border-slate-700 p-3 text-xs">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between font-semibold"
        aria-expanded={expanded}
        aria-controls="session-panel-body"
      >
        <span>
          Research sessions
          {activeSession ? ` — scope: "${activeSession.name}" (${activeSession.sourceIds.length} source(s))` : ' — scope: current source only'}
        </span>
        <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
      </button>

      {expanded && (
        <div id="session-panel-body" className="space-y-2 pt-1">
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name="retrieval-scope"
                checked={activeSessionId === null}
                onChange={() => onSetActiveSessionId(null)}
              />
              Current source only
            </label>
          </div>

          <ul className="space-y-1">
            {sessions.map((session) => (
              <li key={session.id} className="flex items-center justify-between gap-2 rounded border border-slate-200 dark:border-slate-700 px-2 py-1">
                <label className="flex flex-1 items-center gap-2 truncate">
                  <input
                    type="radio"
                    name="retrieval-scope"
                    checked={activeSessionId === session.id}
                    onChange={() => onSetActiveSessionId(session.id)}
                  />
                  <span className="truncate">
                    {session.name} <span className="text-slate-500 dark:text-slate-400">({session.sourceIds.length} source(s))</span>
                  </span>
                </label>
                <div className="flex gap-1">
                  <button
                    type="button"
                    disabled={!currentSourceId}
                    onClick={() => onAddCurrentSourceToSession(session.id)}
                    className="rounded border border-slate-300 dark:border-slate-600 px-1.5 py-0.5 disabled:opacity-40"
                    title="Add currently-captured source to this session"
                    aria-label={`Add current source to session ${session.name}`}
                  >
                    + current
                  </button>
                  {currentSourceId && session.sourceIds.includes(currentSourceId) && (
                    <button
                      type="button"
                      onClick={() => onRemoveSourceFromSession(session.id, currentSourceId)}
                      className="rounded border border-slate-300 dark:border-slate-600 px-1.5 py-0.5"
                      title="Remove currently-captured source from this session"
                      aria-label={`Remove current source from session ${session.name}`}
                    >
                      − current
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      if (typeof window === 'undefined' || window.confirm(`Delete session "${session.name}"? This cannot be undone.`)) {
                        onDeleteSession(session.id);
                      }
                    }}
                    className="rounded border border-red-300 dark:border-red-700 px-1.5 py-0.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950"
                    title="Delete this session (keeps the sources themselves)"
                    aria-label={`Delete session ${session.name}`}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
            {sessions.length === 0 && <li className="text-slate-500 dark:text-slate-400">No sessions yet.</li>}
          </ul>

          <div className="flex gap-2">
            <label htmlFor="new-session-name" className="sr-only">
              New session name
            </label>
            <input
              id="new-session-name"
              maxLength={200}
              value={newSessionName}
              onChange={(e) => setNewSessionName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate();
              }}
              placeholder="New session name…"
              className="flex-1 rounded border border-slate-300 dark:border-slate-600 bg-transparent px-2 py-1"
            />
            <button
              type="button"
              onClick={handleCreate}
              className="rounded bg-slate-900 dark:bg-slate-100 dark:text-slate-900 px-2 py-1 text-white"
            >
              Create
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
