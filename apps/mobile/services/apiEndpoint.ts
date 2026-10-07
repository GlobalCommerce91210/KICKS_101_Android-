export function resolveApiBaseUrl(platform: string, configured: string | undefined, webOrigin?: string): string {
  if (configured?.trim()) {
    let url: URL;
    try { url = new URL(configured.trim()); }
    catch { throw new Error('API address is invalid.'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      throw new Error('API address must use HTTPS without credentials, query parameters, or fragments.');
    }
    if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase())) {
      throw new Error('API address must point to a reachable service.');
    }
    return url.toString().replace(/\/$/, '');
  }
  if (platform === 'web' && webOrigin) return webOrigin;
  throw new Error('The beta API is not connected on this device.');
}
