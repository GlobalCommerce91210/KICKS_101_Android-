import type { Pool } from 'pg';

export type DeviceRecord = { id: string; subjectId: string; tokenHash: string; revoked: boolean };
export interface DeviceRepository {
  create(device: DeviceRecord, environment: 'staging' | 'production'): Promise<void>;
  findActiveByTokenHash(tokenHash: string): Promise<DeviceRecord | null>;
  revokeByTokenHash(tokenHash: string): Promise<boolean>;
}

export class PostgresDeviceRepository implements DeviceRepository {
  constructor(private readonly pool: Pool) {}

  async create(device: DeviceRecord, environment: 'staging' | 'production'): Promise<void> {
    await this.pool.query(
      'INSERT INTO devices (id, subject_id, token_hash, environment) VALUES ($1, $2, $3, $4)',
      [device.id, device.subjectId, device.tokenHash, environment]
    );
  }

  async revokeByTokenHash(tokenHash: string): Promise<boolean> {
    const result = await this.pool.query(
      'UPDATE devices SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL RETURNING id',
      [tokenHash]
    );
    return result.rowCount === 1;
  }

  async findActiveByTokenHash(tokenHash: string): Promise<DeviceRecord | null> {
    const result = await this.pool.query<{ id: string; subject_id: string; token_hash: string; revoked_at: Date | null }>(
      'SELECT id, subject_id, token_hash, revoked_at FROM devices WHERE token_hash = $1 AND revoked_at IS NULL LIMIT 1',
      [tokenHash]
    );
    const row = result.rows[0];
    return row ? { id: row.id, subjectId: row.subject_id, tokenHash: row.token_hash, revoked: Boolean(row.revoked_at) } : null;
  }
}
