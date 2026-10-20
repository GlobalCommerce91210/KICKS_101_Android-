import { createHash } from 'node:crypto';
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).filter(([,v]) => v !== undefined)
    .sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0).map(([k,v]) => JSON.stringify(k) + ':' + canonicalJson(v)).join(',') + '}';
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw Error('invalid_batch_value');
  return encoded;
}
export const batchDigest = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
