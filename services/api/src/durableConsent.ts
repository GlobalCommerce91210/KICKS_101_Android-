import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

export type ConsentAction = 'GRANT' | 'DENY' | 'REVOKE';
export type StampState = 'PENDING_PROVIDER' | 'PENDING_STAMP' | 'SUBMITTED' | 'VERIFIED' | 'FAILED' | 'REORGED';
export interface ConsentDecisionInput {
  deviceId: string;
  userId: string;
  scope: string;
  action: ConsentAction;
  policyVersion: string;
  disclosureVersion: string;
  actorId: string;
  idempotencyKey: string;
  expectedDecisionVersion?: number;
}
export interface StampProvider {
  readonly providerId: string;
  submit(input: { receiptId: string; proofHash: string; idempotencyKey: string }): Promise<{ transactionReference: string; chainIdentifier: string }>;
}
export interface VerificationEvidence {
  result: 'VERIFIED' | 'FAILED' | 'PENDING' | 'REORGED';
  chainIdentifier: string;
  transactionReference: string;
  proofHash: string;
  finalityEvidence?: Record<string, unknown>;
  verifierVersion: string;
}
export interface IndependentStampVerifier {
  verify(input: { receiptId: string; expectedProofHash: string; chainIdentifier: string; transactionReference: string }): Promise<VerificationEvidence>;
}
export class ProviderUnavailableError extends Error {
  constructor() { super('PENDING_PROVIDER'); this.name = 'ProviderUnavailableError'; }
}
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const canonical = (v: ConsentDecisionInput, decisionId: string, receiptId: string, version: number, serverTime: string) =>
  JSON.stringify({ schema: 'kicks-consent-proof-v1', decisionId, receiptId, userId: v.userId, deviceId: v.deviceId, scope: v.scope, action: v.action, policyVersion: v.policyVersion, disclosureVersion: v.disclosureVersion, decisionVersion: version, serverTimestamp: serverTime, actorId: v.actorId });

/**
 * PostgreSQL-backed consent boundary. Caller MUST derive actorId and userId
 * from trusted authentication context and verify device ownership before use.
 * No blockchain/provider calls occur inside the database transaction.
 */
export class DurableConsentService {
  constructor(private readonly pool: Pool, private readonly provider?: StampProvider, private readonly verifier?: IndependentStampVerifier) {}

