import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';

export type AccountStatus = 'pending_verification' | 'active' | 'suspended' | 'closed';
export type TokenKind = 'email_verification' | 'password_reset' | 'refresh' | 'mfa';

export interface ConsumerAccount {
  subjectId: string;
  email: string;
  passwordHash: string;
  status: AccountStatus;
  emailVerifiedAt?: string;
  mfaEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface IdentityToken {
  id: string;
  subjectId: string;
  kind: TokenKind;
  tokenHash: string;
  expiresAt: number;
  consumedAt?: number;
  revokedAt?: number;
}

export interface IdentityRepository {
  findAccountByEmail(email: string): ConsumerAccount | undefined;
  findAccountBySubjectId(subjectId: string): ConsumerAccount | undefined;
  saveAccount(account: ConsumerAccount): void;
  saveToken(token: IdentityToken): void;
  findToken(kind: TokenKind, tokenHash: string): IdentityToken | undefined;
  revokeTokens(subjectId: string, kind?: TokenKind): void;
}

export class MemoryIdentityRepository implements IdentityRepository {
  readonly accounts = new Map<string, ConsumerAccount>();
  readonly tokens = new Map<string, IdentityToken>();
  findAccountByEmail(email: string) { return [...this.accounts.values()].find(a => a.email === normalizeEmail(email)); }
  findAccountBySubjectId(subjectId: string) { return this.accounts.get(subjectId); }
  saveAccount(account: ConsumerAccount) { this.accounts.set(account.subjectId, account); }
  saveToken(token: IdentityToken) { this.tokens.set(token.id, token); }
  findToken(kind: TokenKind, tokenHash: string) { return [...this.tokens.values()].find(t => t.kind === kind && safeEqual(t.tokenHash, tokenHash)); }
  revokeTokens(subjectId: string, kind?: TokenKind) { for (const token of this.tokens.values()) if (token.subjectId === subjectId && (!kind || token.kind === kind)) token.revokedAt = Date.now(); }
}

const normalizeEmail = (email: string) => email.trim().toLowerCase();
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const safeEqual = (a: string, b: string) => { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
const passwordHash = (password: string, salt = randomBytes(16).toString('hex')) => `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
const verifyPassword = (password: string, encoded: string) => { const [salt, expected] = encoded.split(':'); if (!salt || !expected) return false; return safeEqual(scryptSync(password, salt, 64).toString('hex'), expected); };

export class IdentityEngine {
  constructor(private readonly repo: IdentityRepository = new MemoryIdentityRepository()) {}

  register(email: string, password: string) {
    const normalized = normalizeEmail(email);
    const existing = this.repo.findAccountByEmail(normalized);
    if (existing && existing.status !== 'closed') return { account: existing, created: false as const };
    const now = new Date().toISOString();
    const account: ConsumerAccount = { subjectId: randomUUID(), email: normalized, passwordHash: passwordHash(password), status: 'pending_verification', mfaEnabled: false, createdAt: now, updatedAt: now };
    this.repo.saveAccount(account);
    return { account, created: true as const };
  }

  issueToken(subjectId: string, kind: TokenKind, ttlMs: number) {
    const raw = randomBytes(32).toString('base64url');
    this.repo.saveToken({ id: randomUUID(), subjectId, kind, tokenHash: hashToken(raw), expiresAt: Date.now() + ttlMs });
    return raw;
  }

  consumeToken(raw: string, kind: TokenKind) {
    const token = this.repo.findToken(kind, hashToken(raw));
    if (!token || token.revokedAt || token.consumedAt || token.expiresAt <= Date.now()) return null;
    token.consumedAt = Date.now();
    return token;
  }

  verifyEmail(raw: string) {
    const token = this.consumeToken(raw, 'email_verification');
    if (!token) return null;
    const account = this.repo.findAccountBySubjectId(token.subjectId);
    if (!account || account.status === 'closed') return null;
    account.status = 'active'; account.emailVerifiedAt = new Date().toISOString(); account.updatedAt = account.emailVerifiedAt;
    this.repo.saveAccount(account); return account;
  }

  authenticate(email: string, password: string) {
    const account = this.repo.findAccountByEmail(email);
    if (!account || account.status !== 'active' || !verifyPassword(password, account.passwordHash)) return null;
    return account;
  }

  changePassword(subjectId: string, password: string) {
    const account = this.repo.findAccountBySubjectId(subjectId);
    if (!account || account.status === 'closed') return false;
    account.passwordHash = passwordHash(password); account.updatedAt = new Date().toISOString(); this.repo.saveAccount(account);
    this.repo.revokeTokens(subjectId, 'refresh'); return true;
  }

  setStatus(subjectId: string, status: AccountStatus) {
    const account = this.repo.findAccountBySubjectId(subjectId); if (!account) return false;
    account.status = status; account.updatedAt = new Date().toISOString(); this.repo.saveAccount(account);
    if (status === 'suspended' || status === 'closed') this.repo.revokeTokens(subjectId);
    return true;
  }

  enableMfa(subjectId: string) { const account = this.repo.findAccountBySubjectId(subjectId); if (!account || account.status !== 'active') return false; account.mfaEnabled = true; account.updatedAt = new Date().toISOString(); this.repo.saveAccount(account); return true; }
  canCreateSession(subjectId: string) { return this.repo.findAccountBySubjectId(subjectId)?.status === 'active'; }
}
