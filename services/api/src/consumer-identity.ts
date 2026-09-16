import {
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { Pool, type PoolClient } from 'pg';

export type ConsumerAccountStatus = 'pending_verification' | 'active' | 'suspended' | 'closed';
export type ProductEntitlementStatus = 'active' | 'suspended' | 'revoked';
export type KicksProfileStatus = 'active' | 'suspended' | 'closed';

export interface ConsumerMetadata {
  locale?: string;
  timezone?: string;
  referral_code?: string;
}

export interface StoredConsumerAccount {
  subjectId: string;
  email: string;
  emailNormalized: string;
  passwordHash: string;
  emailVerified: boolean;
  accountStatus: ConsumerAccountStatus;
  region: string | null;
  marketingOptIn: boolean;
  termsVersion: string;
  privacyVersion: string;
  metadata: ConsumerMetadata;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConsumerAccountView {
  subject_id: string;
  email: string;
  email_verified: boolean;
  account_status: ConsumerAccountStatus;
  region: string | null;
  marketing_opt_in: boolean;
  created_at: string;
  updated_at: string;
  metadata: ConsumerMetadata;
}

export interface ProductEntitlement {
  subjectId: string;
  product: 'kicks';
  status: ProductEntitlementStatus;
  grantedAt: string;
  updatedAt: string;
}

export interface KicksConsumerProfile {
  profileId: string;
  subjectId: string;
  status: KicksProfileStatus;
  createdAt: string;
  updatedAt: string;
}

export interface StoredConsumerSession {
  sessionId: string;
  subjectId: string;
  accessTokenHash: string;
  refreshTokenHash: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
  revokedAt: string | null;
  createdAt: string;
}

export interface EmailVerificationRecord {
  subjectId: string;
  tokenHash: string;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
}

export interface KicksDeviceBinding {
  subjectId: string;
  deviceId: string;
  collectorSubjectId: string;
  displayName: string | null;
  platform: 'android' | 'ios' | 'web' | 'other';
  appVersion: string | null;
  boundAt: string;
  revokedAt: string | null;
}

export interface ConsumerIdentityStore {
  createAccountBundle(input: {
    account: StoredConsumerAccount;
    entitlement: ProductEntitlement;
    profile: KicksConsumerProfile;
    verification: EmailVerificationRecord;
  }): Promise<void>;
  findAccountByEmail(emailNormalized: string): Promise<StoredConsumerAccount | null>;
  findAccountBySubjectId(subjectId: string): Promise<StoredConsumerAccount | null>;
  findAccountByIdempotencyKey(idempotencyKey: string): Promise<StoredConsumerAccount | null>;
  findEntitlement(subjectId: string, product: 'kicks'): Promise<ProductEntitlement | null>;
  findKicksProfile(subjectId: string): Promise<KicksConsumerProfile | null>;
  consumeVerificationToken(tokenHash: string, nowIso: string): Promise<'verified' | 'expired' | 'invalid'>;
  saveSession(session: StoredConsumerSession): Promise<void>;
  findSessionByAccessTokenHash(hash: string, nowIso: string): Promise<StoredConsumerSession | null>;
  findSessionByRefreshTokenHash(hash: string, nowIso: string): Promise<StoredConsumerSession | null>;
  rotateSession(input: {
    sessionId: string;
    accessTokenHash: string;
    refreshTokenHash: string;
    accessExpiresAt: string;
    refreshExpiresAt: string;
  }): Promise<void>;
  revokeSession(sessionId: string, revokedAt: string): Promise<void>;
  upsertDeviceBinding(binding: KicksDeviceBinding): Promise<KicksDeviceBinding>;
  listDeviceBindings(subjectId: string): Promise<KicksDeviceBinding[]>;
  revokeDeviceBinding(subjectId: string, deviceId: string, revokedAt: string): Promise<boolean>;
  close(): Promise<void>;
}

const normalizeEmail = (email: string) => email.trim().toLowerCase();
const tokenHash = (value: string) => createHash('sha256').update(value).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');

const passwordHash = (password: string) => {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64);
  return `${salt.toString('base64url')}.${derived.toString('base64url')}`;
};

const passwordMatches = (password: string, stored: string) => {
  const [saltEncoded, digestEncoded] = stored.split('.');
  if (!saltEncoded || !digestEncoded) return false;
  const expected = Buffer.from(digestEncoded, 'base64url');
  const actual = scryptSync(password, Buffer.from(saltEncoded, 'base64url'), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};

const presentAccount = (account: StoredConsumerAccount): ConsumerAccountView => ({
  subject_id: account.subjectId,
  email: account.email,
  email_verified: account.emailVerified,
  account_status: account.accountStatus,
  region: account.region,
  marketing_opt_in: account.marketingOptIn,
  created_at: account.createdAt,
  updated_at: account.updatedAt,
  metadata: { ...account.metadata },
});

export class ConsumerIdentityService {
  constructor(
    private store: ConsumerIdentityStore,
    private options: {
      accessTokenTtlMs?: number;
      refreshTokenTtlMs?: number;
      verificationTokenTtlMs?: number;
    } = {},
  ) {}

  public async createAccount(input: {
    email: string;
    password: string;
    region?: string | null;
    marketingOptIn?: boolean;
    termsVersion: string;
    privacyVersion: string;
    metadata?: ConsumerMetadata;
    idempotencyKey: string;
  }): Promise<{ account: ConsumerAccountView; verificationToken: string | null; replayed: boolean }> {
    const emailNormalized = normalizeEmail(input.email);
    const replay = await this.store.findAccountByIdempotencyKey(input.idempotencyKey);
    if (replay) {
      if (replay.emailNormalized !== emailNormalized) throw new Error('idempotency_conflict');
      return { account: presentAccount(replay), verificationToken: null, replayed: true };
    }

    if (await this.store.findAccountByEmail(emailNormalized)) throw new Error('account_exists');

    const now = new Date();
    const createdAt = now.toISOString();
    const subjectId = randomUUID();
    const verificationToken = newToken();
    const account: StoredConsumerAccount = {
      subjectId,
      email: input.email.trim(),
      emailNormalized,
      passwordHash: passwordHash(input.password),
      emailVerified: false,
      accountStatus: 'pending_verification',
      region: input.region?.trim() || null,
      marketingOptIn: input.marketingOptIn === true,
      termsVersion: input.termsVersion,
      privacyVersion: input.privacyVersion,
      metadata: { ...(input.metadata ?? {}) },
      idempotencyKey: input.idempotencyKey,
      createdAt,
      updatedAt: createdAt,
    };
    const entitlement: ProductEntitlement = {
      subjectId,
      product: 'kicks',
      status: 'active',
      grantedAt: createdAt,
      updatedAt: createdAt,
    };
    const profile: KicksConsumerProfile = {
      profileId: randomUUID(),
      subjectId,
      status: 'active',
      createdAt,
      updatedAt: createdAt,
    };
    const verification: EmailVerificationRecord = {
      subjectId,
      tokenHash: tokenHash(verificationToken),
      expiresAt: new Date(now.getTime() + (this.options.verificationTokenTtlMs ?? 24 * 60 * 60 * 1000)).toISOString(),
      usedAt: null,
      createdAt,
    };

    try {
      await this.store.createAccountBundle({ account, entitlement, profile, verification });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        const existing = await this.store.findAccountByEmail(emailNormalized);
        if (existing) throw new Error('account_exists');
      }
      throw error;
    }

    return { account: presentAccount(account), verificationToken, replayed: false };
  }

  public async verifyEmail(verificationToken: string): Promise<ConsumerAccountView> {
    const result = await this.store.consumeVerificationToken(tokenHash(verificationToken), new Date().toISOString());
    if (result === 'expired') throw new Error('verification_expired');
    if (result !== 'verified') throw new Error('verification_invalid');

    const account = await this.findAccountByVerificationTokenResult(verificationToken);
    if (!account) throw new Error('verification_invalid');
    return presentAccount(account);
  }

  private async findAccountByVerificationTokenResult(_verificationToken: string): Promise<StoredConsumerAccount | null> {
    // Verification records never expose subject identity to callers. The store updates the
    // account atomically; account lookup is performed by scanning only in memory and by
    // a dedicated store method in PostgreSQL through the verification transaction result.
    if (this.store instanceof MemoryConsumerIdentityStore) {
      return this.store.lastVerifiedSubjectId
        ? this.store.findAccountBySubjectId(this.store.lastVerifiedSubjectId)
        : null;
    }
    if (this.store instanceof PostgresConsumerIdentityStore) {
      return this.store.lastVerifiedSubjectId
        ? this.store.findAccountBySubjectId(this.store.lastVerifiedSubjectId)
        : null;
    }
    return null;
  }

  public async getAccount(subjectId: string): Promise<ConsumerAccountView | null> {
    const account = await this.store.findAccountBySubjectId(subjectId);
    return account ? presentAccount(account) : null;
  }

  public async getEntitlement(subjectId: string) {
    return this.store.findEntitlement(subjectId, 'kicks');
  }

  public async getKicksProfile(subjectId: string) {
    return this.store.findKicksProfile(subjectId);
  }

  public async createSession(email: string, password: string) {
    const account = await this.store.findAccountByEmail(normalizeEmail(email));
    if (!account || !passwordMatches(password, account.passwordHash)) throw new Error('invalid_credentials');
    if (!account.emailVerified || account.accountStatus !== 'active') throw new Error('account_not_active');
    const entitlement = await this.store.findEntitlement(account.subjectId, 'kicks');
    if (!entitlement || entitlement.status !== 'active') throw new Error('kicks_access_unavailable');

    const accessToken = newToken();
    const refreshToken = newToken();
    const now = Date.now();
    const session: StoredConsumerSession = {
      sessionId: randomUUID(),
      subjectId: account.subjectId,
      accessTokenHash: tokenHash(accessToken),
      refreshTokenHash: tokenHash(refreshToken),
      accessExpiresAt: new Date(now + (this.options.accessTokenTtlMs ?? 15 * 60 * 1000)).toISOString(),
      refreshExpiresAt: new Date(now + (this.options.refreshTokenTtlMs ?? 30 * 24 * 60 * 60 * 1000)).toISOString(),
      revokedAt: null,
      createdAt: new Date(now).toISOString(),
    };
    await this.store.saveSession(session);
    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: 'Bearer' as const,
      expires_in: Math.floor((this.options.accessTokenTtlMs ?? 15 * 60 * 1000) / 1000),
    };
  }

  public async authenticateAccessToken(accessToken: string): Promise<StoredConsumerAccount | null> {
    const session = await this.store.findSessionByAccessTokenHash(tokenHash(accessToken), new Date().toISOString());
    if (!session) return null;
    const account = await this.store.findAccountBySubjectId(session.subjectId);
    if (!account || account.accountStatus !== 'active') return null;
    return account;
  }

  public async refreshSession(refreshToken: string) {
    const existing = await this.store.findSessionByRefreshTokenHash(tokenHash(refreshToken), new Date().toISOString());
    if (!existing) throw new Error('invalid_refresh_token');
    const account = await this.store.findAccountBySubjectId(existing.subjectId);
    if (!account || account.accountStatus !== 'active') throw new Error('account_not_active');
    const entitlement = await this.store.findEntitlement(account.subjectId, 'kicks');
    if (!entitlement || entitlement.status !== 'active') throw new Error('kicks_access_unavailable');

    const accessToken = newToken();
    const nextRefreshToken = newToken();
    const now = Date.now();
    const accessTtl = this.options.accessTokenTtlMs ?? 15 * 60 * 1000;
    const refreshTtl = this.options.refreshTokenTtlMs ?? 30 * 24 * 60 * 60 * 1000;
    await this.store.rotateSession({
      sessionId: existing.sessionId,
      accessTokenHash: tokenHash(accessToken),
      refreshTokenHash: tokenHash(nextRefreshToken),
      accessExpiresAt: new Date(now + accessTtl).toISOString(),
      refreshExpiresAt: new Date(now + refreshTtl).toISOString(),
    });
    return {
      access_token: accessToken,
      refresh_token: nextRefreshToken,
      token_type: 'Bearer' as const,
      expires_in: Math.floor(accessTtl / 1000),
    };
  }

  public async revokeSession(accessToken: string): Promise<boolean> {
    const session = await this.store.findSessionByAccessTokenHash(tokenHash(accessToken), new Date().toISOString());
    if (!session) return false;
    await this.store.revokeSession(session.sessionId, new Date().toISOString());
    return true;
  }

  public async bindDevice(binding: KicksDeviceBinding) {
    return this.store.upsertDeviceBinding(binding);
  }

  public async listDeviceBindings(subjectId: string) {
    return this.store.listDeviceBindings(subjectId);
  }

  public async revokeDeviceBinding(subjectId: string, deviceId: string) {
    return this.store.revokeDeviceBinding(subjectId, deviceId, new Date().toISOString());
  }

  public async close() {
    await this.store.close();
  }
}

