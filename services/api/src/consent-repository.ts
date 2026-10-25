import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

export type ConsentAction = 'grant' | 'deny' | 'revoke';
export type ConsentDecision = {
  permissionId: string;
  subjectId: string;
  action: ConsentAction;
  policyVersion: string;
  purposeVersion: string;
  purpose: string;
};
export type ConsentEvent = ConsentDecision & { id: string; occurredAt: string };
export type CurrentConsent = {
  id: string;
  subjectId: string;
  purpose: string;
  policyVersion: string;
  purposeVersion: string;
  state: 'granted' | 'revoked';
};
export interface ConsentRepository {
  recordDecision(input: ConsentDecision): Promise<ConsentEvent>;
  getCurrent(permissionId: string): Promise<CurrentConsent | null>;
  getHistory(permissionId: string, subjectId: string): Promise<ConsentEvent[]>;
}

export class PostgresConsentRepository implements ConsentRepository {
  constructor(private readonly pool: Pool) {}

  async recordDecision(input: ConsentDecision): Promise<ConsentEvent> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Serialize changes to a permission so ownership checks and event ordering cannot race.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [input.permissionId]);
      const prior = await client.query<{ subject_id: string }>(
        'SELECT subject_id FROM consent_events WHERE permission_id = $1 ORDER BY occurred_at DESC, id DESC LIMIT 1',
        [input.permissionId]
      );
      if (prior.rows[0] && prior.rows[0].subject_id !== input.subjectId) {
        const error = new Error('permission_owned_by_another_subject');
        (error as Error & { code?: string }).code = 'CONSENT_OWNER_MISMATCH';
        throw error;
      }
      const id = randomUUID();
      const result = await client.query<{ occurred_at: Date | string }>(
        `INSERT INTO consent_events
          (id, subject_id, permission_id, action, policy_version, purpose_version, correlation_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING occurred_at`,
        [id, input.subjectId, input.permissionId, input.action, input.policyVersion, input.purposeVersion, id]
      );
      await client.query('COMMIT');
      return { ...input, id, occurredAt: new Date(result.rows[0].occurred_at).toISOString() };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async getCurrent(permissionId: string): Promise<CurrentConsent | null> {
    const result = await this.pool.query<{
      id: string; subject_id: string; action: ConsentAction; policy_version: string;
      purpose_version: string; occurred_at: Date | string;
    }>(
      'SELECT id, subject_id, action, policy_version, purpose_version, occurred_at FROM consent_events WHERE permission_id = $1 ORDER BY occurred_at DESC, id DESC LIMIT 1',
      [permissionId]
    );
    const row = result.rows[0];
    if (!row) return null;
    // The schema does not yet persist purpose. Until it does, protected ingestion must
    // fail closed for PostgreSQL-backed consent rather than guess the purpose.
    return {
      id: permissionId, subjectId: row.subject_id, purpose: '',
      policyVersion: row.policy_version, purposeVersion: row.purpose_version,
      state: row.action === 'grant' ? 'granted' : 'revoked'
    };
  }

  async getHistory(permissionId: string, subjectId: string): Promise<ConsentEvent[]> {
    const result = await this.pool.query<{
      id: string; subject_id: string; action: ConsentAction; policy_version: string;
      purpose_version: string; occurred_at: Date | string;
    }>(
      'SELECT id, subject_id, action, policy_version, purpose_version, occurred_at FROM consent_events WHERE permission_id = $1 AND subject_id = $2 ORDER BY occurred_at ASC, id ASC',
      [permissionId, subjectId]
    );
    return result.rows.map(row => ({
      id: row.id, permissionId, subjectId: row.subject_id, action: row.action,
      policyVersion: row.policy_version, purposeVersion: row.purpose_version,
      purpose: '', occurredAt: new Date(row.occurred_at).toISOString()
    }));
  }
}
