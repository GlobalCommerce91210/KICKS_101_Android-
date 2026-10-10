import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';

export type AccountStatus = 'pending_verification' | 'active' | 'suspended' | 'closed';
export type ProductEntitlementStatus = 'active' | 'suspended' | 'revoked';
export type IdentityTokenKind = 'email_verification' | 'password_reset' | 'mfa_challenge';

export interface DataStormAccount {
  subject_id: string;
  email: string;
  password_hash: string;
  email_verified: boolean;
  account_status: AccountStatus;
  mfa_enabled: boolean;
  region: string | null;
  marketing_opt_in: boolean;
  terms_version: string;
  privacy_version: string;
  metadata: {
    locale?: string;
    timezone?: string;
    referral_code?: string;
  };
  created_at: string;
  updated_at: string;
}

export interface ProductEntitlement {
  entitlement_id: string;
  subject_id: string;
  product: 'kicks';
  status: ProductEntitlementStatus;
  granted_at: string;
  updated_at: string;
}

export interface KicksConsumerProfile {
  profile_id: string;
  subject_id: string;
  entitlement_id: string;
  status: 'active' | 'suspended';
  created_at: string;
  updated_at: string;
}

export interface ConsumerSession {
  session_id: string;
  subject_id: string;
  access_token_hash: string;
  refresh_token_hash: string;
  access_expires_at: string;
  refresh_expires_at: string;
  revoked_at: string | null;
  created_at: string;
}

export interface ConsumerIdentityToken {
  token_id: string;
  subject_id: string;
  kind: IdentityTokenKind;
  token_hash: string;
  expires_at: string;
  consumed_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface CreateAccountInput {
  email: string;
  password: string;
  region?: string | null;
  marketing_opt_in?: boolean;
  terms_version: string;
  privacy_version: string;
  metadata?: {
    locale?: string;
    timezone?: string;
    referral_code?: string;
  };
}

export interface AccountBundle {
  account: DataStormAccount;
  entitlement: ProductEntitlement;
  profile: KicksConsumerProfile;
}

export interface SessionBundle {
  session: ConsumerSession;
  access_token: string;
  refresh_token: string;
}

export interface ConsumerIdentityStore {
  createAccount(input: CreateAccountInput): Promise<AccountBundle>;
  findAccountByEmail(email: string): Promise<DataStormAccount | null>;
  findAccountBySubjectId(subjectId: string): Promise<DataStormAccount | null>;
  getKicksEntitlement(subjectId: string): Promise<ProductEntitlement | null>;
  getKicksProfile(subjectId: string): Promise<KicksConsumerProfile | null>;
  authenticate(email: string, password: string): Promise<SessionBundle | null>;
  findSessionByAccessToken(token: string): Promise<ConsumerSession | null>;
  refreshSession(refreshToken: string): Promise<SessionBundle | null>;
  revokeSession(accessToken: string): Promise<boolean>;
  revokeAllSessions(subjectId: string): Promise<void>;
  issueSessionForSubject(subjectId: string): Promise<SessionBundle | null>;
  issueIdentityToken(subjectId: string, kind: IdentityTokenKind, ttlMs: number): Promise<string | null>;
  consumeIdentityToken(rawToken: string, kind: IdentityTokenKind): Promise<ConsumerIdentityToken | null>;
  verifyEmail(subjectId: string): Promise<DataStormAccount | null>;
  updatePassword(subjectId: string, newPassword: string): Promise<boolean>;
  setMfaEnabled(subjectId: string, enabled: boolean): Promise<boolean>;
  closeAccount(subjectId: string): Promise<boolean>;
  close(): Promise<void>;
}

const normalizeEmail = (email: string) => email.trim().toLowerCase();
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [algorithm, salt, expected] = stored.split('$');
  if (algorithm !== 'scrypt' || !salt || !expected) return false;
  const actual = scryptSync(password, salt, 64);
  const expectedBuffer = Buffer.from(expected, 'hex');
  return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer);
}

