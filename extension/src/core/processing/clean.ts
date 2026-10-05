/**
 * Text cleaning/normalization: whitespace collapsing, HTML entity decoding,
 * and light boilerplate-line stripping (nav crumbs, "Cookie Policy" style
 * one-liners that survive DOM stripping in genericWebAdapter).
 */

const ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
  '&mdash;': '—',
  '&ndash;': '–',
  '&hellip;': '…',
};

export function decodeEntities(text: string): string {
  let out = text.replace(/&(amp|lt|gt|quot|#39|apos|nbsp|mdash|ndash|hellip);/g, (m) => ENTITY_MAP[m] ?? m);
  // Numeric entities, decimal (&#8217;) and hex (&#x2019;). DATA-03: this
  // used String.fromCharCode, which truncates astral code points (&#128512;
  // became U+F600 instead of 😀) and ignored hex entities entirely.
  out = out.replace(/&#(?:([0-9]{1,7})|[xX]([0-9a-fA-F]{1,6}));/g, (m, dec, hex) => {
    const code = dec !== undefined ? Number(dec) : parseInt(hex, 16);
    const valid = code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);
    return valid ? String.fromCodePoint(code) : m;
  });
  return out;
}

export function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const BOILERPLATE_LINE_PATTERNS = [
  /^skip to (main )?content$/i,
  /^cookie(s)? (policy|settings|notice)/i,
  /^accept (all )?cookies$/i,
  /^subscribe to our newsletter$/i,
  /^all rights reserved\.?$/i,
  /^©\s?\d{4}/,
  /^sign (in|up)$/i,
  /^advertisement$/i,
];

export function stripBoilerplateLines(text: string): string {
  const lines = text.split('\n');
  const kept = lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return true; // keep blank lines for paragraph structure
    return !BOILERPLATE_LINE_PATTERNS.some((re) => re.test(trimmed));
  });
  return kept.join('\n');
}

/** Full cleaning pipeline applied to raw extracted text before chunking. */
export function cleanText(rawText: string): string {
  const decoded = decodeEntities(rawText);
  const stripped = stripBoilerplateLines(decoded);
  return normalizeWhitespace(stripped);
}
