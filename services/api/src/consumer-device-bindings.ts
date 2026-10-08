import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

export interface ConsumerDeviceBinding {
  binding_id: string;
  subject_id: string;
  device_id: string;
  collector_subject_id: string;
  status: 'active' | 'revoked';
  display_name: string | null;
  platform: 'android' | 'ios' | 'web' | 'other';
  app_version: string | null;
  bound_at: string;
  revoked_at: string | null;
}

export interface ConsumerDeviceBindingStore {
  bind(input: {
    subjectId: string;
    deviceId: string;
    collectorSubjectId: string;
    displayName?: string | null;
    platform?: ConsumerDeviceBinding['platform'];
    appVersion?: string | null;
  }): Promise<ConsumerDeviceBinding>;

  list(subjectId: string): Promise<ConsumerDeviceBinding[]>;

  revoke(
    subjectId: string,
    deviceId: string,
  ): Promise<boolean>;

  close(): Promise<void>;
}

const clone = (binding: ConsumerDeviceBinding): ConsumerDeviceBinding => ({
  ...binding,
});

export class MemoryConsumerDeviceBindingStore
implements ConsumerDeviceBindingStore {
  private bindings = new Map<string, ConsumerDeviceBinding>();

  async bind(input: {
    subjectId: string;
    deviceId: string;
    collectorSubjectId: string;
    displayName?: string | null;
    platform?: ConsumerDeviceBinding['platform'];
    appVersion?: string | null;
  }): Promise<ConsumerDeviceBinding> {
    const key = `${input.subjectId}:${input.deviceId}`;
    const existing = this.bindings.get(key);

    if (existing?.status === 'active') return clone(existing);

    const binding: ConsumerDeviceBinding = {
      binding_id: existing?.binding_id ?? `bind_${randomUUID()}`,
      subject_id: input.subjectId,
      device_id: input.deviceId,
      collector_subject_id: input.collectorSubjectId,
      status: 'active',
      display_name: input.displayName?.trim() || null,
      platform: input.platform ?? 'android',
      app_version: input.appVersion?.trim() || null,
      bound_at: new Date().toISOString(),
      revoked_at: null,
    };

    this.bindings.set(key, binding);
    return clone(binding);
  }

  async list(subjectId: string): Promise<ConsumerDeviceBinding[]> {
    return [...this.bindings.values()]
      .filter(
        binding =>
          binding.subject_id === subjectId &&
          binding.status === 'active',
      )
      .map(clone);
  }

  async revoke(subjectId: string, deviceId: string): Promise<boolean> {
    const key = `${subjectId}:${deviceId}`;
    const binding = this.bindings.get(key);

    if (!binding || binding.status !== 'active') return false;

    binding.status = 'revoked';
    binding.revoked_at = new Date().toISOString();
    return true;
  }

  async close(): Promise<void> {}
}

function mapBinding(row: Record<string, unknown>): ConsumerDeviceBinding {
  return {
    binding_id: String(row.binding_id),
    subject_id: String(row.subject_id),
    device_id: String(row.device_id),
    collector_subject_id: String(row.collector_subject_id),
    status: row.status as ConsumerDeviceBinding['status'],
    display_name:
      row.display_name == null ? null : String(row.display_name),
    platform: row.platform as ConsumerDeviceBinding['platform'],
    app_version:
      row.app_version == null ? null : String(row.app_version),
    bound_at: new Date(String(row.bound_at)).toISOString(),
    revoked_at:
      row.revoked_at == null
        ? null
        : new Date(String(row.revoked_at)).toISOString(),
  };
}

export class PostgresConsumerDeviceBindingStore
implements ConsumerDeviceBindingStore {
  private schemaReady: Promise<void> | null = null;

  constructor(private readonly pool: Pool) {}

  static fromConnectionString(connectionString: string) {
    return new PostgresConsumerDeviceBindingStore(
      new Pool({ connectionString }),
    );
  }

  private ensureSchema(): Promise<void> {
    if (!this.schemaReady) {
      this.schemaReady = this.createSchema();
    }
    return this.schemaReady;
  }

  private async createSchema(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS consumer_device_bindings (
        binding_id TEXT PRIMARY KEY,
        subject_id TEXT NOT NULL REFERENCES consumer_accounts(subject_id),
        device_id TEXT NOT NULL,
        collector_subject_id TEXT NOT NULL,
        status TEXT NOT NULL
          CHECK (status IN ('active','revoked')),
        display_name TEXT,
        platform TEXT NOT NULL
          CHECK (platform IN ('android','ios','web','other')),
        app_version TEXT,
        bound_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ,
        UNIQUE(subject_id, device_id)
      );

      CREATE INDEX IF NOT EXISTS idx_consumer_device_bindings_subject
        ON consumer_device_bindings(subject_id, status);

      CREATE INDEX IF NOT EXISTS idx_consumer_device_bindings_device
        ON consumer_device_bindings(device_id);
    `);
  }

  async bind(input: {
    subjectId: string;
    deviceId: string;
    collectorSubjectId: string;
    displayName?: string | null;
    platform?: ConsumerDeviceBinding['platform'];
    appVersion?: string | null;
  }): Promise<ConsumerDeviceBinding> {
    await this.ensureSchema();

    const now = new Date().toISOString();

    const result = await this.pool.query(
      `INSERT INTO consumer_device_bindings(
        binding_id,
        subject_id,
        device_id,
        collector_subject_id,
        status,
        display_name,
        platform,
        app_version,
        bound_at,
        revoked_at
      )
      VALUES($1,$2,$3,$4,'active',$5,$6,$7,$8,NULL)
      ON CONFLICT(subject_id, device_id)
      DO UPDATE SET
        collector_subject_id=EXCLUDED.collector_subject_id,
        status='active',
        display_name=EXCLUDED.display_name,
        platform=EXCLUDED.platform,
        app_version=EXCLUDED.app_version,
        bound_at=EXCLUDED.bound_at,
        revoked_at=NULL
      RETURNING *`,
      [
        `bind_${randomUUID()}`,
        input.subjectId,
        input.deviceId,
        input.collectorSubjectId,
        input.displayName?.trim() || null,
        input.platform ?? 'android',
        input.appVersion?.trim() || null,
        now,
      ],
    );

    return mapBinding(result.rows[0]);
  }

  async list(subjectId: string): Promise<ConsumerDeviceBinding[]> {
    await this.ensureSchema();

    const result = await this.pool.query(
      `SELECT *
       FROM consumer_device_bindings
       WHERE subject_id=$1
         AND status='active'
       ORDER BY bound_at DESC`,
      [subjectId],
    );

    return result.rows.map(mapBinding);
  }

  async revoke(subjectId: string, deviceId: string): Promise<boolean> {
    await this.ensureSchema();

    const result = await this.pool.query(
      `UPDATE consumer_device_bindings
       SET status='revoked',
           revoked_at=NOW()
       WHERE subject_id=$1
         AND device_id=$2
         AND status='active'`,
      [subjectId, deviceId],
    );

    return (result.rowCount ?? 0) > 0;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
