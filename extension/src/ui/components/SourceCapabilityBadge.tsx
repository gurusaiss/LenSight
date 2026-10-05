import React from 'react';
import type { CapabilityLevel, ConfidenceLevel } from '../../core/types';

const LEVEL_LABEL: Record<CapabilityLevel, string> = {
  1: 'L1 — Full DOM extraction',
  2: 'L2 — Adapter (some fragility)',
  3: 'L3 — Selection-based',
  4: 'L4 — Screenshot + OCR',
  5: 'L5 — File import',
  6: 'L6 — Desktop integration',
  7: 'L7 — Unsupported',
};

const LEVEL_COLOR: Record<CapabilityLevel, string> = {
  1: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  2: 'bg-lime-100 text-lime-800 dark:bg-lime-900 dark:text-lime-200',
  3: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  4: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  5: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  6: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  7: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
};

/**
 * Honestly shows the current page's capability level (L1-L7) — never a
 * generic "AI is reading this page" claim regardless of true level, per the
 * spec's "UX fallback rule".
 */
export default function SourceCapabilityBadge({
  level,
  confidence,
}: {
  level: CapabilityLevel;
  confidence: ConfidenceLevel;
}) {
  return (
    <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ${LEVEL_COLOR[level]}`}>
      {LEVEL_LABEL[level]}
      {/* A11Y-05: was opacity-70, which axe-core measured below 4.5:1 on the light badge colours. */}
      <span className="font-normal">· confidence: {confidence}</span>
    </span>
  );
}
