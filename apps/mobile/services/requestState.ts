export type RequestState = 'IDLE' | 'LOADING' | 'SUCCESS' | 'EMPTY' | 'ERROR' | 'UNAVAILABLE' | 'UNAUTHORIZED';
export class ApiError extends Error {
  state: RequestState;
  status: number | null;
  requestId: string;
  constructor(state: RequestState, requestId: string, status: number | null = null) {
    super(`${state === 'UNAUTHORIZED' ? 'Access denied. Sign in or check your permissions.' : state === 'UNAVAILABLE' ? 'Service unavailable. Check your connection and retry.' : 'The service returned an invalid response.'} Reference: ${requestId}`);
    this.state = state; this.status = status; this.requestId = requestId;
  }
}
export const stateForStatus = (status: number): RequestState => status === 401 || status === 403 ? 'UNAUTHORIZED' : status === 404 || status === 429 || status >= 500 ? 'UNAVAILABLE' : 'ERROR';
export interface RequestDiagnostic { requestId: string; status: number | null; attempt: number; }
const diagnostics: RequestDiagnostic[] = [];
export const getRequestDiagnostics = () => diagnostics.map(event => ({ ...event }));
function recordDiagnostic(event: RequestDiagnostic, observer?: (event: RequestDiagnostic) => void) {
  diagnostics.push({ ...event });
  if (diagnostics.length > 50) diagnostics.shift();
  try { observer?.({ ...event }); } catch { /* diagnostics cannot affect requests */ }
}
let sequence = 0;
// IDs contain no account, device, path, payload or credentials.
const correlationId = () => `req-${Date.now().toString(36)}-${(++sequence).toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
export function createTransport(transport: typeof fetch, options: { timeoutMs?: number; delay?: (ms: number) => Promise<void>; diagnostic?: (event: { requestId: string; status: number | null; attempt: number }) => void } = {}) {
  const flights = new Map<string, Promise<Response>>();
  return async (url: string, init: RequestInit = {}): Promise<Response> => {
    const safe = (init.method ?? 'GET').toUpperCase() === 'GET';
    const headers = new Headers(init.headers);
    // Map is instance-local, transient, and includes credentials to prevent cross-session sharing.
    const key = JSON.stringify([url, [...headers.entries()], init.cache]);
    const execute = async () => {
      const requestId = correlationId();
      headers.set('x-request-id', requestId);
      for (let attempt = 0; ; attempt++) {
        const controller = new AbortController();
        const abort = () => controller.abort();
        init.signal?.addEventListener('abort', abort, { once: true });
        if (init.signal?.aborted) controller.abort();
        const timer = setTimeout(() => { controller.abort(); }, options.timeoutMs ?? 20000);
        let response: Response;
        try {
          response = await transport(url, { ...init, headers, redirect: 'error', signal: controller.signal });
        } catch {
          recordDiagnostic({ requestId, status: null, attempt }, options.diagnostic);
          throw new ApiError('UNAVAILABLE', requestId);
        } finally { clearTimeout(timer); init.signal?.removeEventListener('abort', abort); }
        recordDiagnostic({ requestId, status: response.status, attempt }, options.diagnostic);
        if (safe && !init.signal?.aborted && attempt < 2 && [429, 500, 502, 503, 504].includes(response.status)) {
          const raw = response.headers.get('retry-after');
          const delay = raw === null ? 250 * 2 ** attempt : /^\d+$/.test(raw) ? Number(raw) * 1000 : Date.parse(raw) - Date.now();
          // Never retry early when the server asks for a longer backoff.
          if (!Number.isFinite(delay) || delay > 2000) return response;
          await response.body?.cancel();
          await (options.delay ?? (ms => new Promise(resolve => setTimeout(resolve, ms))))(Math.max(0, delay));
          continue;
        }
        const returned = new Response(response.body, { status: response.status, statusText: response.statusText, headers: response.headers });
        returned.headers.set('x-kicks-request-id', requestId);
        return returned;
      }
    };
    // Requests with caller cancellation are not shared.
    if (!safe || init.signal) return execute();
    let flight = flights.get(key);
    if (!flight) {
      flight = execute(); flights.set(key, flight);
      void flight.finally(() => { if (flights.get(key) === flight) flights.delete(key); }).catch(() => {});
    }
    return (await flight).clone();
  };
}
export async function parseResponse(response: Response, validate: (value: any) => boolean): Promise<any> {
  const requestId = (response.headers.get('x-kicks-request-id') ?? response.headers.get('x-request-id'))?.match(/^[a-zA-Z0-9_-]{1,80}$/)?.[0] ?? correlationId();
  if (!response.ok) throw new ApiError(stateForStatus(response.status), requestId, response.status);
  let value;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { value = await Promise.race([response.json(), new Promise((_, reject) => {
    timer = setTimeout(() => reject(new ApiError('UNAVAILABLE', requestId)), 20000);
  })]); } catch (error) { throw error instanceof ApiError ? error : new ApiError('ERROR', requestId, response.status); } finally { clearTimeout(timer); }
  try { if (!validate(value)) throw new Error(); } catch { throw new ApiError('ERROR', requestId, response.status); }
  return value;
}
export const isObject = (value: any) => value !== null && typeof value === 'object' && !Array.isArray(value);
export const validWallet = (value: any) => isObject(value) && ['total_earned', 'total_pending', 'total_settled'].every(key => typeof value[key] === 'number' && Number.isFinite(value[key]));

export interface CachedValue<T> { account: object; data: T; at: number; }
export function visibleCache<T>(cache: CachedValue<T> | null, account: object | null, now = Date.now()): T | null {
  return cache && cache.account === account && now >= cache.at && now - cache.at < 300000 ? cache.data : null;
}
