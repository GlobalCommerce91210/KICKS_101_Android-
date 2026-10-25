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

const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * Records one consent decision using the same requestId and exact payload for
 * every retry. Callers must retain requestId + payload until the server returns
 * the persisted event; never mint a replacement ID after a timeout.
 */
export async function recordConsentDecision(
  apiBaseUrl: string,
  deviceToken: string,
  decision: ConsentDecisionRequest
): Promise<ConsentDecisionResponse> {
  if (!apiBaseUrl.startsWith('https://')) {
    throw new ConsentApiError('Consent API must use HTTPS.', 0, false, 'https_required');
  }
  if (!deviceToken || !decision.requestId || !decision.permissionId) {
    throw new ConsentApiError('Device identity and stable request ID are required.', 0, false, 'identity_required');
  }

  const url = `${apiBaseUrl.replace(/\/+$/, '')}/v1/consent-events`;
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${deviceToken}`,
          'content-type': 'application/json'
        },
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
      const backoff = Math.min(8000, Math.max(1000, retryAfter * 1000) * (2 ** attempt));
      await pause(backoff + Math.floor(Math.random() * 251));
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
