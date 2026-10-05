import React, { useEffect, useMemo, useRef, useState } from 'react';
import { QUICK_ACTIONS, type QuickActionId } from '../../core/quickActions';

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  isWhatsAppSource: boolean;
  visibleActionIds: QuickActionId[];
  /** Executes a preset-prompt action through the real ask() pipeline. */
  onRunPromptAction: (prompt: string) => void;
  onFocusAsk: () => void;
  onCreateSession: () => void;
  onOpenSettings: () => void;
  onFocusSearchContext: () => void;
}

/**
 * Keyboard-invoked (Cmd/Ctrl+K) quick-action list, wired to the SAME
 * functions the quick-action bar and side panel already use — not a
 * decorative overlay. Rendering (open/close, filtering, arrow-key
 * navigation) lives here; every action it lists calls into
 * useAssistant/App.tsx's real handlers.
 */
export default function CommandPalette({
  open,
  onClose,
  isWhatsAppSource,
  visibleActionIds,
  onRunPromptAction,
  onFocusAsk,
  onCreateSession,
  onOpenSettings,
  onFocusSearchContext,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const actions = useMemo(
    () =>
      QUICK_ACTIONS.filter((a) => visibleActionIds.includes(a.id)).filter(
        (a) => !a.whatsappOnly || isWhatsAppSource,
      ),
    [visibleActionIds, isWhatsAppSource],
  );

  const filtered = useMemo(
    () => actions.filter((a) => a.label.toLowerCase().includes(query.trim().toLowerCase())),
    [actions, query],
  );

  // A11Y-02: remember what had focus so it can be restored on close, and
  // focus the search box once the dialog has mounted.
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = (document.activeElement as HTMLElement | null) ?? null;
    setQuery('');
    setHighlighted(0);
    inputRef.current?.focus();
    return () => {
      // Only restore when closing dropped focus to <body> — if the chosen
      // action already moved focus somewhere meaningful (e.g. "Ask a
      // question" focuses the chat input), leave it there.
      const active = document.activeElement;
      const focusWasDropped = !active || active === document.body;
      const el = restoreFocusRef.current;
      if (focusWasDropped && el && typeof el.focus === 'function' && el.isConnected) el.focus();
    };
  }, [open]);

  const runAction = (id: QuickActionId) => {
    const def = QUICK_ACTIONS.find((a) => a.id === id);
    onClose();
    switch (id) {
      case 'ask':
        onFocusAsk();
        return;
      case 'search-context':
        onFocusSearchContext();
        return;
      case 'create-session':
        onCreateSession();
        return;
      case 'open-settings':
        onOpenSettings();
        return;
      default:
        if (def?.prompt) onRunPromptAction(def.prompt);
    }
  };

  if (!open) return null;

  const activeId = filtered[highlighted] ? `command-palette-option-${filtered[highlighted].id}` : undefined;

  /** Escape from anywhere in the dialog, and a Tab focus trap (the page
   * behind a modal must not receive focus while it is open). */
  const onDialogKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab' || !dialogRef.current) return;
    const focusables = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>('input, button:not([disabled]), [tabindex]:not([tabindex="-1"])'),
    );
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-16"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={dialogRef}
        className="w-full max-w-sm rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onDialogKeyDown}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <input
          ref={inputRef}
          value={query}
          role="combobox"
          aria-label="Search commands"
          aria-expanded="true"
          aria-controls="command-palette-list"
          aria-activedescendant={activeId}
          aria-autocomplete="list"
          onChange={(e) => {
            setQuery(e.target.value);
            setHighlighted(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setHighlighted((h) => Math.min(filtered.length - 1, h + 1));
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setHighlighted((h) => Math.max(0, h - 1));
            }
            if (e.key === 'Enter' && filtered[highlighted]) {
              e.preventDefault();
              runAction(filtered[highlighted].id);
            }
          }}
          placeholder="Type a command…"
          className="w-full border-b border-slate-200 dark:border-slate-700 bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-400"
        />
        <ul id="command-palette-list" role="listbox" aria-label="Commands" className="max-h-72 overflow-y-auto py-1 text-sm">
          {filtered.length === 0 && (
            <li role="presentation" className="px-3 py-2 text-slate-500 dark:text-slate-400">
              No matching commands.
            </li>
          )}
          {filtered.map((a, i) => (
            <li
              key={a.id}
              id={`command-palette-option-${a.id}`}
              role="option"
              aria-selected={i === highlighted}
              tabIndex={-1}
              onClick={() => runAction(a.id)}
              onMouseEnter={() => setHighlighted(i)}
              className={`block w-full cursor-pointer px-3 py-1.5 text-left ${
                i === highlighted ? 'bg-slate-100 dark:bg-slate-800' : ''
              }`}
            >
              {a.label}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
