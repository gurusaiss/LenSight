import React, { useState } from 'react';
import type { Citation } from '../../core/types';
import type { AskResultUI } from '../hooks/useAssistant';
import CitationLink from './CitationLink';

export interface ChatBoxProps {
  onAsk: (question: string) => Promise<AskResultUI | null>;
  isAsking: boolean;
  lastAnswer: AskResultUI | null;
  onOpenCitation?: (citation: Citation) => void;
}

/** Ask box + answer display + citation links. Clearly labels Basic Local
 * Mode answers as such (never presented as a full LLM answer) — see
 * extractiveLocalProvider.ts. */
export default function ChatBox({ onAsk, isAsking, lastAnswer, onOpenCitation }: ChatBoxProps) {
  const [question, setQuestion] = useState('');

  const submit = async () => {
    const q = question.trim();
    // FUN-07: Enter used to bypass the disabled Ask button and fire
    // duplicate concurrent requests while one was still in flight.
    if (!q || isAsking) return;
    await onAsk(q);
  };

  const isBasicLocal = lastAnswer?.providerName === 'extractive-local';

  return (
    <div className="flex flex-1 flex-col gap-2">
      <div
        className="flex-1 overflow-y-auto rounded-md border border-slate-200 dark:border-slate-700 p-3 text-sm"
        aria-live="polite"
        aria-busy={isAsking}
        aria-label="Answer"
        role="region"
      >
        {lastAnswer ? (
          <div className="space-y-2">
            {isBasicLocal && (
              <div className="rounded bg-amber-100 dark:bg-amber-900 px-2 py-1 text-xs text-amber-800 dark:text-amber-200">
                Basic local mode — no AI model configured. This is an extractive result (top matching
                excerpts), not a generated answer. For real generation, choose Ollama (stays on this device,
                allowed in Mode A) or a remote provider (Gemini / OpenAI-compatible, Mode B/C) in Settings.
              </div>
            )}
            <p className="whitespace-pre-wrap">{lastAnswer.answer}</p>
            {lastAnswer.citations.length > 0 && (
              <div className="space-y-1">
                <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400">Sources</h3>
                {lastAnswer.citations.map((c) => (
                  <CitationLink key={c.chunkId} citation={c} onOpen={onOpenCitation} />
                ))}
              </div>
            )}
          </div>
        ) : (
          <p className="text-slate-500 dark:text-slate-400">Capture a page or selection, then ask a question about it.</p>
        )}
      </div>
      <div className="flex gap-2">
        <label htmlFor="chat-question-input" className="sr-only">
          Question about the captured content
        </label>
        <input
          id="chat-question-input"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit();
          }}
          maxLength={4000}
          placeholder="Ask about the captured content…"
          className="flex-1 rounded border border-slate-300 dark:border-slate-600 bg-transparent px-2 py-1 text-sm"
        />
        <button
          type="button"
          onClick={submit}
          disabled={isAsking}
          className="rounded bg-slate-900 dark:bg-slate-100 dark:text-slate-900 px-3 py-1 text-sm text-white disabled:opacity-50"
        >
          {isAsking ? 'Asking…' : 'Ask'}
        </button>
      </div>
    </div>
  );
}
