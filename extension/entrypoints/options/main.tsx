import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import SettingsForm from '../../src/ui/components/SettingsForm';
import Diagnostics from '../../src/ui/components/Diagnostics';
import '../../src/ui/styles.css';

type Tab = 'settings' | 'diagnostics';

function OptionsApp() {
  const [tab, setTab] = useState<Tab>('settings');
  return (
    <div>
      <nav className="flex gap-1 border-b border-slate-200 dark:border-slate-700 px-4 pt-3 text-sm">
        {(['settings', 'diagnostics'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-t px-3 py-1.5 capitalize ${
              tab === t
                ? 'border border-b-0 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-semibold'
                : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            {t}
          </button>
        ))}
      </nav>
      {tab === 'settings' ? <SettingsForm /> : <Diagnostics />}
    </div>
  );
}

const container = document.getElementById('root')!;
createRoot(container).render(
  <React.StrictMode>
    <OptionsApp />
  </React.StrictMode>,
);