  async decide(input: ConsentDecisionInput) {
    if (!input.idempotencyKey || input.idempotencyKey.length > 200) throw new Error('INVALID_IDEMPOTENCY_KEY');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const device = await client.query<{ subject_id: string; revoked_at: Date | null }>(
        'SELECT subject_id, revoked_at FROM devices WHERE id=$1 FOR UPDATE', [input.deviceId]);
      if (!device.rowCount || device.rows[0].revoked_at || device.rows[0].subject_id !== input.userId) throw new Error('DEVICE_OWNERSHIP_OR_ENROLLMENT_FAILED');

      const prior = await client.query(
        'SELECT d.decision_id,d.receipt_id,d.decision,d.decision_version,d.request_fingerprint,r.verification_status FROM consent_decisions d JOIN consent_receipts r USING(receipt_id) WHERE d.authenticated_actor_id=$1 AND d.idempotency_key=$2',
        [input.actorId, input.idempotencyKey]);
      if (prior.rowCount) {
        await client.query('COMMIT');
        return { ...prior.rows[0], idempotentReplay: true };
      }

      const latest = await client.query<{ decision_version: string; decision_id: string }>(
        'SELECT decision_version, decision_id FROM consent_decisions WHERE user_id=$1 AND device_id=$2 AND consent_scope=$3 ORDER BY decision_version DESC LIMIT 1 FOR UPDATE',
        [input.userId, input.deviceId, input.scope]);
      const version = latest.rowCount ? Number(latest.rows[0].decision_version) + 1 : 1;
      if (input.expectedDecisionVersion !== undefined && input.expectedDecisionVersion !== (version - 1)) throw new Error('STALE_DECISION');
      const decisionId = randomUUID(), receiptId = randomUUID(), jobId = randomUUID(), now = new Date().toISOString();
      const proofHash = sha256(canonical(input, decisionId, receiptId, version, now));
      const fingerprint = sha256(JSON.stringify({ ...input, actorId: input.actorId }));
      await client.query(
        'INSERT INTO consent_decisions(decision_id,user_id,device_id,consent_scope,decision,policy_version,disclosure_version,decision_version,server_timestamp,previous_decision_id,authenticated_actor_id,receipt_id,idempotency_key,request_fingerprint) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
        [decisionId,input.userId,input.deviceId,input.scope,input.action,input.policyVersion,input.disclosureVersion,version,now,latest.rows[0]?.decision_id ?? null,input.actorId,receiptId,input.idempotencyKey,fingerprint]);
      const stampStatus = this.provider ? 'PENDING_STAMP' : 'PENDING_PROVIDER';
      await client.query(
        'INSERT INTO consent_receipts(receipt_id,decision_id,canonical_proof_hash,hash_algorithm,verification_status) VALUES($1,$2,$3,\'sha256\',$4)',
        [receiptId,decisionId,proofHash,stampStatus]);
      if (this.provider) {
        await client.query(
          'INSERT INTO consent_stamp_jobs(job_id,receipt_id,provider_id,idempotency_key,status) VALUES($1,$2,$3,$4,\'PENDING\')',
          [jobId,receiptId,this.provider.providerId,sha256('stamp:'+receiptId)]);
      }
      // Revocation takes effect in this transaction; stamping is deliberately not awaited.
      if (input.action === 'REVOKE' || input.action === 'DENY') {
        await client.query(
          'UPDATE collector_authorizations SET revoked_at=now(), invalidated_reason=$4 WHERE user_id=$1 AND device_id=$2 AND consent_scope=$3 AND revoked_at IS NULL',
          [input.userId,input.deviceId,input.scope,input.action]);
      }
      await client.query(
        'INSERT INTO consent_decision_audit(audit_id,decision_id,actor_id,action,outcome,correlation_id) VALUES($1,$2,$3,$4,\'ACCEPTED\',$5)',
        [randomUUID(),decisionId,input.actorId,input.action,randomUUID()]);
      await client.query('COMMIT');
      return { decisionId, receiptId, decision: input.action, decisionVersion: version, proofHash, verificationStatus: stampStatus, idempotentReplay: false };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  /** One worker attempt. Provider submission never changes receipt to VERIFIED. */
  async submitStampJob(jobId: string): Promise<void> {
    if (!this.provider) throw new ProviderUnavailableError();
    const client = await this.pool.connect();
    let job: any;
    try {
      const r = await client.query(
        'SELECT j.*,r.canonical_proof_hash FROM consent_stamp_jobs j JOIN consent_receipts r USING(receipt_id) WHERE j.job_id=$1 AND j.status IN (\'PENDING\',\'FAILED\') AND j.next_attempt_at<=now() FOR UPDATE OF j SKIP LOCKED', [jobId]);
      if (!r.rowCount) return;
      job = r.rows[0];
      const submitted = await this.provider.submit({ receiptId: job.receipt_id, proofHash: job.canonical_proof_hash, idempotencyKey: job.idempotency_key });
      await client.query('BEGIN');
      await client.query(
        'UPDATE consent_stamp_jobs SET status=\'SUBMITTED\',attempt_count=attempt_count+1,transaction_reference=$2,chain_identifier=$3,last_error_code=NULL,updated_at=now() WHERE job_id=$1',
        [jobId,submitted.transactionReference,submitted.chainIdentifier]);
      await client.query('UPDATE consent_receipts SET verification_status=\'SUBMITTED\' WHERE receipt_id=$1 AND verification_status <> \'VERIFIED\'', [job.receipt_id]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (job) await client.query(
        'UPDATE consent_stamp_jobs SET attempt_count=attempt_count+1,status=CASE WHEN attempt_count+1>=8 THEN \'DEAD_LETTER\' ELSE \'FAILED\' END,next_attempt_at=now()+LEAST(interval \'1 hour\', interval \'5 seconds\' * power(2,LEAST(attempt_count,10))),last_error_code=$2,updated_at=now() WHERE job_id=$1',
        [jobId, e instanceof ProviderUnavailableError ? 'PENDING_PROVIDER' : 'SUBMISSION_FAILED']).catch(() => undefined);
      throw e;
    } finally { client.release(); }
  }

  /** Only independent evidence can mark a receipt VERIFIED. */
  async verifyReceipt(receiptId: string): Promise<VerificationEvidence> {
    if (!this.verifier) throw new ProviderUnavailableError();
    const r = await this.pool.query(
      'SELECT r.canonical_proof_hash,j.chain_identifier,j.transaction_reference FROM consent_receipts r JOIN consent_stamp_jobs j USING(receipt_id) WHERE r.receipt_id=$1 AND j.status=\'SUBMITTED\' ORDER BY j.updated_at DESC LIMIT 1', [receiptId]);
    if (!r.rowCount || !r.rows[0].chain_identifier || !r.rows[0].transaction_reference) throw new Error('STAMP_EVIDENCE_UNAVAILABLE');
    const row = r.rows[0];
    const evidence = await this.verifier.verify({ receiptId, expectedProofHash: row.canonical_proof_hash, chainIdentifier: row.chain_identifier, transactionReference: row.transaction_reference });
    const valid = evidence.result === 'VERIFIED' && evidence.proofHash === row.canonical_proof_hash && evidence.chainIdentifier === row.chain_identifier && evidence.transactionReference === row.transaction_reference && !!evidence.finalityEvidence;
    const result = valid ? 'VERIFIED' : evidence.result === 'PENDING' ? 'PENDING' : evidence.result === 'REORGED' ? 'REORGED' : 'FAILED';
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const verificationId = randomUUID();
      await client.query(
        'INSERT INTO consent_stamp_verifications(verification_id,receipt_id,chain_identifier,transaction_reference,proof_hash,verification_result,finality_evidence,verifier_version,verified_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,CASE WHEN $6=\'VERIFIED\' THEN now() ELSE NULL END)',
        [verificationId,receiptId,evidence.chainIdentifier,evidence.transactionReference,evidence.proofHash,result,evidence.finalityEvidence ?? null,evidence.verifierVersion]);
      await client.query('UPDATE consent_receipts SET verification_status=$2 WHERE receipt_id=$1', [receiptId,result]);
      await client.query('UPDATE consent_stamp_jobs SET status=CASE WHEN $2=\'VERIFIED\' THEN \'VERIFIED\' WHEN $2=\'REORGED\' THEN \'FAILED\' ELSE status END,updated_at=now() WHERE receipt_id=$1', [receiptId,result]);
      await client.query('COMMIT');
      return { ...evidence, result };
    } catch (e) { await client.query('ROLLBACK').catch(() => undefined); throw e; }
    finally { client.release(); }
  }
}
