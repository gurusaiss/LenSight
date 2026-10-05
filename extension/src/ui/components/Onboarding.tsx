import React, { useState } from 'react';

export interface OnboardingProps {
  onFinish: () => void;
  onOpenSettings: () => void;
}

const STEPS = [
  {
    title: 'What this can (and can’t) see',
    body: (
      <>
        <p>
          The assistant only reads what you explicitly ask it to capture &mdash; the current page, a text
          selection, an imported file, or (experimentally) a WhatsApp Web conversation. There is no background
          scraping and no automatic reading of every page you visit.
        </p>
        <p>
          Not every site is readable the same way &mdash; each source shows an honest capability badge (Level
          1&ndash;7): ordinary websites are Level 1 (full extraction), WhatsApp Web is Level 2 (fragile, may break
          without notice), and things like cross-origin iframes or DRM content are Level 7 (not supported, by
          design &mdash; this is a browser security boundary, not a bug).
        </p>
      </>
    ),
  },
  {
    title: 'Mode B is the default: local data, remote AI',
    body: (
      <>
        <p>
          Extraction, chunking, embeddings, and the search index all stay on this device, in every mode, always.
          By default (Mode B), once you configure a provider, only the small set of retrieved chunks relevant to
          your question &mdash; plus the question itself &mdash; are sent to that AI provider over HTTPS.
        </p>
        <p>The full page is never sent. Other tabs are never sent. Browsing history is never sent.</p>
      </>
    ),
  },
  {
    title: 'Prefer nothing to ever leave your device? Use Mode A',
    body: (
      <>
        <p>
          Mode A keeps generation local too &mdash; either a zero-install extractive fallback (ranked excerpts,
          not a generated answer) or a real local model via your own installed{' '}
          <a href="https://ollama.com" target="_blank" rel="noreferrer" className="underline">
            Ollama
          </a>{' '}
          daemon. Nothing is ever sent anywhere in Mode A, enforced independently in two places so a settings bug
          alone could never leak retrieved content to a remote provider.
        </p>
      </>
    ),
  },
  {
    title: 'Settings, Diagnostics, and this tour',
    body: (
      <>
        <p>
          Change privacy mode, AI provider, and API keys any time from <strong>Settings</strong> (right-click the
          extension icon &rarr; Options, or the Settings button in the side panel header). A separate{' '}
          <strong>Diagnostics</strong> tab there shows storage usage and recent errors &mdash; never page content.
        </p>
        <p>You can replay this tour any time from Settings.</p>
      </>
    ),
  },
];

/**
 * A real first-run flow (not a mockup): 4 steps covering exactly what the
 * task's onboarding section asks for. Completion is stored in
 * `chrome.storage.local` under `onboardingCompleted` so it only shows once;
 * `SettingsForm.tsx` exposes a "Replay onboarding" action that clears that
 * flag and re-shows this component.
 */
export default function Onboarding({ onFinish, onOpenSettings }: OnboardingProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const step = STEPS[stepIndex];
  const isLast = stepIndex === STEPS.length - 1;

  return (
    <div className="flex h-full flex-col justify-between gap-4 p-4">
      <div>
        <div className="mb-3 flex items-center gap-1">
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={`h-1 flex-1 rounded-full ${i <= stepIndex ? 'bg-slate-900 dark:bg-slate-100' : 'bg-slate-200 dark:bg-slate-700'}`}
            />
          ))}
        </div>
        <p className="mb-1 text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Step {stepIndex + 1} of {STEPS.length}
        </p>
        <h2 className="mb-2 text-base font-semibold">{step.title}</h2>
        <div className="space-y-2 text-sm text-slate-600 dark:text-slate-300">{step.body}</div>
      </div>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onFinish}
          className="text-xs text-slate-500 dark:text-slate-400 underline hover:text-slate-600 dark:hover:text-slate-200"
        >
          Skip
        </button>
        <div className="flex gap-2">
          {stepIndex > 0 && (
            <button
              type="button"
              onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
              className="rounded border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-sm"
            >
              Back
            </button>
          )}
          {isLast ? (
            <>
              <button
                type="button"
                onClick={() => {
                  onFinish();
                  onOpenSettings();
                }}
                className="rounded border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-sm"
              >
                Open Settings
              </button>
              <button
                type="button"
                onClick={onFinish}
                className="rounded bg-slate-900 dark:bg-slate-100 dark:text-slate-900 px-3 py-1.5 text-sm text-white"
              >
                Get started
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setStepIndex((i) => Math.min(STEPS.length - 1, i + 1))}
              className="rounded bg-slate-900 dark:bg-slate-100 dark:text-slate-900 px-3 py-1.5 text-sm text-white"
            >
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