export class MemoryConsumerIdentityStore implements ConsumerIdentityStore {
  private accounts = new Map<string, StoredConsumerAccount>();
  private emails = new Map<string, string>();
  private idempotencyKeys = new Map<string, string>();
  private entitlements = new Map<string, ProductEntitlement>();
  private profiles = new Map<string, KicksConsumerProfile>();
  private verifications = new Map<string, EmailVerificationRecord>();
  private sessions = new Map<string, StoredConsumerSession>();
  private bindings = new Map<string, KicksDeviceBinding>();
  public lastVerifiedSubjectId: string | null = null;

  async createAccountBundle(input: {
    account: StoredConsumerAccount;
    entitlement: ProductEntitlement;
    profile: KicksConsumerProfile;
    verification: EmailVerificationRecord;
  }) {
    if (this.emails.has(input.account.emailNormalized)) throw Object.assign(new Error('duplicate_email'), { code: '23505' });
    if (this.idempotencyKeys.has(input.account.idempotencyKey)) throw Object.assign(new Error('duplicate_idempotency_key'), { code: '23505' });
    this.accounts.set(input.account.subjectId, structuredClone(input.account));
    this.emails.set(input.account.emailNormalized, input.account.subjectId);
    this.idempotencyKeys.set(input.account.idempotencyKey, input.account.subjectId);
    this.entitlements.set(`${input.entitlement.subjectId}:${input.entitlement.product}`, structuredClone(input.entitlement));
    this.profiles.set(input.profile.subjectId, structuredClone(input.profile));
    this.verifications.set(input.verification.tokenHash, structuredClone(input.verification));
  }

