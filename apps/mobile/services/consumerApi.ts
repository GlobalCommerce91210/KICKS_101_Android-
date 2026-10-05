/**
 * KICK'S Consumer App API v1 client.
 *
 * Source contract: KICK'S – Consumer App API, OpenAPI 3.1.0.
 *
 * Integration boundary:
 * - DataStorm remains the owner of consumer identity/session lifecycle.
 * - This client accepts an access-token provider and does not persist credentials.
 * - Existing 0.2.6 /v1 wallet, permissions, and intelligence services remain unchanged.
 * - Consumer webhooks are represented as types only; a mobile client must not act as
 *   the webhook receiver.
 */

export const KICKS_CONSUMER_API_PRODUCTION = 'https://api.kicks.app';
export const KICKS_CONSUMER_API_SANDBOX = 'https://sandbox.kicks.app';

export type SocialPlatform =
  | 'facebook'
  | 'instagram'
  | 'tiktok'
  | 'x'
  | 'youtube'
  | 'telegram'
  | 'snapchat'
  | 'reddit'
  | 'discord';

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RefreshRequest {
  refreshToken: string;
}

export interface AuthToken {
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
}

export interface SocialLink {
  platform?: SocialPlatform;
  handle?: string;
  verified?: boolean;
}

export interface SocialLinkRequest {
  links: SocialLink[];
}

export interface KICBalance {
  consumerId?: string;
  available?: number;
  reserved?: number;
  unit?: string;
}

export interface ConsumerProfile {
  id?: string;
  displayName?: string;
  regionCode?: string;
  socialLinks?: SocialLink[];
  kicBalance?: KICBalance;
}

export type RegionalPackageType =
  | 'lifestyle'
  | 'influence'
  | 'consumption'
  | 'sentiment'
  | 'cultural'
  | 'movement';

export interface RegionalPackageCreate {
  regionCode: string;
  type: RegionalPackageType;
  signals: string[];
}

export interface RegionalPackage {
  id?: string;
  consumerId?: string;
  regionCode?: string;
  type?: string;
  signals?: string[];
  createdAt?: string;
}

export interface Cohort {
  id?: string;
  name?: string;
  scope?: 'regional';
  regionCode?: string;
  size?: number;
  specialization?: string;
  stabilityScore?: number;
  diversityScore?: number;
}

export interface CohortMembership {
  cohortId?: string;
  consumerId?: string;
  joinedAt?: string;
}

export type KICTransactionType = 'accrual' | 'redemption' | 'adjustment';

export interface KICTransaction {
  id?: string;
  type?: KICTransactionType;
  amount?: number;
  createdAt?: string;
  source?: string;
  metadata?: Record<string, unknown>;
}

export interface AccrualOpportunity {
  id?: string;
  description?: string;
  kicReward?: number;
  expiresAt?: string;
}

export interface MarketplaceItem {
  id?: string;
  name?: string;
  category?: string;
  kicPrice?: number;
  inStock?: boolean;
}

export interface MarketplaceOrderCreate {
  itemId: string;
  quantity: number;
  shippingAddress?: Record<string, unknown>;
}

export type MarketplaceOrderStatus =
  | 'pending'
  | 'confirmed'
  | 'shipped'
  | 'delivered'
  | 'cancelled';

export interface MarketplaceOrder {
  id?: string;
  consumerId?: string;
  items?: MarketplaceItem[];
  totalKIC?: number;
  status?: MarketplaceOrderStatus;
}

export type QuantumInsightAltitude =
  | 'regional'
  | 'partner'
  | 'national'
  | 'global'
  | 'quantum';

export interface QuantumInsightLevel {
  id?: string;
  name?: string;
  altitude?: QuantumInsightAltitude;
  metrics?: Record<string, unknown>;
}

export interface QuantumInsightSet {
  consumerId?: string;
  levels?: QuantumInsightLevel[];
}

export interface KICWebhookEvent {
  eventId?: string;
  type?: 'kic.accrued' | 'kic.redeemed';
  transaction?: KICTransaction;
  occurredAt?: string;
}

export interface OrderWebhookEvent {
  eventId?: string;
  type?: 'order.status.changed';
  order?: MarketplaceOrder;
  occurredAt?: string;
}

export type ConsumerEventChannel = 'kic' | 'cohorts' | 'insights';

export type AccessTokenProvider = () =>
  | string
  | null
  | undefined
  | Promise<string | null | undefined>;

export interface ConsumerApiClientOptions {
  /**
   * Defaults to the OpenAPI sandbox server to avoid accidental production writes.
   * Production must be selected explicitly by configuration.
   */
  baseUrl?: string;
  getAccessToken?: AccessTokenProvider;
  fetchImpl?: typeof fetch;
}

export class ConsumerApiError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, message: string, body = '') {
    super(message);
    this.name = 'ConsumerApiError';
    this.status = status;
    this.body = body;
  }
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function resolveConfiguredBaseUrl(): string | undefined {
  const root = globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  };
  return root.process?.env?.EXPO_PUBLIC_KICKS_CONSUMER_API_URL;
}

