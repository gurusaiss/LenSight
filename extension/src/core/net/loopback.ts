/** Kept dependency-free so UI bundles (Settings) can import it without
 * pulling in providerSelection's provider graph (and @huggingface/transformers). */

/** True when `url` is an http(s) URL whose host is this machine's loopback
 * interface (localhost, 127.0.0.0/8, ::1). */
export function isLoopbackUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  return host === 'localhost' || host === '[::1]' || host === '::1' || /^127(\.\d{1,3}){3}$/.test(host);
}