  async findAccountByEmail(emailNormalized: string) {
    const subjectId = this.emails.get(emailNormalized);
    const account = subjectId ? this.accounts.get(subjectId) : null;
    return account ? structuredClone(account) : null;
  }

  async findAccountBySubjectId(subjectId: string) {
    const account = this.accounts.get(subjectId);
    return account ? structuredClone(account) : null;
  }

  async findAccountByIdempotencyKey(idempotencyKey: string) {
    const subjectId = this.idempotencyKeys.get(idempotencyKey);
    const account = subjectId ? this.accounts.get(subjectId) : null;
    return account ? structuredClone(account) : null;
  }

  async findEntitlement(subjectId: string, product: 'kicks') {
    const value = this.entitlements.get(`${subjectId}:${product}`);
    return value ? structuredClone(value) : null;
  }

  async findKicksProfile(subjectId: string) {
    const value = this.profiles.get(subjectId);
    return value ? structuredClone(value) : null;
  }

  async consumeVerificationToken(hash: string, nowIso: string): Promise<'verified' | 'expired' | 'invalid'> {
    const record = this.verifications.get(hash);
    if (!record || record.usedAt) return 'invalid';
    if (Date.parse(record.expiresAt) < Date.parse(nowIso)) return 'expired';
    const account = this.accounts.get(record.subjectId);
    if (!account) return 'invalid';
    record.usedAt = nowIso;
    account.emailVerified = true;
    account.accountStatus = 'active';
    account.updatedAt = nowIso;
    this.lastVerifiedSubjectId = account.subjectId;
    return 'verified';
  }

