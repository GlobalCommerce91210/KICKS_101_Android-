import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import type {
  AccountBundle,
  ConsumerIdentityStore,
  ConsumerSession,
  CreateAccountInput,
  DataStormAccount,
  KicksConsumerProfile,
  ProductEntitlement,
  SessionBundle,
} from './consumer-identity.js';

const normalizeEmail = (value: string) => value.trim().toLowerCase();
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

  return actual.length === expectedBuffer.length
    && timingSafeEqual(actual, expectedBuffer);
}

function token() {
  return randomBytes(32).toString('base64url');
}

function mapAccount(row: Record<string, unknown>): DataStormAccount {
  return {
    subject_id: String(row.subject_id),
    email: String(row.email),
    password_hash: String(row.password_hash),
    email_verified: Boolean(row.email_verified),
    account_status: row.account_status as DataStormAccount['account_status'],
    region: row.region == null ? null : String(row.region),
    marketing_opt_in: Boolean(row.marketing_opt_in),
    terms_version: String(row.terms_version),
    privacy_version: String(row.privacy_version),
    metadata: (row.metadata ?? {}) as DataStormAccount['metadata'],
    created_at: new Date(String(row.created_at)).toISOString(),
    updated_at: new Date(String(row.updated_at)).toISOString(),
  };
}

function mapEntitlement(row: Record<string, unknown>): ProductEntitlement {
  return {
    entitlement_id: String(row.entitlement_id),
    subject_id: String(row.subject_id),
    product: 'kicks',
    status: row.status as ProductEntitlement['status'],
    granted_at: new Date(String(row.granted_at)).toISOString(),
    updated_at: new Date(String(row.updated_at)).toISOString(),
  };
}

function mapProfile(row: Record<string, unknown>): KicksConsumerProfile {
  return {
    profile_id: String(row.profile_id),
    subject_id: String(row.subject_id),
    entitlement_id: String(row.entitlement_id),
    status: row.status as KicksConsumerProfile['status'],
    created_at: new Date(String(row.created_at)).toISOString(),
    updated_at: new Date(String(row.updated_at)).toISOString(),
  };
}

function mapSession(row: Record<string, unknown>): ConsumerSession {
  return {
    session_id: String(row.session_id),
    subject_id: String(row.subject_id),
    access_token_hash: String(row.access_token_hash),
    refresh_token_hash: String(row.refresh_token_hash),
    access_expires_at: new Date(String(row.access_expires_at)).toISOString(),
    refresh_expires_at: new Date(String(row.refresh_expires_at)).toISOString(),
    revoked_at: row.revoked_at == null
      ? null
      : new Date(String(row.revoked_at)).toISOString(),
    created_at: new Date(String(row.created_at)).toISOString(),
  };
}

export class PostgresConsumerIdentityStore implements ConsumerIdentityStore {
  private schemaReady: Promise<void> | null = null;

  constructor(private readonly pool: Pool) {}

  static fromConnectionString(connectionString: string) {
    return new PostgresConsumerIdentityStore(
      new Pool({ connectionString }),
    );
  }

  private ensureSchema(): Promise<void> {
    if (!this.schemaReady) {
      this.schemaReady = this.createSchema();
    }
    return this.schemaReady;
  }

