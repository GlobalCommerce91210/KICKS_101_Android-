import { existsSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

/** SPA fallback is for app routes only; missing APIs must remain JSON 404s. */
export function resolveStaticAsset(directory: string, requestUrl: string): string | null {
  let pathname: string;
  try { pathname = decodeURIComponent(requestUrl.split('?')[0] ?? ''); }
  catch { return null; }
  if (/^\/(?:v1|core|api)(?:\/|$)/.test(pathname) || pathname.includes('\0')) return null;
  const segments = pathname.split(/[\\/]/);
  if (segments.includes('..')) return null;
  const root = resolve(directory);
  const candidate = resolve(root, segments.filter(Boolean).join('/'));
  const offset = relative(root, candidate);
  if (isAbsolute(offset) || offset === '..' || offset.startsWith('../') || offset.startsWith('..\\')) return null;
  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  const index = join(root, 'index.html');
  return existsSync(index) ? index : null;
}