function toWebSocketBase(baseUrl: string): string {
  if (baseUrl.startsWith('https://')) return 'wss://' + baseUrl.slice('https://'.length);
  if (baseUrl.startsWith('http://')) return 'ws://' + baseUrl.slice('http://'.length);
  return baseUrl;
}

export function createConsumerApiClient(options: ConsumerApiClientOptions = {}) {
  const baseUrl = stripTrailingSlash(
    options.baseUrl ??
      resolveConfiguredBaseUrl() ??
      KICKS_CONSUMER_API_SANDBOX
  );
  const fetchImpl = options.fetchImpl ?? fetch;

  async function accessToken(): Promise<string> {
    const value = await options.getAccessToken?.();
    if (!value) {
      throw new Error(
        'KICK\'S Consumer API access token is not configured. ' +
          'Provide the DataStorm-managed consumer session token through getAccessToken().'
      );
    }
    return value;
  }

  async function request<T>(
    path: string,
    init: RequestInit = {},
    authenticated = true
  ): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('accept', 'application/json');

    if (init.body && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }

    if (authenticated) {
      headers.set('authorization', `Bearer ${await accessToken()}`);
    }

    const res = await fetchImpl(`${baseUrl}${path}`, {
      ...init,
      headers
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new ConsumerApiError(
        res.status,
        `HTTP ${res.status}: KICK'S Consumer API request failed for ${path}`,
        body
      );
    }

    if (res.status === 204) return undefined as T;

    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  return {
    baseUrl,

    auth: {
      login(body: LoginRequest): Promise<AuthToken> {
        return request<AuthToken>(
          '/auth/login',
          { method: 'POST', body: JSON.stringify(body) },
          false
        );
      },

      refresh(body: RefreshRequest): Promise<AuthToken> {
        return request<AuthToken>(
          '/auth/refresh',
          { method: 'POST', body: JSON.stringify(body) },
          false
        );
      }
    },

    consumers: {
      me(): Promise<ConsumerProfile> {
        return request<ConsumerProfile>('/consumers/me');
      },

      linkSocialAccounts(body: SocialLinkRequest): Promise<ConsumerProfile> {
        return request<ConsumerProfile>('/consumers/me/social-links', {
          method: 'POST',
          body: JSON.stringify(body)
        });
      }
    },

    regional: {
      createPackage(body: RegionalPackageCreate): Promise<RegionalPackage> {
        return request<RegionalPackage>('/regional/packages', {
          method: 'POST',
          body: JSON.stringify(body)
        });
      },

      listPackages(): Promise<RegionalPackage[]> {
        return request<RegionalPackage[]>('/regional/packages');
      },

      listCohorts(regionCode?: string): Promise<Cohort[]> {
        const query = regionCode
          ? `?regionCode=${encodeURIComponent(regionCode)}`
          : '';
        return request<Cohort[]>(`/regional/cohorts${query}`);
      },

      joinCohort(cohortId: string): Promise<CohortMembership> {
        return request<CohortMembership>(
          `/regional/cohorts/${encodeURIComponent(cohortId)}/join`,
          { method: 'POST' }
        );
      }
    },

    kic: {
      balance(): Promise<KICBalance> {
        return request<KICBalance>('/kic/balance');
      },

      history(): Promise<KICTransaction[]> {
        return request<KICTransaction[]>('/kic/history');
      },

      accrualOpportunities(): Promise<AccrualOpportunity[]> {
        return request<AccrualOpportunity[]>('/kic/accrual');
      }
    },

    marketplace: {
      listItems(category?: string): Promise<MarketplaceItem[]> {
        const query = category
          ? `?category=${encodeURIComponent(category)}`
          : '';
        return request<MarketplaceItem[]>(`/marketplace/items${query}`);
      },

      createOrder(body: MarketplaceOrderCreate): Promise<MarketplaceOrder> {
        return request<MarketplaceOrder>('/marketplace/orders', {
          method: 'POST',
          body: JSON.stringify(body)
        });
      }
    },

    insights: {
      quantum(): Promise<QuantumInsightSet> {
        return request<QuantumInsightSet>('/insights/quantum');
      }
    },

    websockets: {
      /**
       * The OpenAPI contract documents channel paths but does not define
       * a token transport mechanism for the WebSocket handshake. This helper
       * therefore builds the URL only. Authentication must follow the backend's
       * separately approved handshake contract.
       */
      consumerChannelUrl(
        consumerId: string,
        channel: ConsumerEventChannel
      ): string {
        return (
          toWebSocketBase(baseUrl) +
          `/ws/consumer/${encodeURIComponent(consumerId)}/${channel}`
        );
      }
    }
  };
}

/**
 * Default client uses the sandbox endpoint and has no token provider.
 * Protected requests will fail closed until the DataStorm consumer session
 * supplies a token.
 */
export const consumerApi = createConsumerApiClient();