  private async createSchema() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS consumer_accounts (
        subject_id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        email_verified BOOLEAN NOT NULL DEFAULT FALSE,
        account_status TEXT NOT NULL
          CHECK (account_status IN ('pending_verification','active','suspended','closed')),
        region TEXT,
        marketing_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
        terms_version TEXT NOT NULL,
        privacy_version TEXT NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS product_entitlements (
        entitlement_id TEXT PRIMARY KEY,
        subject_id TEXT NOT NULL REFERENCES consumer_accounts(subject_id),
        product TEXT NOT NULL CHECK (product = 'kicks'),
        status TEXT NOT NULL
          CHECK (status IN ('active','suspended','revoked')),
        granted_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        UNIQUE(subject_id, product)
      );

      CREATE TABLE IF NOT EXISTS kicks_consumer_profiles (
        profile_id TEXT PRIMARY KEY,
        subject_id TEXT NOT NULL UNIQUE REFERENCES consumer_accounts(subject_id),
        entitlement_id TEXT NOT NULL UNIQUE REFERENCES product_entitlements(entitlement_id),
        status TEXT NOT NULL CHECK (status IN ('active','suspended')),
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS consumer_sessions (
        session_id TEXT PRIMARY KEY,
        subject_id TEXT NOT NULL REFERENCES consumer_accounts(subject_id),
        access_token_hash TEXT NOT NULL UNIQUE,
        refresh_token_hash TEXT NOT NULL UNIQUE,
        access_expires_at TIMESTAMPTZ NOT NULL,
        refresh_expires_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_consumer_sessions_subject
        ON consumer_sessions(subject_id);

      CREATE INDEX IF NOT EXISTS idx_consumer_sessions_access
        ON consumer_sessions(access_token_hash);

      CREATE INDEX IF NOT EXISTS idx_consumer_sessions_refresh
        ON consumer_sessions(refresh_token_hash);
    `);
  }

  async createAccount(input: CreateAccountInput): Promise<AccountBundle> {
    await this.ensureSchema();

    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      const email = normalizeEmail(input.email);
      const now = new Date().toISOString();
      const subjectId = `ds_sub_${randomUUID()}`;
      const entitlementId = `ent_${randomUUID()}`;
      const profileId = `kicks_profile_${randomUUID()}`;

      const accountResult = await client.query(
        `INSERT INTO consumer_accounts(
          subject_id,email,password_hash,email_verified,account_status,
          region,marketing_opt_in,terms_version,privacy_version,metadata,
          created_at,updated_at
        ) VALUES($1,$2,$3,FALSE,'pending_verification',$4,$5,$6,$7,$8,$9,$9)
        RETURNING *`,
        [
          subjectId,
          email,
          hashPassword(input.password),
          input.region?.trim() || null,
          input.marketing_opt_in === true,
          input.terms_version,
          input.privacy_version,
          input.metadata ?? {},
          now,
        ],
      );

      const entitlementResult = await client.query(
        `INSERT INTO product_entitlements(
          entitlement_id,subject_id,product,status,granted_at,updated_at
        ) VALUES($1,$2,'kicks','active',$3,$3)
        RETURNING *`,
        [entitlementId, subjectId, now],
      );

      const profileResult = await client.query(
        `INSERT INTO kicks_consumer_profiles(
          profile_id,subject_id,entitlement_id,status,created_at,updated_at
        ) VALUES($1,$2,$3,'active',$4,$4)
        RETURNING *`,
        [profileId, subjectId, entitlementId, now],
      );

      await client.query('COMMIT');

      return {
        account: mapAccount(accountResult.rows[0]),
        entitlement: mapEntitlement(entitlementResult.rows[0]),
        profile: mapProfile(profileResult.rows[0]),
      };
    } catch (error) {
      await client.query('ROLLBACK');

      if (
        typeof error === 'object'
        && error !== null
        && 'code' in error
        && error.code === '23505'
      ) {
        throw new Error('account_exists');
      }

      throw error;
    } finally {
      client.release();
    }
  }

  async findAccountByEmail(email: string): Promise<DataStormAccount | null> {
    await this.ensureSchema();

    const result = await this.pool.query(
      'SELECT * FROM consumer_accounts WHERE email=$1',
      [normalizeEmail(email)],
    );

    return result.rows[0] ? mapAccount(result.rows[0]) : null;
  }

  async findAccountBySubjectId(subjectId: string): Promise<DataStormAccount | null> {
    await this.ensureSchema();

    const result = await this.pool.query(
      'SELECT * FROM consumer_accounts WHERE subject_id=$1',
      [subjectId],
    );

    return result.rows[0] ? mapAccount(result.rows[0]) : null;
  }

  async getKicksEntitlement(subjectId: string): Promise<ProductEntitlement | null> {
    await this.ensureSchema();

    const result = await this.pool.query(
      `SELECT * FROM product_entitlements
       WHERE subject_id=$1 AND product='kicks'`,
      [subjectId],
    );

    return result.rows[0] ? mapEntitlement(result.rows[0]) : null;
  }

  async getKicksProfile(subjectId: string): Promise<KicksConsumerProfile | null> {
    await this.ensureSchema();

    const result = await this.pool.query(
      'SELECT * FROM kicks_consumer_profiles WHERE subject_id=$1',
      [subjectId],
    );

    return result.rows[0] ? mapProfile(result.rows[0]) : null;
  }

  async authenticate(email: string, password: string): Promise<SessionBundle | null> {
    const account = await this.findAccountByEmail(email);

    if (
      !account
      || account.account_status === 'suspended'
      || account.account_status === 'closed'
      || !verifyPassword(password, account.password_hash)
    ) {
      return null;
    }

    return this.issueSession(account.subject_id);
  }

  async findSessionByAccessToken(accessToken: string): Promise<ConsumerSession | null> {
    await this.ensureSchema();

    const result = await this.pool.query(
      `SELECT * FROM consumer_sessions
       WHERE access_token_hash=$1
         AND revoked_at IS NULL
         AND access_expires_at > NOW()
       LIMIT 1`,
      [sha256(accessToken)],
    );

    return result.rows[0] ? mapSession(result.rows[0]) : null;
  }

  async refreshSession(refreshToken: string): Promise<SessionBundle | null> {
    await this.ensureSchema();

    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      const existing = await client.query(
        `SELECT * FROM consumer_sessions
         WHERE refresh_token_hash=$1
           AND revoked_at IS NULL
           AND refresh_expires_at > NOW()
         FOR UPDATE`,
        [sha256(refreshToken)],
      );

      if (!existing.rows[0]) {
        await client.query('ROLLBACK');
        return null;
      }

      const session = mapSession(existing.rows[0]);

      await client.query(
        'UPDATE consumer_sessions SET revoked_at=NOW() WHERE session_id=$1',
        [session.session_id],
      );

      const issued = await this.issueSessionWithClient(
        client,
        session.subject_id,
      );

      await client.query('COMMIT');
      return issued;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async revokeSession(accessToken: string): Promise<boolean> {
    await this.ensureSchema();

    const result = await this.pool.query(
      `UPDATE consumer_sessions
       SET revoked_at=NOW()
       WHERE access_token_hash=$1
         AND revoked_at IS NULL`,
      [sha256(accessToken)],
    );

    return (result.rowCount ?? 0) > 0;
  }

  async verifyEmail(subjectId: string): Promise<DataStormAccount | null> {
    await this.ensureSchema();

    const result = await this.pool.query(
      `UPDATE consumer_accounts
       SET email_verified=TRUE,
           account_status='active',
           updated_at=NOW()
       WHERE subject_id=$1
       RETURNING *`,
      [subjectId],
    );

    return result.rows[0] ? mapAccount(result.rows[0]) : null;
  }

  private async issueSession(subjectId: string): Promise<SessionBundle> {
    await this.ensureSchema();

    const client = await this.pool.connect();

    try {
      return await this.issueSessionWithClient(client, subjectId);
    } finally {
      client.release();
    }
  }

  private async issueSessionWithClient(
    client: PoolClient,
    subjectId: string,
  ): Promise<SessionBundle> {
    const accessToken = token();
    const refreshToken = token();
    const now = Date.now();

    const result = await client.query(
      `INSERT INTO consumer_sessions(
        session_id,subject_id,access_token_hash,refresh_token_hash,
        access_expires_at,refresh_expires_at,revoked_at,created_at
      ) VALUES($1,$2,$3,$4,$5,$6,NULL,$7)
      RETURNING *`,
      [
        `sess_${randomUUID()}`,
        subjectId,
        sha256(accessToken),
        sha256(refreshToken),
        new Date(now + 15 * 60 * 1000).toISOString(),
        new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString(),
        new Date(now).toISOString(),
      ],
    );

    return {
      session: mapSession(result.rows[0]),
      access_token: accessToken,
      refresh_token: refreshToken,
    };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
