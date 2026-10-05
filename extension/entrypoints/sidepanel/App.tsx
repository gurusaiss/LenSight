import React, { useState } from 'react';
import ContextPanel from '../../src/ui/components/ContextPanel';
import ContextInUsePanel from '../../src/ui/components/ContextInUsePanel';
import PrivacyIndicator from '../../src/ui/components/PrivacyIndicator';
import ChatBox from '../../src/ui/components/ChatBox';
import SessionPanel from '../../src/ui/components/SessionPanel';
import Onboarding from '../../src/ui/components/Onboarding';
import CommandPalette from '../../src/ui/components/CommandPalette';
import QuickActionsBar from '../../src/ui/components/QuickActionsBar';
import { useAssistant } from '../../src/ui/hooks/useAssistant';
import type { PrivacyMode } from '../../src/core/types';
import { QUICK_ACTIONS, loadQuickActionPrefs, type QuickActionId } from '../../src/core/quickActions';
import { consumePendingSidePanelAction, subscribeToPendingSidePanelAction } from '../../src/core/pendingAction';

const ONBOARDING_STORAGE_KEY = 'onboardingCompleted';

export default function App() {
  const {
    currentSource,
    currentSourceId,
    isExtracting,
    isAsking,
    error,
    lastAnswer,
    extractCurrentPage,
    importLocalFile,
    ask,
    openCitation,
    sessions,
    activeSessionId,
    setActiveSessionId,
    refreshSessions,
    createSession,
    addCurrentSourceToSession,
    removeSourceFromSession,
    deleteSession,
    sourceChunks,
    loadSourceChunks,
    deleteChunkFromContext,
  } = useAssistant();
  const [capabilityLevel] = useState<1 | 2 | 3 | 4 | 5 | 6 | 7>(1);
  const [privacyMode, setPrivacyMode] = useState<PrivacyMode>('B');
  const [embeddingProviderName, setEmbeddingProviderName] = useState<string | undefined>(undefined);
  const [showOnboarding, setShowOnboarding] = useState<boolean | null>(null); // null = not yet loaded
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [quickActionIds, setQuickActionIds] = useState<QuickActionId[]>([]);
  const [startupError, setStartupError] = useState<string | null>(null);

  const openSettings = () => {
    if (typeof chrome !== 'undefined' && chrome.runtime?.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    }
  };

  React.useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      setShowOnboarding(false);
      return;
    }
    chrome.storage.local
      .get(['privacyMode', 'embeddingProviderKind', ONBOARDING_STORAGE_KEY])
      .then((stored) => {
        if (stored.privacyMode) setPrivacyMode(stored.privacyMode as PrivacyMode);
        setEmbeddingProviderName(
          stored.embeddingProviderKind === 'transformers' ? 'transformers-all-MiniLM-L6-v2' : 'hashing-bow-v1',
        );
        setShowOnboarding(!stored[ONBOARDING_STORAGE_KEY]);
      })
      .catch((err) => {
        // FUN-08: an unhandled rejection here used to leave showOnboarding
        // at null forever, i.e. a permanently blank side panel.
        setShowOnboarding(false);
        setStartupError(`Couldn't read extension settings (${String(err?.message ?? err)}); showing defaults.`);
      });
    loadQuickActionPrefs()
      .then((prefs) => {
        setQuickActionIds(prefs.order.filter((id) => !prefs.hidden.includes(id)));
      })
      .catch((err) => {
        setQuickActionIds(QUICK_ACTIONS.map((a) => a.id));
        setStartupError(`Couldn't read quick-action preferences (${String(err?.message ?? err)}); showing all actions.`);
      });
  }, []);

  // Real handoff for the "ask-about-selection" keyboard shortcut (see
  // wxt.config.ts's `commands` block, background.ts's onCommand listener,
  // and src/core/pendingAction.ts): the background worker can only open this
  // panel, not run an extraction, so it leaves a short-lived request behind
  // for the panel to pick up and act on for real, once, on mount — never
  // silently swallowed and never re-run on a later open.
  // FUN-05: consume on mount AND subscribe to later writes, so the shortcut
  // works when the panel is already open (no re-mount) and when the
  // background's write lands just after this panel mounted.
  const extractRef = React.useRef(extractCurrentPage);
  extractRef.current = extractCurrentPage;
  React.useEffect(() => {
    if (showOnboarding !== false) return; // wait until the main UI is what will actually show
    const run = (action: string | null) => {
      if (action === 'extract-selection') void extractRef.current('selection');
    };
    consumePendingSidePanelAction()
      .then(run)
      .catch((err) => setStartupError(`Couldn't read the pending shortcut request (${String(err?.message ?? err)}).`));
    return subscribeToPendingSidePanelAction(run);
  }, [showOnboarding]);

  // Command palette keyboard shortcut: Cmd/Ctrl+K, scoped to the side panel
  // only (no page-level listener, so it never fights with a host page's own
  // shortcuts) — the equivalent "open assistant"/"ask about selection"
  // shortcuts registered via WXT's commands API (wxt.config.ts) work at the
  // browser level instead, since they need to work even when the side panel
  // isn't focused yet.
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const finishOnboarding = () => {
    setShowOnboarding(false);
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local
        .set({ [ONBOARDING_STORAGE_KEY]: true })
        .catch((err) => setStartupError(`Couldn't remember that onboarding was completed (${String(err?.message ?? err)}); it may show again.`));
    }
  };

  const isWhatsAppSource = currentSource?.adapterUsed === 'whatsappAdapter';

  const runQuickAction = (id: QuickActionId) => {
    if (id === 'ask' || id === 'search-context') {
      document.getElementById('chat-question-input')?.focus();
      return;
    }
    if (id === 'create-session') {
      const name = typeof window !== 'undefined' ? window.prompt('New session name:') : null;
      if (name && name.trim()) createSession(name.trim());
      return;
    }
    if (id === 'open-settings') {
      openSettings();
      return;
    }
    // CODE-01: prompts come from the single QUICK_ACTIONS definition the
    // Command Palette also uses — this used to be a second, hand-copied map.
    const prompt = QUICK_ACTIONS.find((a) => a.id === id)?.prompt;
    if (prompt) ask(prompt);
  };

  if (showOnboarding === null) {
    // Loading storage — render nothing rather than a flash of the main UI
    // before we know whether onboarding should show.
    return null;
  }

  if (showOnboarding) {
    return <Onboarding onFinish={finishOnboarding} onOpenSettings={openSettings} />;
  }

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <header className="flex items-center justify-between">
        <h1 className="text-base font-bold tracking-tight">Lensight</h1>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="rounded border border-slate-300 dark:border-slate-600 px-2 py-1 text-xs"
            title="Command palette (Ctrl/Cmd+K)"
            aria-label="Open command palette (Ctrl or Cmd+K)"
            aria-haspopup="dialog"
          >
            {'⌘K'}
          </button>
          <button
            type="button"
            onClick={openSettings}
            className="rounded border border-slate-300 dark:border-slate-600 px-2 py-1 text-xs"
          >
            Settings
          </button>
        </div>
      </header>

      <PrivacyIndicator
        mode={privacyMode}
        providerName={lastAnswer?.providerName ?? 'extractive-local'}
        providerMode={lastAnswer?.providerMode ?? 'local'}
        embeddingProviderName={embeddingProviderName}
      />

      <ContextPanel
        source={currentSource ? { title: currentSource.title, url: currentSource.url, chunkCount: currentSource.chunkCount } : null}
        capabilityLevel={currentSource?.capabilityLevel ?? capabilityLevel}
        confidence={currentSource?.confidence ?? 'high'}
        onExtractPage={() => extractCurrentPage('page')}
        onExtractSelection={() => extractCurrentPage('selection')}
        onImportFile={(file) => importLocalFile(file)}
        isExtracting={isExtracting}
      />

      <QuickActionsBar
        visibleActionIds={quickActionIds}
        isWhatsAppSource={isWhatsAppSource}
        disabled={!currentSourceId || isAsking}
        onRun={runQuickAction}
      />

      <ContextInUsePanel
        sourceId={currentSourceId}
        chunks={sourceChunks}
        onLoad={loadSourceChunks}
        onDeleteChunk={deleteChunkFromContext}
      />

      <SessionPanel
        sessions={sessions}
        activeSessionId={activeSessionId}
        currentSourceId={currentSourceId}
        onSetActiveSessionId={setActiveSessionId}
        onRefreshSessions={refreshSessions}
        onCreateSession={createSession}
        onAddCurrentSourceToSession={addCurrentSourceToSession}
        onRemoveSourceFromSession={removeSourceFromSession}
        onDeleteSession={deleteSession}
      />

      {/* A11Y-04: announced to screen readers when it appears. */}
      <div role="alert" aria-live="assertive">
        {(error || startupError) && (
          <div className="rounded bg-red-100 dark:bg-red-900 px-2 py-1 text-xs text-red-800 dark:text-red-200">
            {error ?? startupError}
          </div>
        )}
      </div>

      <ChatBox onAsk={(q) => ask(q)} isAsking={isAsking} lastAnswer={lastAnswer} onOpenCitation={openCitation} />

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        isWhatsAppSource={isWhatsAppSource}
        visibleActionIds={quickActionIds}
        onRunPromptAction={(prompt) => ask(prompt)}
        onFocusAsk={() => document.getElementById('chat-question-input')?.focus()}
        onFocusSearchContext={() => document.getElementById('chat-question-input')?.focus()}
        onCreateSession={() => runQuickAction('create-session')}
        onOpenSettings={openSettings}
      />
    </div>
  );
}
