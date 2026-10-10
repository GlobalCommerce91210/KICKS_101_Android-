import { createHash } from 'node:crypto';
import { Pool } from 'pg';

export interface AccountIdempotencyRecord {
  fingerprint: string;
  subject_id: string;
}

const hashKey = (value: string) => createHash('sha256').update(value).digest('hex');

export interface AccountIdempotencyStore {
  find(key: string): Promise<AccountIdempotencyRecord | null>;
  save(key: string, record: AccountIdempotencyRecord): Promise<void>;
  close(): Promise<void>;
}

export class MemoryAccountIdempotencyStore implements AccountIdempotencyStore {
  private static readonly records = new Map<string, AccountIdempotencyRecord>();

  async find(key: string): Promise<AccountIdempotencyRecord | null> {
    const record = MemoryAccountIdempotencyStore.records.get(hashKey(key));
    return record ? { ...record } : null;
  }

  async save(key: string, record: AccountIdempotencyRecord): Promise<void> {
    const keyHash = hashKey(key);
    const existing = MemoryAccountIdempotencyStore.records.get(keyHash);
    if (existing && (existing.fingerprint !== record.fingerprint || existing.subject_id !== record.subject_id)) {
      throw new Error('idempotency_conflict');
    }
    MemoryAccountIdempotencyStore.records.set(keyHash, { ...record });
  }

  async close(): Promise<void> {}
}

export class PostgresAccountIdempotencyStore implements AccountIdempotencyStore {
  private schemaReady: Promise<void> | null = null;

  constructor(private readonly pool: Pool) {}

  static fromConnectionString(connectionString: string) {
    return new PostgresAccountIdempotencyStore(new Pool({ connectionString }));
  }

  private ensureSchema(): Promise<void> {
    if (!this.schemaReady) {
      this.schemaReady = this.pool.query(`
        CREATE TABLE IF NOT EXISTS consumer_account_idempotency (
          idempotency_key_hash TEXT PRIMARY KEY,
          fingerprint TEXT NOT NULL,
          subject_id TEXT NOT NULL REFERENCES consumer_accounts(subject_id),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_consumer_account_idempotency_subject
          ON consumer_account_idempotency(subject_id);
      `).then(() => undefined);
    }
    return this.schemaReady;
  }

  async find(key: string): Promise<AccountIdempotencyRecord | null> {
    await this.ensureSchema();
    const result = await this.pool.query(
      `SELECT fingerprint, subject_id
       FROM consumer_account_idempotency
       WHERE idempotency_key_hash=$1`,
      [hashKey(key)],
    );
    return result.rows[0]
      ? { fingerprint: String(result.rows[0].fingerprint), subject_id: String(result.rows[0].subject_id) }
      : null;
  }

  async save(key: string, record: AccountIdempotencyRecord): Promise<void> {
    await this.ensureSchema();
    const keyHash = hashKey(key);
    const result = await this.pool.query(
      `INSERT INTO consumer_account_idempotency(idempotency_key_hash,fingerprint,subject_id)
       VALUES($1,$2,$3)
       ON CONFLICT (idempotency_key_hash) DO UPDATE
       SET idempotency_key_hash=EXCLUDED.idempotency_key_hash
       WHERE consumer_account_idempotency.fingerprint=EXCLUDED.fingerprint
         AND consumer_account_idempotency.subject_id=EXCLUDED.subject_id
       RETURNING fingerprint, subject_id`,
      [keyHash, record.fingerprint, record.subject_id],
    );
    if ((result.rowCount ?? 0) === 0) throw new Error('idempotency_conflict');
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export function createAccountIdempotencyStore(): AccountIdempotencyStore {
  const databaseUrl = process.env.DATABASE_URL ?? process.env.KICKS_DATABASE_URL;
  return databaseUrl
    ? PostgresAccountIdempotencyStore.fromConnectionString(databaseUrl)
    : new MemoryAccountIdempotencyStore();
}