function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export class MemoryConsumerIdentityStore implements ConsumerIdentityStore {
  private accounts = new Map<string, DataStormAccount>();
  private emailIndex = new Map<string, string>();
  private entitlements = new Map<string, ProductEntitlement>();
  private profiles = new Map<string, KicksConsumerProfile>();
  private sessions = new Map<string, ConsumerSession>();
  private identityTokens = new Map<string, ConsumerIdentityToken>();

  async createAccount(input: CreateAccountInput): Promise<AccountBundle> {
    const email = normalizeEmail(input.email);
    if (this.emailIndex.has(email)) throw new Error('account_exists');

    const now = new Date().toISOString();
    const subjectId = `ds_sub_${randomUUID()}`;

    const account: DataStormAccount = {
      subject_id: subjectId,
      email,
      password_hash: hashPassword(input.password),
      email_verified: false,
      account_status: 'pending_verification',
      mfa_enabled: false,
      region: input.region?.trim() || null,
      marketing_opt_in: input.marketing_opt_in === true,
      terms_version: input.terms_version,
      privacy_version: input.privacy_version,
      metadata: { ...(input.metadata ?? {}) },
      created_at: now,
      updated_at: now,
    };

    const entitlement: ProductEntitlement = {
      entitlement_id: `ent_${randomUUID()}`,
      subject_id: subjectId,
      product: 'kicks',
      status: 'active',
      granted_at: now,
      updated_at: now,
    };

    const profile: KicksConsumerProfile = {
      profile_id: `kicks_profile_${randomUUID()}`,
      subject_id: subjectId,
      entitlement_id: entitlement.entitlement_id,
      status: 'active',
      created_at: now,
      updated_at: now,
    };

    this.accounts.set(subjectId, account);
    this.emailIndex.set(email, subjectId);
    this.entitlements.set(subjectId, entitlement);
    this.profiles.set(subjectId, profile);

    return {
      account: { ...account, metadata: { ...account.metadata } },
      entitlement: { ...entitlement },
      profile: { ...profile },
    };
  }

  async findAccountByEmail(email: string): Promise<DataStormAccount | null> {
    const subjectId = this.emailIndex.get(normalizeEmail(email));
    if (!subjectId) return null;
    return this.findAccountBySubjectId(subjectId);
  }

  async findAccountBySubjectId(subjectId: string): Promise<DataStormAccount | null> {
    const account = this.accounts.get(subjectId);
    return account ? { ...account, metadata: { ...account.metadata } } : null;
  }

  async getKicksEntitlement(subjectId: string): Promise<ProductEntitlement | null> {
    const entitlement = this.entitlements.get(subjectId);
    return entitlement ? { ...entitlement } : null;
  }

  async getKicksProfile(subjectId: string): Promise<KicksConsumerProfile | null> {
    const profile = this.profiles.get(subjectId);
    return profile ? { ...profile } : null;
  }

  async authenticate(email: string, password: string): Promise<SessionBundle | null> {
    const account = await this.findAccountByEmail(email);
    if (!account || account.account_status === 'suspended' || account.account_status === 'closed') return null;
    if (!verifyPassword(password, account.password_hash)) return null;
    return this.issueSession(account.subject_id);
  }

  async findSessionByAccessToken(token: string): Promise<ConsumerSession | null> {
    const tokenHash = sha256(token);
    const now = Date.now();
    for (const session of this.sessions.values()) {
      if (
        session.access_token_hash === tokenHash &&
        !session.revoked_at &&
        Date.parse(session.access_expires_at) > now
      ) {
        const account = this.accounts.get(session.subject_id);
        if (!account || account.account_status === 'suspended' || account.account_status === 'closed') return null;
        return { ...session };
      }
    }
    return null;
  }

  async refreshSession(refreshToken: string): Promise<SessionBundle | null> {
    const tokenHash = sha256(refreshToken);
    const now = Date.now();
    for (const session of this.sessions.values()) {
      if (
        session.refresh_token_hash === tokenHash &&
        !session.revoked_at &&
        Date.parse(session.refresh_expires_at) > now
      ) {
        const account = this.accounts.get(session.subject_id);
        if (!account || account.account_status === 'suspended' || account.account_status === 'closed') {
          session.revoked_at = new Date().toISOString();
          return null;
        }
        session.revoked_at = new Date().toISOString();
        return this.issueSession(session.subject_id);
      }
    }
    return null;
  }

  async revokeSession(accessToken: string): Promise<boolean> {
    const tokenHash = sha256(accessToken);
    for (const session of this.sessions.values()) {
      if (session.access_token_hash === tokenHash && !session.revoked_at) {
        session.revoked_at = new Date().toISOString();
        return true;
      }
    }
    return false;
  }

  async revokeAllSessions(subjectId: string): Promise<void> {
    const now = new Date().toISOString();
    for (const session of this.sessions.values()) {
      if (session.subject_id === subjectId && !session.revoked_at) session.revoked_at = now;
    }
  }

  async issueSessionForSubject(subjectId: string): Promise<SessionBundle | null> {
    const account = this.accounts.get(subjectId);
    if (!account || account.account_status === 'suspended' || account.account_status === 'closed') return null;
    return this.issueSession(subjectId);
  }

  async issueIdentityToken(subjectId: string, kind: IdentityTokenKind, ttlMs: number): Promise<string | null> {
    const account = this.accounts.get(subjectId);
    if (!account || account.account_status === 'closed') return null;
    const now = Date.now();
    for (const token of this.identityTokens.values()) {
      if (token.subject_id === subjectId && token.kind === kind && !token.consumed_at && !token.revoked_at) {
        token.revoked_at = new Date(now).toISOString();
      }
    }
    const raw = newToken();
    const record: ConsumerIdentityToken = {
      token_id: `idt_${randomUUID()}`,
      subject_id: subjectId,
      kind,
      token_hash: sha256(raw),
      expires_at: new Date(now + Math.max(1, ttlMs)).toISOString(),
      consumed_at: null,
      revoked_at: null,
      created_at: new Date(now).toISOString(),
    };
    this.identityTokens.set(record.token_id, record);
    return raw;
  }

  async consumeIdentityToken(rawToken: string, kind: IdentityTokenKind): Promise<ConsumerIdentityToken | null> {
    const tokenHash = sha256(rawToken);
    const now = Date.now();
    for (const token of this.identityTokens.values()) {
      if (
        token.kind === kind &&
        token.token_hash === tokenHash &&
        !token.consumed_at &&
        !token.revoked_at &&
        Date.parse(token.expires_at) > now
      ) {
        const account = this.accounts.get(token.subject_id);
        if (!account || account.account_status === 'closed') return null;
        token.consumed_at = new Date(now).toISOString();
        return { ...token };
      }
    }
    return null;
  }

  async verifyEmail(subjectId: string): Promise<DataStormAccount | null> {
    const account = this.accounts.get(subjectId);
    if (!account || account.account_status === 'closed') return null;
    account.email_verified = true;
    account.account_status = 'active';
    account.updated_at = new Date().toISOString();
    return { ...account, metadata: { ...account.metadata } };
  }

  async updatePassword(subjectId: string, newPassword: string): Promise<boolean> {
    const account = this.accounts.get(subjectId);
    if (!account || account.account_status === 'closed') return false;
    account.password_hash = hashPassword(newPassword);
    account.updated_at = new Date().toISOString();
    await this.revokeAllSessions(subjectId);
    return true;
  }

  async setMfaEnabled(subjectId: string, enabled: boolean): Promise<boolean> {
    const account = this.accounts.get(subjectId);
    if (!account || account.account_status === 'closed') return false;
    account.mfa_enabled = enabled;
    account.updated_at = new Date().toISOString();
    return true;
  }

  async closeAccount(subjectId: string): Promise<boolean> {
    const account = this.accounts.get(subjectId);
    if (!account) return false;
    const now = new Date().toISOString();
    this.emailIndex.delete(account.email);
    account.email = `deleted+${sha256(subjectId).slice(0, 24)}@invalid.local`;
    account.password_hash = 'deleted';
    account.email_verified = false;
    account.account_status = 'closed';
    account.mfa_enabled = false;
    account.region = null;
    account.marketing_opt_in = false;
    account.metadata = {};
    account.updated_at = now;
    const entitlement = this.entitlements.get(subjectId);
    if (entitlement) {
      entitlement.status = 'revoked';
      entitlement.updated_at = now;
    }
    const profile = this.profiles.get(subjectId);
    if (profile) {
      profile.status = 'suspended';
      profile.updated_at = now;
    }
    await this.revokeAllSessions(subjectId);
    for (const token of this.identityTokens.values()) {
      if (token.subject_id === subjectId && !token.revoked_at) token.revoked_at = now;
    }
    return true;
  }

  private issueSession(subjectId: string): SessionBundle {
    const accessToken = newToken();
    const refreshToken = newToken();
    const now = Date.now();

    const session: ConsumerSession = {
      session_id: `sess_${randomUUID()}`,
      subject_id: subjectId,
      access_token_hash: sha256(accessToken),
      refresh_token_hash: sha256(refreshToken),
      access_expires_at: new Date(now + 15 * 60 * 1000).toISOString(),
      refresh_expires_at: new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString(),
      revoked_at: null,
      created_at: new Date(now).toISOString(),
    };

    this.sessions.set(session.session_id, session);
    return { session: { ...session }, access_token: accessToken, refresh_token: refreshToken };
  }

  async close(): Promise<void> {}
}

export function publicAccount(account: DataStormAccount) {
  const { password_hash: _passwordHash, ...safe } = account;
  return safe;
}
