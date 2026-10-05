import React from 'react';
import type { PrivacyMode } from '../../core/types';

export interface PrivacyIndicatorProps {
  mode: PrivacyMode;
  providerName: string;
  providerMode: 'local' | 'remote';
  /** Optional: the active embedding provider's name (e.g.
   * 'hashing-bow-v1' or 'transformers-all-MiniLM-L6-v2'), when known, so
   * Mode A can be disclosed honestly — see `guaranteeNote` below. */
  embeddingProviderName?: string;
}

const MODE_LABEL: Record<PrivacyMode, string> = {
  A: 'Mode A — Fully local',
  B: 'Mode B — Local data, remote AI',
  C: 'Mode C — User configured',
};

/** Provider names that represent a real, generative local model — as opposed
 * to the zero-install `extractive-local` fallback, which returns ranked
 * excerpts rather than a generated answer. These are meaningfully different
 * guarantees to disclose honestly (per the task's explicit requirement),
 * even though both are "Mode A" and both keep everything on-device. */
const REAL_LOCAL_MODEL_PROVIDER_NAMES = new Set(['ollama']);
const REAL_LOCAL_EMBEDDING_PROVIDER_NAMES = new Set(['transformers-all-MiniLM-L6-v2']);

/**
 * Always-visible indicator of the active privacy mode and provider, per the
 * spec's "Privacy Indicator ... always visible" requirement. Never hidden
 * behind a settings menu.
 */
export default function PrivacyIndicator({
  mode,
  providerName,
  providerMode,
  embeddingProviderName,
}: PrivacyIndicatorProps) {
  const dotColor = providerMode === 'local' ? 'bg-privacy-local' : 'bg-privacy-remote';

  let modeADetail: string | null = null;
  if (mode === 'A') {
    const hasRealGeneration = REAL_LOCAL_MODEL_PROVIDER_NAMES.has(providerName);
    const hasRealEmbeddings = embeddingProviderName
      ? REAL_LOCAL_EMBEDDING_PROVIDER_NAMES.has(embeddingProviderName)
      : false;
    if (hasRealGeneration && hasRealEmbeddings) {
      modeADetail = 'Real local model: Transformers.js embeddings + Ollama generation.';
    } else if (hasRealGeneration) {
      modeADetail = 'Real local generation (Ollama); embeddings are the no-install hashing fallback.';
    } else if (hasRealEmbeddings) {
      modeADetail = 'Real local semantic embeddings (Transformers.js); generation is the no-install extractive fallback (ranked excerpts, not a generated answer).';
    } else {
      modeADetail = 'No-install local fallback: hashing embeddings + extractive excerpts — not a neural model.';
    }
  }

  return (
    <div className="flex flex-col gap-1 rounded-md border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs">
      <div className="flex items-center gap-2">
        <span className={`inline-block h-2 w-2 rounded-full ${dotColor}`} aria-hidden />
        <span className="font-medium">{MODE_LABEL[mode]}</span>
        <span className="text-slate-500 dark:text-slate-400">
          · provider: {providerName} ({providerMode})
        </span>
      </div>
      {modeADetail && <div className="pl-4 text-slate-500 dark:text-slate-400">{modeADetail}</div>}
    </div>
  );
}
