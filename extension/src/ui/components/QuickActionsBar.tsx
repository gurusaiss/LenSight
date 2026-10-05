import React from 'react';
import { QUICK_ACTIONS, type QuickActionId } from '../../core/quickActions';

export interface QuickActionsBarProps {
  visibleActionIds: QuickActionId[];
  isWhatsAppSource: boolean;
  disabled: boolean;
  onRun: (id: QuickActionId) => void;
}

/** The customizable quick-action row in the side panel itself (in addition
 * to the Command Palette) — same action ids/order the user set in Settings
 * (`SettingsForm.tsx`'s "Quick actions" section), so both surfaces always
 * agree. */
export default function QuickActionsBar({ visibleActionIds, isWhatsAppSource, disabled, onRun }: QuickActionsBarProps) {
  const actions = QUICK_ACTIONS.filter((a) => visibleActionIds.includes(a.id)).filter(
    (a) => !a.whatsappOnly || isWhatsAppSource,
  );

  if (actions.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {actions.map((a) => (
        <button
          key={a.id}
          type="button"
          disabled={disabled}
          onClick={() => onRun(a.id)}
          className="rounded border border-slate-300 dark:border-slate-600 px-2 py-1 text-xs disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800"
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}
