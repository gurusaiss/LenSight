import type { CapabilityLevel, ConfidenceLevel, SourceMetadata, SourceType, StructuredDocument } from '../types';

/**
 * Every source-of-content integration (generic web page, selection, and future
 * WhatsApp/Gmail/PDF adapters) implements this same contract, per the
 * architecture spec's "SourceAdapter interface (conceptual)".
 *
 * Only GenericWebAdapter and SelectionAdapter are implemented in this MVP.
 */
export interface SourceAdapter {
  sourceType: SourceType;
  /** Is this adapter applicable to the current page/context? */
  detect(doc: Document): boolean;
  getCapabilityLevel(): CapabilityLevel;
  extractCurrentPage(doc: Document): StructuredDocument | null;
  extractSelection(selection: Selection | null): StructuredDocument | null;
  getMetadata(doc: Document): SourceMetadata;
  getConfidence(): ConfidenceLevel;
}