  async saveSession(session: StoredConsumerSession) {
    this.sessions.set(session.sessionId, structuredClone(session));
  }

  async findSessionByAccessTokenHash(hash: string, nowIso: string) {
    const session = [...this.sessions.values()].find(item => item.accessTokenHash === hash && !item.revokedAt && Date.parse(item.accessExpiresAt) >= Date.parse(nowIso));
    return session ? structuredClone(session) : null;
  }

  async findSessionByRefreshTokenHash(hash: string, nowIso: string) {
    const session = [...this.sessions.values()].find(item => item.refreshTokenHash === hash && !item.revokedAt && Date.parse(item.refreshExpiresAt) >= Date.parse(nowIso));
    return session ? structuredClone(session) : null;
  }

  async rotateSession(input: {
    sessionId: string;
    accessTokenHash: string;
    refreshTokenHash: string;
    accessExpiresAt: string;
    refreshExpiresAt: string;
  }) {
    const session = this.sessions.get(input.sessionId);
    if (!session) throw new Error('session_not_found');
    session.accessTokenHash = input.accessTokenHash;
    session.refreshTokenHash = input.refreshTokenHash;
    session.accessExpiresAt = input.accessExpiresAt;
    session.refreshExpiresAt = input.refreshExpiresAt;
    session.revokedAt = null;
  }

