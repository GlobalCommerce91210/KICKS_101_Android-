import { getConsentApiBaseUrl, setConsentSessionProvider } from './consentApi';
import type { ConsentSession } from './consentApi';
import {
  deviceCredentialStorage,
  isValidDeviceCredentials
} from './deviceCredentialStorage';
import type { DeviceCredentialStorage, DeviceCredentials } from './deviceCredentialStorage';

export type IdentityTokenProvider = () => Promise<string | null>;
export type DeviceSession = DeviceCredentials;

export interface LogoutResult {
  remoteRevocationConfirmed: boolean;
}

export class DeviceSessionError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 0
  ) {
    super(message);
    this.name = 'DeviceSessionError';
  }
}

type ApiBaseUrlProvider = () => string;
type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function isUuid(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function responseObject(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await response.json();
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

export class DeviceSessionManager {
  private identityTokenProvider: IdentityTokenProvider | null = null;
  private enrollmentInFlight: Promise<DeviceSession> | null = null;

  constructor(
    private readonly storage: DeviceCredentialStorage = deviceCredentialStorage,
    private readonly apiBaseUrl: ApiBaseUrlProvider = getConsentApiBaseUrl,
    private readonly fetcher: Fetcher = (input, init) => fetch(input, init)
  ) {}

  setIdentityTokenProvider(provider: IdentityTokenProvider | null): void {
    this.identityTokenProvider = provider;
  }

  hasIdentityTokenProvider(): boolean {
    return this.identityTokenProvider !== null;
  }

  async hasStoredSession(): Promise<boolean> {
    const credentials = await this.storage.read();
    return isValidDeviceCredentials(credentials);
  }

  async restoreSession(): Promise<DeviceSession | null> {
    const credentials = await this.storage.read();
    if (!credentials) return null;
    if (!isValidDeviceCredentials(credentials)) {
      await this.storage.clear();
      return null;
    }

    const response = await this.request('/v1/devices/session', {
      method: 'GET',
      headers: { authorization: 'Bearer ' + credentials.deviceToken, accept: 'application/json' }
    });
    const payload = await responseObject(response);
    if (response.status === 401 || isRevokedPayload(payload)) {
      await this.storage.clear();
      return null;
    }
    if (!response.ok) {
      throw new DeviceSessionError(
        'The saved device session could not be verified.',
        'session_verification_failed',
        response.status
      );
    }
    if (
      !payload ||
      !isUuid(payload.deviceId) ||
      !isUuid(payload.subjectId) ||
      payload.deviceId !== credentials.deviceId ||
      payload.subjectId !== credentials.subjectId
    ) {
      await this.storage.clear();
      throw new DeviceSessionError('The device session response was invalid.', 'invalid_session_response', 502);
    }
    return credentials;
  }

  enrollDevice(): Promise<DeviceSession> {
    if (this.enrollmentInFlight) return this.enrollmentInFlight;
    const enrollment = this.enrollDeviceOnce();
    this.enrollmentInFlight = enrollment;
    void enrollment.finally(() => {
      if (this.enrollmentInFlight === enrollment) this.enrollmentInFlight = null;
    }).catch(() => undefined);
    return enrollment;
  }

  private async enrollDeviceOnce(): Promise<DeviceSession> {
    const existing = await this.restoreSession();
    if (existing) return existing;

    if (!this.identityTokenProvider) {
      throw new DeviceSessionError(
        'Login and device enrollment are unavailable until an identity token provider is registered.',
        'identity_provider_unavailable'
      );
    }
    const identityToken = await this.identityTokenProvider();
    if (
      !identityToken ||
      !identityToken.trim() ||
      identityToken !== identityToken.trim() ||
      /[\s\u0000-\u001f\u007f]/.test(identityToken)
    ) {
      throw new DeviceSessionError('The identity provider did not supply a valid ID token.', 'identity_token_unavailable');
    }

    const response = await this.request('/v1/devices/enroll', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + identityToken,
        accept: 'application/json'
      }
    });
    const payload = await responseObject(response);
    if (!response.ok) {
      throw new DeviceSessionError(
        'Device enrollment was not accepted.',
        'device_enrollment_failed',
        response.status
      );
    }
    if (
      !payload ||
      !isUuid(payload.deviceId) ||
      !isUuid(payload.subjectId) ||
      payload.tokenType !== 'Bearer' ||
      typeof payload.token !== 'string'
    ) {
      throw new DeviceSessionError('The enrollment response was invalid.', 'invalid_enrollment_response', 502);
    }
    const credentials: DeviceSession = {
      deviceId: payload.deviceId,
      subjectId: payload.subjectId,
      deviceToken: payload.token
    };
    if (!isValidDeviceCredentials(credentials)) {
      throw new DeviceSessionError('The enrollment response contained invalid credentials.', 'invalid_enrollment_response', 502);
    }
    await this.storage.write(credentials);
    return credentials;
  }

  async logout(): Promise<LogoutResult> {
    let remoteRevocationConfirmed = false;
    try {
      const credentials = await this.storage.read();
      if (credentials && isValidDeviceCredentials(credentials)) {
        try {
          const response = await this.request('/v1/devices/revoke', {
            method: 'POST',
            headers: { authorization: 'Bearer ' + credentials.deviceToken, accept: 'application/json' }
          });
          const payload = await responseObject(response);
          remoteRevocationConfirmed = response.status === 200 &&
            !!payload &&
            payload.deviceId === credentials.deviceId &&
            payload.revoked === true;
        } catch {
          remoteRevocationConfirmed = false;
        }
      }
    } catch {
      remoteRevocationConfirmed = false;
    } finally {
      await this.storage.clear();
    }
    return { remoteRevocationConfirmed };
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    let baseUrl: string;
    try {
      baseUrl = this.apiBaseUrl().replace(/\/+$/, '');
    } catch {
      throw new DeviceSessionError('The device session service is not configured.', 'service_unconfigured');
    }
    if (!/^https:\/\//i.test(baseUrl)) {
      throw new DeviceSessionError('Device session requests require HTTPS.', 'https_required');
    }
    try {
      return await this.fetcher(`${baseUrl}${path}`, init);
    } catch {
      throw new DeviceSessionError('The device session service is unavailable.', 'network_unavailable', 503);
    }
  }
}

function isRevokedPayload(payload: Record<string, unknown> | null): boolean {
  if (!payload) return false;
  if (payload.revoked === true || payload.active === false) return true;
  const reason = typeof payload.error === 'string'
    ? payload.error
    : typeof payload.code === 'string' ? payload.code : '';
  return /revok|unauthorized/i.test(reason);
}

const deviceSessionManager = new DeviceSessionManager();

export function setIdentityTokenProvider(provider: IdentityTokenProvider | null): void {
  deviceSessionManager.setIdentityTokenProvider(provider);
}

export function isIdentityTokenProviderRegistered(): boolean {
  return deviceSessionManager.hasIdentityTokenProvider();
}

export function hasStoredDeviceSession(): Promise<boolean> {
  return deviceSessionManager.hasStoredSession();
}

export function enrollDevice(): Promise<DeviceSession> {
  return deviceSessionManager.enrollDevice();
}

export function restoreDeviceSession(): Promise<DeviceSession | null> {
  return deviceSessionManager.restoreSession();
}

export function logoutDevice(): Promise<LogoutResult> {
  return deviceSessionManager.logout();
}

export function bootstrapDeviceSession(): void {
  setConsentSessionProvider(async (): Promise<ConsentSession | null> => {
    const session = await restoreDeviceSession();
    if (!session) return null;
    return { subjectId: session.subjectId, deviceToken: session.deviceToken };
  });
}
