import type { Pool } from 'pg';

export interface CollectorRecoveryAuthority {
  assertReady(epoch: string): Promise<void>;
  revoke(deviceId: string, activationId: string | null): Promise<void>;
  isRevoked(deviceId: string, activationId: string): Promise<boolean>;
}

// Tests only. Runtime wiring requires a separate durable authority database.
export class MemoryCollectorRecoveryAuthority implements CollectorRecoveryAuthority {
  held = false;
  private revoked = new Set<string>();
  constructor(public epoch: string) {}
  async assertReady(epoch: string) { if (this.held || epoch !== this.epoch) throw Error('collector_recovery_hold'); }
  async revoke(deviceId: string, activationId: string | null) { this.revoked.add(JSON.stringify([deviceId, activationId])); }
  async isRevoked(deviceId: string, activationId: string) {
    return this.revoked.has(JSON.stringify([deviceId, null])) || this.revoked.has(JSON.stringify([deviceId, activationId]));
  }
}

// No automatic schema/bootstrap: a missing checkpoint must never become permission.
// This pool must use a database outside the primary database's recovery boundary.
export class PostgresCollectorRecoveryAuthority implements CollectorRecoveryAuthority {
  constructor(private readonly pool: Pool) {}
  async assertReady(epoch: string) {
    const row = (await this.pool.query('SELECT epoch,held FROM collector_recovery_checkpoint WHERE singleton=true')).rows[0];
    if (!row || row.held || row.epoch !== epoch) throw Error('collector_recovery_hold');
  }
  async revoke(deviceId: string, activationId: string | null) {
    // Independent commit precedes primary consent/unlink mutation. A primary rollback
    // can over-restrict access, never resurrect an authorization that was withdrawn.
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN'); await client.query("SET LOCAL synchronous_commit = 'on'");
      await client.query(`INSERT INTO collector_revocations(device_id,activation_id)
        VALUES($1,$2) ON CONFLICT DO NOTHING`, [deviceId, activationId ?? '*']);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async isRevoked(deviceId: string, activationId: string) {
    return Boolean((await this.pool.query("SELECT 1 FROM collector_revocations WHERE device_id=$1 AND activation_id IN ($2,'*') LIMIT 1", [deviceId, activationId])).rowCount);
  }
}