  async revokeSession(sessionId: string, revokedAt: string) {
    const session = this.sessions.get(sessionId);
    if (session) session.revokedAt = revokedAt;
  }

  async upsertDeviceBinding(binding: KicksDeviceBinding) {
    const key = `${binding.subjectId}:${binding.deviceId}`;
    this.bindings.set(key, structuredClone({ ...binding, revokedAt: null }));
    return structuredClone(this.bindings.get(key)!);
  }

  async listDeviceBindings(subjectId: string) {
    return [...this.bindings.values()]
      .filter(item => item.subjectId === subjectId && !item.revokedAt)
      .map(item => structuredClone(item));
  }

  async revokeDeviceBinding(subjectId: string, deviceId: string, revokedAt: string) {
    const binding = this.bindings.get(`${subjectId}:${deviceId}`);
    if (!binding || binding.revokedAt) return false;
    binding.revokedAt = revokedAt;
    return true;
  }

  async close() {}
}

export class PostgresConsumerIdentityStore implements ConsumerIdentityStore {
  private schemaReady: Promise<void> | null = null;
  public lastVerifiedSubjectId: string | null = null;

  constructor(private pool: Pool) {}

  static fromConnectionString(connectionString: string) {
    const url = new URL(connectionString);
    const isLoopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
    return new PostgresConsumerIdentityStore(new Pool({
      connectionString,
      ssl: isLoopback ? undefined : { rejectUnauthorized: true },
      max: 5,
    }));
  }

  private ensureSchema() {
    if (!this.schemaReady) {
      this.schemaReady = this.pool.query(`
        CREATE TABLE IF NOT EXISTS datastorm_consumer_accounts (
          subject_id uuid PRIMARY KEY,
          email text NOT NULL,
          email_normalized text NOT NULL UNIQUE,
          password_hash text NOT NULL,
          email_verified boolean NOT NULL DEFAULT false,
          account_status text NOT NULL CHECK (account_status IN ('pending_verification','active','suspended','closed')),
          region text,
          marketing_opt_in boolean NOT NULL DEFAULT false,
          terms_version text NOT NULL,
          privacy_version text NOT NULL,
          metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
          idempotency_key text NOT NULL UNIQUE,
          created_at timestamptz NOT NULL,
          updated_at timestamptz NOT NULL
        );
        CREATE TABLE IF NOT EXISTS datastorm_product_entitlements (
          subject_id uuid NOT NULL REFERENCES datastorm_consumer_accounts(subject_id),
          product text NOT NULL,
          status text NOT NULL CHECK (status IN ('active','suspended','revoked')),
          granted_at timestamptz NOT NULL,
          updated_at timestamptz NOT NULL,
          PRIMARY KEY (subject_id, product)
        );
        CREATE TABLE IF NOT EXISTS kicks_consumer_profiles (
          profile_id uuid PRIMARY KEY,
          subject_id uuid NOT NULL UNIQUE REFERENCES datastorm_consumer_accounts(subject_id),
          status text NOT NULL CHECK (status IN ('active','suspended','closed')),
          created_at timestamptz NOT NULL,
          updated_at timestamptz NOT NULL
        );
        CREATE TABLE IF NOT EXISTS datastorm_email_verifications (
          subject_id uuid PRIMARY KEY REFERENCES datastorm_consumer_accounts(subject_id),
          token_hash text NOT NULL UNIQUE,
          expires_at timestamptz NOT NULL,
          used_at timestamptz,
          created_at timestamptz NOT NULL
        );
        CREATE TABLE IF NOT EXISTS datastorm_consumer_sessions (
          session_id uuid PRIMARY KEY,
          subject_id uuid NOT NULL REFERENCES datastorm_consumer_accounts(subject_id),
          access_token_hash text NOT NULL UNIQUE,
          refresh_token_hash text NOT NULL UNIQUE,
          access_expires_at timestamptz NOT NULL,
          refresh_expires_at timestamptz NOT NULL,
          revoked_at timestamptz,
          created_at timestamptz NOT NULL
        );
        CREATE INDEX IF NOT EXISTS datastorm_consumer_sessions_subject_idx
          ON datastorm_consumer_sessions(subject_id);
        CREATE TABLE IF NOT EXISTS kicks_device_bindings (
          subject_id uuid NOT NULL REFERENCES datastorm_consumer_accounts(subject_id),
          device_id text NOT NULL,
          collector_subject_id text NOT NULL,
          display_name text,
          platform text NOT NULL CHECK (platform IN ('android','ios','web','other')),
          app_version text,
          bound_at timestamptz NOT NULL,
          revoked_at timestamptz,
          PRIMARY KEY (subject_id, device_id)
        );
        CREATE INDEX IF NOT EXISTS kicks_device_bindings_subject_idx
          ON kicks_device_bindings(subject_id, revoked_at);
      `).then(() => undefined);
    }
    return this.schemaReady;
  }

