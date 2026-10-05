// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CommandPalette from '../../src/ui/components/CommandPalette';
import ChatBox from '../../src/ui/components/ChatBox';
import ContextPanel from '../../src/ui/components/ContextPanel';
import SessionPanel from '../../src/ui/components/SessionPanel';
import ContextInUsePanel from '../../src/ui/components/ContextInUsePanel';
import { DEFAULT_QUICK_ACTION_ORDER } from '../../src/core/quickActions';

/**
 * Component-level regression tests for the audit's A11Y / UI findings,
 * rendered with the project's existing react-dom + jsdom (no new test
 * dependencies). jsdom has no layout engine, so these assert semantics,
 * focus movement and keyboard behavior — not visual rendering.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(el: React.ReactElement) {
  act(() => root.render(el));
}

function key(target: Element, k: string, opts: KeyboardEventInit = {}) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }));
  });
}

/** Accessible-name check good enough for these components: aria-label,
 * aria-labelledby, a <label for>, or a wrapping <label>. */
function hasAccessibleName(el: Element): boolean {
  if (el.getAttribute('aria-label')?.trim()) return true;
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy && document.getElementById(labelledBy)?.textContent?.trim()) return true;
  if (el.id && document.querySelector(`label[for="${el.id}"]`)?.textContent?.trim()) return true;
  return !!el.closest('label')?.textContent?.trim();
}

const paletteProps = {
  onClose: vi.fn(),
  isWhatsAppSource: false,
  visibleActionIds: DEFAULT_QUICK_ACTION_ORDER,
  onRunPromptAction: vi.fn(),
  onFocusAsk: vi.fn(),
  onCreateSession: vi.fn(),
  onOpenSettings: vi.fn(),
  onFocusSearchContext: vi.fn(),
};

describe('A11Y-02: CommandPalette is a real modal dialog', () => {
  it('is aria-modal, labels its input, and exposes options via listbox/aria-activedescendant', () => {
    render(<CommandPalette open {...paletteProps} />);
    const dialog = container.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const input = container.querySelector('input')!;
    expect(hasAccessibleName(input)).toBe(true);
    expect(document.activeElement).toBe(input);
    const listbox = container.querySelector('[role="listbox"]')!;
    expect(listbox.querySelectorAll('[role="option"]').length).toBeGreaterThan(0);
    const firstActive = input.getAttribute('aria-activedescendant');
    expect(document.getElementById(firstActive!)?.getAttribute('aria-selected')).toBe('true');
    key(input, 'ArrowDown');
    expect(input.getAttribute('aria-activedescendant')).not.toBe(firstActive);
  });

  it('traps Tab focus inside the dialog', () => {
    render(<CommandPalette open {...paletteProps} />);
    const input = container.querySelector('input')!;
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    act(() => {
      input.dispatchEvent(tab);
    });
    expect(tab.defaultPrevented).toBe(true);
    expect(container.querySelector('[role="dialog"]')!.contains(document.activeElement)).toBe(true);
  });

  it('closes on Escape from anywhere in the dialog, not only the input', () => {
    const onClose = vi.fn();
    render(<CommandPalette open {...paletteProps} onClose={onClose} />);
    key(container.querySelector('[role="listbox"]')!, 'Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('restores focus to the element that opened it', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    render(<CommandPalette open {...paletteProps} />);
    expect(document.activeElement).not.toBe(opener);
    render(<CommandPalette open={false} {...paletteProps} />);
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});

describe('FUN-07 / A11Y-03 / A11Y-04: ChatBox', () => {
  it('Enter does not submit while a request is already in flight', () => {
    const onAsk = vi.fn().mockResolvedValue(null);
    render(<ChatBox onAsk={onAsk} isAsking lastAnswer={null} />);
    const input = container.querySelector('input')!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, 'What is this page about?');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    key(input, 'Enter');
    expect(onAsk).not.toHaveBeenCalled();
  });

  it('Enter submits when idle', () => {
    const onAsk = vi.fn().mockResolvedValue(null);
    render(<ChatBox onAsk={onAsk} isAsking={false} lastAnswer={null} />);
    const input = container.querySelector('input')!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, 'What is this page about?');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    key(input, 'Enter');
    expect(onAsk).toHaveBeenCalledWith('What is this page about?');
  });

  it('question input has an accessible name and the answer area is a live region', () => {
    render(<ChatBox onAsk={vi.fn()} isAsking={false} lastAnswer={null} />);
    expect(hasAccessibleName(container.querySelector('input')!)).toBe(true);
    expect(container.querySelector('[aria-live="polite"]')).not.toBeNull();
  });
});

describe('A11Y-01: file import is keyboard operable', () => {
  it('renders a focusable <button> that opens the (hidden) file input', () => {
    render(
      <ContextPanel
        source={null}
        capabilityLevel={1}
        confidence="high"
        onExtractPage={vi.fn()}
        onExtractSelection={vi.fn()}
        onImportFile={vi.fn()}
        isExtracting={false}
      />,
    );
    const button = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Import file'))!;
    expect(button).toBeDefined();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const click = vi.spyOn(input, 'click');
    button.focus();
    expect(document.activeElement).toBe(button);
    act(() => button.click());
    expect(click).toHaveBeenCalled();
  });
});

describe('A11Y-03 / A11Y-06: panels expose names and disclosure state', () => {
  it('SessionPanel: aria-expanded toggles and the new-session input is labelled', () => {
    render(
      <SessionPanel
        sessions={[]}
        activeSessionId={null}
        currentSourceId={null}
        onSetActiveSessionId={vi.fn()}
        onRefreshSessions={vi.fn().mockResolvedValue(undefined)}
        onCreateSession={vi.fn()}
        onAddCurrentSourceToSession={vi.fn()}
        onRemoveSourceFromSession={vi.fn()}
        onDeleteSession={vi.fn()}
      />,
    );
    const toggle = container.querySelector('button[aria-expanded]')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    act(() => (toggle as HTMLButtonElement).click());
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const nameInput = container.querySelector('#new-session-name')!;
    expect(hasAccessibleName(nameInput)).toBe(true);
  });

  it('ContextInUsePanel: disclosure button reports aria-expanded', () => {
    render(<ContextInUsePanel sourceId="src_1" chunks={[]} onLoad={vi.fn()} onDeleteChunk={vi.fn()} />);
    const toggle = container.querySelector('button[aria-expanded]')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('A11Y-05: muted-text colour tokens meet WCAG AA', () => {
  // Measured with WCAG relative-luminance math on tailwindcss/colors:
  // slate-400 on white = 2.56:1 (fails 4.5:1); slate-500 on white = 4.76:1;
  // slate-500 on slate-900 = 3.75:1 (fails) while slate-400 on slate-900 = 6.96:1.
  const roots = ['src/ui/components', 'entrypoints/sidepanel', 'entrypoints/options', 'entrypoints/popup'];
  const files = roots.flatMap((dir) =>
    readdirSync(dir)
      .filter((f) => f.endsWith('.tsx'))
      .map((f) => join(dir, f)),
  );

  it('no light-mode text-slate-400 and no text-slate-500 without a dark-mode override', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      const classStrings = src.match(/(["'`])[^"'`\n]*\btext-slate-[45]00\b[^"'`\n]*\1/g) ?? [];
      for (const cls of classStrings) {
        const toks = cls.slice(1, -1).split(/\s+/);
        if (toks.includes('text-slate-400')) offenders.push(`${f}: ${cls}`);
        if (toks.includes('text-slate-500') && !toks.some((t) => t.startsWith('dark:text-'))) offenders.push(`${f}: ${cls}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
