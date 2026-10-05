import type { EmbeddingProvider } from './EmbeddingProvider';

/**
 * DEFAULT embedding provider — no network access, no model download.
 *
 * This is a deterministic feature-hashing / bag-of-words embedding, not a
 * learned neural embedding. It works by:
 *   1. Tokenizing text into lowercase word tokens (plus word bigrams for a
 *      little more phrase-level signal than unigrams alone).
 *   2. Hashing each token into one of `dimensions` buckets with a signed
 *      hashing trick (the classic "hashing vectorizer" approach), which
 *      keeps the vector fixed-size regardless of vocabulary size.
 *   3. Weighting each bucket by term frequency (TF), with common stopwords
 *      down-weighted so that shared function words don't dominate similarity.
 *   4. L2-normalizing the final vector so cosine similarity reduces to a dot
 *      product and is comparable across texts of different lengths.
 *
 * This is intentionally simple and fully offline. It will not capture deep
 * semantic/synonym relationships the way a trained sentence embedding model
 * would (see transformersEmbeddingProvider.ts for that upgrade path), but it
 * reliably ranks lexically-overlapping, topically-similar short texts above
 * unrelated ones — which is what tests/unit/hashingEmbeddingProvider.test.ts
 * verifies.
 */

const DEFAULT_DIMENSIONS = 256;

const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'of', 'to', 'in', 'on', 'for', 'and', 'or', 'but', 'with', 'as', 'at',
  'by', 'from', 'that', 'this', 'these', 'those', 'it', 'its', 'into',
  'about', 'if', 'then', 'than', 'so', 'such', 'not', 'no', 'do', 'does',
  'did', 'has', 'have', 'had', 'can', 'could', 'will', 'would', 'should',
  'i', 'you', 'he', 'she', 'we', 'they', 'them', 'his', 'her', 'our', 'your',
]);

function tokenize(text: string): string[] {
  const words = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .match(/[a-z0-9]+/g);
  return words ?? [];
}

/** 32-bit FNV-1a hash — fast, deterministic, good bit distribution. */
function fnv1a(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function hashToBucketAndSign(token: string, dimensions: number): { bucket: number; sign: number } {
  const h = fnv1a(token);
  const bucket = h % dimensions;
  // Use a second, independent-ish bit of the hash to decide sign, which is
  // what keeps hashed-feature collisions from systematically inflating
  // magnitude (standard "signed hashing trick").
  const sign = (h & 0x1) === 0 ? 1 : -1;
  return { bucket, sign };
}

export function embedTextSync(text: string, dimensions: number = DEFAULT_DIMENSIONS): Float32Array {
  const vector = new Float32Array(dimensions);
  const tokens = tokenize(text);
  if (tokens.length === 0) return vector;

  const addToken = (token: string, weight: number) => {
    const { bucket, sign } = hashToBucketAndSign(token, dimensions);
    vector[bucket] += sign * weight;
  };

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    const weight = STOPWORDS.has(token) ? 0.25 : 1;
    addToken(token, weight);

    if (i < tokens.length - 1) {
      const bigram = `${token}_${tokens[i + 1]}`;
      addToken(bigram, weight * 0.5);
    }
  }

  // L2 normalize.
  let norm = 0;
  for (let i = 0; i < dimensions; i += 1) norm += vector[i] * vector[i];
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < dimensions; i += 1) vector[i] /= norm;
  }
  return vector;
}

export class HashingEmbeddingProvider implements EmbeddingProvider {
  name = 'hashing-bow-v1';
  modelId = 'hashing-bow-v1';
  dimensions: number;

  constructor(dimensions: number = DEFAULT_DIMENSIONS) {
    this.dimensions = dimensions;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map((t) => embedTextSync(t, this.dimensions));
  }
}

export const hashingEmbeddingProvider = new HashingEmbeddingProvider();