  private mapAccount(row: Record<string, unknown>): StoredConsumerAccount {
    return {
      subjectId: String(row.subject_id),
      email: String(row.email),
      emailNormalized: String(row.email_normalized),
      passwordHash: String(row.password_hash),
      emailVerified: Boolean(row.email_verified),
      accountStatus: String(row.account_status) as ConsumerAccountStatus,
      region: row.region === null ? null : String(row.region),
      marketingOptIn: Boolean(row.marketing_opt_in),
      termsVersion: String(row.terms_version),
      privacyVersion: String(row.privacy_version),
      metadata: (row.metadata ?? {}) as ConsumerMetadata,
      idempotencyKey: String(row.idempotency_key),
      createdAt: new Date(String(row.created_at)).toISOString(),
      updatedAt: new Date(String(row.updated_at)).toISOString(),
    };
  }

  private mapSession(row: Record<string, unknown>): StoredConsumerSession {
    return {
      sessionId: String(row.session_id),
      subjectId: String(row.subject_id),
      accessTokenHash: String(row.access_token_hash),
      refreshTokenHash: String(row.refresh_token_hash),
      accessExpiresAt: new Date(String(row.access_expires_at)).toISOString(),
      refreshExpiresAt: new Date(String(row.refresh_expires_at)).toISOString(),
      revokedAt: row.revoked_at ? new Date(String(row.revoked_at)).toISOString() : null,
      createdAt: new Date(String(row.created_at)).toISOString(),
    };
  }

