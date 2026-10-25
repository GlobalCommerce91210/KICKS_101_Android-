export type ConsentAction = 'grant' | 'deny' | 'revoke';

export interface ConsentDecisionRequest {
  permissionId: string;
  requestId: string;
  expectedEventSequence: number;
  action: ConsentAction;
  policyVersion: string;
  purposeVersion: string;
  purpose: string;
}

export interface ConsentDecisionResponse extends ConsentDecisionRequest {
  id: string;
  eventSequence?: number;
  occurredAt: string;
  status: 'accepted';
  idempotentReplay?: boolean;
}

export interface ConsentHistoryEvent extends ConsentDecisionRequest {
  id: string;
  eventSequence?: number;
  occurredAt: string;
}

export interface ConsentHistoryResponse {
  permissionId: string;
  events: ConsentHistoryEvent[];
}

export interface ConsentSession {
  subjectId: string;
  deviceToken: string;
}

export type ConsentSessionProvider = () => Promise<ConsentSession | null>;

export class ConsentApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
    readonly code?: string
  ) {
    super(message);
    this.name = 'ConsentApiError';
  }
}

let sessionProvider: ConsentSessionProvider | null = null;

/** The authenticated app session must register its secure device-token provider. */
export function setConsentSessionProvider(provider: ConsentSessionProvider | null): void {
  sessionProvider = provider;
}

export async function getConsentSession(): Promise<ConsentSession | null> {
  if (!sessionProvider) return null;
  const session = await sessionProvider();
  if (!session?.deviceToken || !isUuid(session.subjectId)) return null;
  return session;
}

export function getConsentApiBaseUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin;
  throw new ConsentApiError('The consent service is not configured.', 0, false, 'service_unconfigured');
}

/** UUIDs identify stable choices; they are not authentication credentials. */
export function stableConsentUuid(...parts: string[]): string {
  const input = parts.join('\u001f');
  const seeds = [2166136261, 2246822519, 3266489917, 668265263];
  const words = seeds.map(seed => {
    let hash = seed >>> 0;
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 16777619) >>> 0;
      hash = (hash ^ (hash >>> 13)) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  });
  const hex = words.join('').split('');
  hex[12] = '5';
  hex[16] = ((parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16);
  const value = hex.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export function stableConsentRequestId(
  permissionId: string,
  expectedEventSequence: number,
  action: ConsentAction,
  policyVersion: string,
  purposeVersion: string
): string {
  return stableConsentUuid(
    'kicks-consent-request-v1',
    permissionId,
    String(expectedEventSequence),
    action,
    policyVersion,
    purposeVersion
  );
}

const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function assertSecureRequest(apiBaseUrl: string, deviceToken: string, permissionId: string): void {
  if (!apiBaseUrl.startsWith('https://')) {
    throw new ConsentApiError('Consent API must use HTTPS.', 0, false, 'https_required');
  }
  if (!deviceToken || !isUuid(permissionId)) {
    throw new ConsentApiError('An authenticated device session and UUID permission ID are required.', 0, false, 'identity_required');
  }
}

function authHeaders(deviceToken: string, json = false): Record<string, string> {
  return {
    authorization: 'Bearer ' + deviceToken,
    ...(json ? { 'content-type': 'application/json' } : {})
  };
}

export async function getConsentHistory(
  apiBaseUrl: string,
  deviceToken: string,
  permissionId: string
): Promise<ConsentHistoryResponse> {
  assertSecureRequest(apiBaseUrl, deviceToken, permissionId);
  let response: Response;
  try {
    response = await fetch(
      `${apiBaseUrl.replace(/\/+$/, '')}/v1/consent-events/${encodeURIComponent(permissionId)}`,
      { headers: authHeaders(deviceToken) }
    );
  } catch (error) {
    throw new ConsentApiError(
      'Consent history is offline. Previously confirmed history is unchanged.',
      503,
      true,
      error instanceof Error ? error.message : 'network_unavailable'
    );
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string; retryable?: boolean };
    throw new ConsentApiError(
      payload.error ?? `Consent history could not be read (HTTP ${response.status}).`,
      response.status,
      response.status === 503 && payload.retryable === true,
      payload.error
    );
  }
  const data: unknown = await response.json();
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new ConsentApiError('Consent history response was invalid.', 502, false, 'invalid_history');
  }
  const payload = data as Partial<ConsentHistoryResponse>;
  if (payload.permissionId !== permissionId || !Array.isArray(payload.events)) {
    throw new ConsentApiError('Consent history response was invalid.', 502, false, 'invalid_history');
  }
  const eventIds = new Set<string>();
  const requestIds = new Set<string>();
  let previousSequence = 0;
  const events = payload.events.map((event, index) => {
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
      throw new ConsentApiError(`Consent history event ${index} is malformed.`, 502, false, 'invalid_history');
    }
    const candidate = event as Partial<ConsentHistoryEvent>;
    const validPurpose = typeof candidate.purpose === 'string' &&
      candidate.purpose.trim().length >= 3 && candidate.purpose.length <= 120;
    const validPolicyVersion = typeof candidate.policyVersion === 'string' &&
      candidate.policyVersion.trim().length > 0 && candidate.policyVersion.length <= 64;
    const validPurposeVersion = typeof candidate.purposeVersion === 'string' &&
      candidate.purposeVersion.trim().length > 0 && candidate.purposeVersion.length <= 64;
    const validAction = candidate.action === 'grant' || candidate.action === 'deny' || candidate.action === 'revoke';
    const validSequence = Number.isInteger(candidate.expectedEventSequence) &&
      Number.isInteger(candidate.eventSequence) &&
      (candidate.expectedEventSequence as number) === previousSequence &&
      candidate.eventSequence === previousSequence + 1;
    const validTimestamp = typeof candidate.occurredAt === 'string' &&
      Number.isFinite(Date.parse(candidate.occurredAt));
    if (
      candidate.permissionId !== permissionId ||
      typeof candidate.requestId !== 'string' || !isUuid(candidate.requestId) ||
      typeof candidate.id !== 'string' || !isUuid(candidate.id) ||
      !validAction || !validPurpose || !validPolicyVersion || !validPurposeVersion ||
      !validSequence || !validTimestamp ||
      eventIds.has(candidate.id) || requestIds.has(candidate.requestId)
    ) {
      throw new ConsentApiError(`Consent history event ${index} is incomplete or inconsistent.`, 502, false, 'invalid_history');
    }
    previousSequence = candidate.eventSequence as number;
    eventIds.add(candidate.id);
    requestIds.add(candidate.requestId);
    return candidate as ConsentHistoryEvent;
  });
  return { permissionId, events };
}