  async createAccountBundle(input: {
    account: StoredConsumerAccount;
    entitlement: ProductEntitlement;
    profile: KicksConsumerProfile;
    verification: EmailVerificationRecord;
  }) {
    await this.ensureSchema();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO datastorm_consumer_accounts
        (subject_id,email,email_normalized,password_hash,email_verified,account_status,region,marketing_opt_in,terms_version,privacy_version,metadata,idempotency_key,created_at,updated_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14)`,
        [input.account.subjectId, input.account.email, input.account.emailNormalized, input.account.passwordHash,
          input.account.emailVerified, input.account.accountStatus, input.account.region, input.account.marketingOptIn,
          input.account.termsVersion, input.account.privacyVersion, JSON.stringify(input.account.metadata),
          input.account.idempotencyKey, input.account.createdAt, input.account.updatedAt],
      );
      await client.query(
        `INSERT INTO datastorm_product_entitlements(subject_id,product,status,granted_at,updated_at)
         VALUES($1,$2,$3,$4,$5)`,
        [input.entitlement.subjectId, input.entitlement.product, input.entitlement.status,
          input.entitlement.grantedAt, input.entitlement.updatedAt],
      );
      await client.query(
        `INSERT INTO kicks_consumer_profiles(profile_id,subject_id,status,created_at,updated_at)
         VALUES($1,$2,$3,$4,$5)`,
        [input.profile.profileId, input.profile.subjectId, input.profile.status, input.profile.createdAt, input.profile.updatedAt],
      );
      await client.query(
        `INSERT INTO datastorm_email_verifications(subject_id,token_hash,expires_at,used_at,created_at)
         VALUES($1,$2,$3,$4,$5)`,
        [input.verification.subjectId, input.verification.tokenHash, input.verification.expiresAt,
          input.verification.usedAt, input.verification.createdAt],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async findAccountByEmail(emailNormalized: string) {
    await this.ensureSchema();
    const row = (await this.pool.query('SELECT * FROM datastorm_consumer_accounts WHERE email_normalized=$1', [emailNormalized])).rows[0];
    return row ? this.mapAccount(row) : null;
  }

  async findAccountBySubjectId(subjectId: string) {
    await this.ensureSchema();
    const row = (await this.pool.query('SELECT * FROM datastorm_consumer_accounts WHERE subject_id=$1', [subjectId])).rows[0];
    return row ? this.mapAccount(row) : null;
  }

  async findAccountByIdempotencyKey(idempotencyKey: string) {
    await this.ensureSchema();
    const row = (await this.pool.query('SELECT * FROM datastorm_consumer_accounts WHERE idempotency_key=$1', [idempotencyKey])).rows[0];
    return row ? this.mapAccount(row) : null;
  }

  async findEntitlement(subjectId: string, product: 'kicks') {
    await this.ensureSchema();
    const row = (await this.pool.query(
      'SELECT * FROM datastorm_product_entitlements WHERE subject_id=$1 AND product=$2', [subjectId, product],
    )).rows[0];
    return row ? {
      subjectId: String(row.subject_id),
      product: 'kicks' as const,
      status: String(row.status) as ProductEntitlementStatus,
      grantedAt: new Date(String(row.granted_at)).toISOString(),
      updatedAt: new Date(String(row.updated_at)).toISOString(),
    } : null;
  }

  async findKicksProfile(subjectId: string) {
    await this.ensureSchema();
    const row = (await this.pool.query('SELECT * FROM kicks_consumer_profiles WHERE subject_id=$1', [subjectId])).rows[0];
    return row ? {
      profileId: String(row.profile_id),
      subjectId: String(row.subject_id),
      status: String(row.status) as KicksProfileStatus,
      createdAt: new Date(String(row.created_at)).toISOString(),
      updatedAt: new Date(String(row.updated_at)).toISOString(),
    } : null;
  }

  async consumeVerificationToken(hash: string, nowIso: string): Promise<'verified' | 'expired' | 'invalid'> {
    await this.ensureSchema();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const row = (await client.query(
        `SELECT * FROM datastorm_email_verifications
         WHERE token_hash=$1 FOR UPDATE`, [hash],
      )).rows[0];
      if (!row || row.used_at) {
        await client.query('ROLLBACK');
        return 'invalid';
      }
      if (Date.parse(String(row.expires_at)) < Date.parse(nowIso)) {
        await client.query('ROLLBACK');
        return 'expired';
      }
      await client.query('UPDATE datastorm_email_verifications SET used_at=$1 WHERE token_hash=$2', [nowIso, hash]);
      await client.query(
        `UPDATE datastorm_consumer_accounts
         SET email_verified=true, account_status='active', updated_at=$1
         WHERE subject_id=$2`, [nowIso, row.subject_id],
      );
      await client.query('COMMIT');
      this.lastVerifiedSubjectId = String(row.subject_id);
      return 'verified';
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async saveSession(session: StoredConsumerSession) {
    await this.ensureSchema();
    await this.pool.query(
      `INSERT INTO datastorm_consumer_sessions
       (session_id,subject_id,access_token_hash,refresh_token_hash,access_expires_at,refresh_expires_at,revoked_at,created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [session.sessionId, session.subjectId, session.accessTokenHash, session.refreshTokenHash,
        session.accessExpiresAt, session.refreshExpiresAt, session.revokedAt, session.createdAt],
    );
  }

  async findSessionByAccessTokenHash(hash: string, nowIso: string) {
    await this.ensureSchema();
    const row = (await this.pool.query(
      `SELECT * FROM datastorm_consumer_sessions
       WHERE access_token_hash=$1 AND revoked_at IS NULL AND access_expires_at >= $2`, [hash, nowIso],
    )).rows[0];
    return row ? this.mapSession(row) : null;
  }

  async findSessionByRefreshTokenHash(hash: string, nowIso: string) {
    await this.ensureSchema();
    const row = (await this.pool.query(
      `SELECT * FROM datastorm_consumer_sessions
       WHERE refresh_token_hash=$1 AND revoked_at IS NULL AND refresh_expires_at >= $2`, [hash, nowIso],
    )).rows[0];
    return row ? this.mapSession(row) : null;
  }

  async rotateSession(input: {
    sessionId: string;
    accessTokenHash: string;
    refreshTokenHash: string;
    accessExpiresAt: string;
    refreshExpiresAt: string;
  }) {
    await this.ensureSchema();
    await this.pool.query(
      `UPDATE datastorm_consumer_sessions
       SET access_token_hash=$1, refresh_token_hash=$2, access_expires_at=$3, refresh_expires_at=$4, revoked_at=NULL
       WHERE session_id=$5`,
      [input.accessTokenHash, input.refreshTokenHash, input.accessExpiresAt, input.refreshExpiresAt, input.sessionId],
    );
  }

  async revokeSession(sessionId: string, revokedAt: string) {
    await this.ensureSchema();
    await this.pool.query('UPDATE datastorm_consumer_sessions SET revoked_at=$1 WHERE session_id=$2', [revokedAt, sessionId]);
  }

  async upsertDeviceBinding(binding: KicksDeviceBinding) {
    await this.ensureSchema();
    const row = (await this.pool.query(
      `INSERT INTO kicks_device_bindings
       (subject_id,device_id,collector_subject_id,display_name,platform,app_version,bound_at,revoked_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,NULL)
       ON CONFLICT(subject_id,device_id) DO UPDATE SET
         collector_subject_id=EXCLUDED.collector_subject_id,
         display_name=EXCLUDED.display_name,
         platform=EXCLUDED.platform,
         app_version=EXCLUDED.app_version,
         bound_at=EXCLUDED.bound_at,
         revoked_at=NULL
       RETURNING *`,
      [binding.subjectId, binding.deviceId, binding.collectorSubjectId, binding.displayName,
        binding.platform, binding.appVersion, binding.boundAt],
    )).rows[0]!;
    return this.mapBinding(row);
  }

  async listDeviceBindings(subjectId: string) {
    await this.ensureSchema();
    const rows = (await this.pool.query(
      'SELECT * FROM kicks_device_bindings WHERE subject_id=$1 AND revoked_at IS NULL ORDER BY bound_at DESC', [subjectId],
    )).rows;
    return rows.map(row => this.mapBinding(row));
  }

  async revokeDeviceBinding(subjectId: string, deviceId: string, revokedAt: string) {
    await this.ensureSchema();
    const result = await this.pool.query(
      `UPDATE kicks_device_bindings SET revoked_at=$1
       WHERE subject_id=$2 AND device_id=$3 AND revoked_at IS NULL`, [revokedAt, subjectId, deviceId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  private mapBinding(row: Record<string, unknown>): KicksDeviceBinding {
    return {
      subjectId: String(row.subject_id),
      deviceId: String(row.device_id),
      collectorSubjectId: String(row.collector_subject_id),
      displayName: row.display_name === null ? null : String(row.display_name),
      platform: String(row.platform) as KicksDeviceBinding['platform'],
      appVersion: row.app_version === null ? null : String(row.app_version),
      boundAt: new Date(String(row.bound_at)).toISOString(),
      revokedAt: row.revoked_at ? new Date(String(row.revoked_at)).toISOString() : null,
    };
  }

  async close() {
    await this.pool.end();
  }
}