/**
 * Retries use the exact same request ID and payload. The caller retains both
 * until the server confirms the persisted event; a timeout is never a grant.
 */
export async function recordConsentDecision(
  apiBaseUrl: string,
  deviceToken: string,
  decision: ConsentDecisionRequest
): Promise<ConsentDecisionResponse> {
  assertSecureRequest(apiBaseUrl, deviceToken, decision.permissionId);
  if (!isUuid(decision.requestId)) {
    throw new ConsentApiError('A stable UUID request ID is required.', 0, false, 'identity_required');
  }

  const url = `${apiBaseUrl.replace(/\/+$/, '')}/v1/consent-events`;
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: authHeaders(deviceToken, true),
        body: JSON.stringify(decision)
      });
      if (response.status === 202) {
        return await response.json() as ConsentDecisionResponse;
      }

      const payload = await response.json().catch(() => ({})) as { error?: string; retryable?: boolean };
      const retryable = response.status === 503 && payload.retryable === true;
      if (!retryable || attempt === 2) {
        throw new ConsentApiError(
          payload.error ?? `Consent decision rejected (HTTP ${response.status}).`,
          response.status,
          retryable,
          payload.error
        );
      }
      const retryAfter = Number(response.headers.get('retry-after') ?? '1');
      const baseDelay = Number.isFinite(retryAfter) ? Math.max(1000, retryAfter * 1000) : 1000;
      await pause(Math.min(8000, baseDelay * (2 ** attempt)) + Math.floor(Math.random() * 251));
    } catch (error) {
      if (error instanceof ConsentApiError) throw error;
      lastError = error;
      if (attempt === 2) break;
      await pause(Math.min(8000, 1000 * (2 ** attempt)) + Math.floor(Math.random() * 251));
    }
  }

  throw new ConsentApiError(
    'Consent persistence could not be confirmed. Keep the same request ID and retry after service recovery.',
    503,
    true,
    lastError instanceof Error ? lastError.message : 'network_unavailable'
  );
}
