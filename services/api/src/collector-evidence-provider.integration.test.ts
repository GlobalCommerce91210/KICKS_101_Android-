import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { CollectorAuthorizationService } from './collector-authorization.js';
import { PostgresCollectorEvidenceProvider } from './collector-evidence-provider.js';

const databaseUrl = process.env.KICKS_TEST_DATABASE_URL;
const CHAIN = 'eip155:31337';
const purpose = 'Detect unexpected data destinations';

test('PostgreSQL evidence provider authorizes only with complete independently verified evidence', { skip: !databaseUrl }, async () => {
  const adminPool = new Pool({ connectionString: databaseUrl });
  const schema = `kicks_evidence_${randomUUID().replaceAll('-', '')}`;
  let pool: Pool | undefined;
  try {
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, max: 4 });
    await pool.query(await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8'));
    await pool.query(await readFile(new URL('../db/migrations/20261026_collector_evidence.sql', import.meta.url), 'utf8'));
    // migration is idempotent
    await pool.query(await readFile(new URL('../db/migrations/20261026_collector_evidence.sql', import.meta.url), 'utf8'));

    const subject = randomUUID(), deviceId = randomUUID(), permission = randomUUID(), eventId = randomUUID();
    await pool.query("INSERT INTO devices (id, subject_id, token_hash, environment) VALUES ($1,$2,'h','staging')", [deviceId, subject]);
    const decide = (id: string, action: string) => pool!.query(
      "INSERT INTO consent_events (id, request_id, subject_id, permission_id, action, policy_version, purpose_version, purpose, correlation_id) VALUES ($1,$1,$2,$3,$4,'p1','d1',$5,$1)",
      [id, subject, permission, action, purpose]);
    await decide(eventId, 'grant');

    const svc = new CollectorAuthorizationService(new PostgresCollectorEvidenceProvider(pool, { requiredChain: CHAIN }));
    const req = { authenticatedSubject: subject, deviceId, consentScope: permission, purpose, requestedOperation: 'metadata.ingest' as const };
    const state = async () => (await svc.authorizeCollector(req)).state;

    // Empty evidence tables deny, in the order the checks fire.
    assert.equal(await state(), 'BLOCKED_DEVICE_NOT_ENROLLED');
    await pool.query("INSERT INTO device_enrollments (device_id, subject_id, status) VALUES ($1,$2,'ACTIVE')", [deviceId, subject]);
    assert.equal(await state(), 'BLOCKED_POLICY');
    await pool.query("INSERT INTO safety_policies (id, policy_version, disclosure_version, verdict) VALUES ($1,'p1','d1','PASS')", [randomUUID()]);
    assert.equal(await state(), 'BLOCKED_VERIFICATION_FAILED'); // no receipt
    const receiptId = randomUUID();
    await pool.query('INSERT INTO consent_receipts (id, consent_event_id, permission_id, subject_id, decision_version, receipt_hash) VALUES ($1,$2,$3,$4,$6,$5)',
      [receiptId, eventId, permission, subject, createHash('sha256').update(eventId).digest('hex'), eventId]);
    assert.equal(await state(), 'BLOCKED_VERIFICATION_FAILED'); // no proof at all
    const proofId = randomUUID();
    await pool.query("INSERT INTO chain_proofs (id, receipt_id, chain_id, status, submitted_by) VALUES ($1,$2,$3,'PENDING','stamper-1')", [proofId, receiptId, CHAIN]);
    assert.equal(await state(), 'BLOCKED_STAMP_PENDING');

    const verify = (id: string, over: { verifier?: string; result?: string; finality?: boolean; quorum?: number; chain?: string } = {}) =>
      pool!.query('INSERT INTO proof_verifications (id, chain_proof_id, receipt_id, verifier_id, result, chain_id, finality_reached, provider_quorum) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [id, proofId, receiptId, over.verifier ?? 'verifier-1', over.result ?? 'VERIFIED', over.chain ?? CHAIN, over.finality ?? true, over.quorum ?? 2]);
    // Verifier identical to stamper, single provider, non-final or wrong chain never verify.
    await verify(randomUUID(), { verifier: 'stamper-1' });
    assert.equal(await state(), 'BLOCKED_VERIFICATION_FAILED');
    await verify(randomUUID(), { quorum: 1 });
    assert.equal(await state(), 'BLOCKED_VERIFICATION_FAILED');
    await verify(randomUUID(), { finality: false });
    assert.equal(await state(), 'BLOCKED_VERIFICATION_FAILED');
    await verify(randomUUID(), { chain: 'eip155:1' });
    assert.equal(await state(), 'BLOCKED_VERIFICATION_FAILED');
    await verify(randomUUID());
    assert.equal(await state(), 'BLOCKED_OS_PERMISSION'); // proof ok, no attestation
    await pool.query("INSERT INTO os_permission_attestations (id, device_id, status, verifier_id, expires_at) VALUES ($1,$2,'SERVER_VERIFIED','play-integrity', now() + interval '1 hour')", [randomUUID(), deviceId]);
    const ok = await svc.authorizeCollector(req);
    assert.equal(ok.state, 'ELIGIBLE');

    // A different subject can't use this device.
    assert.equal((await svc.authorizeCollector({ ...req, authenticatedSubject: randomUUID() })).state, 'BLOCKED_DEVICE_NOT_ENROLLED');

    // Immutability of evidence rows.
    await assert.rejects(pool.query('UPDATE consent_receipts SET receipt_hash = $1', ['0'.repeat(64)]));
    await assert.rejects(pool.query('DELETE FROM proof_verifications'));

    // Revocation: epoch bumps in the same insert, authorization is denied immediately and capability is dead.
    const before = Number((await pool.query('SELECT epoch FROM revocation_epochs WHERE permission_id = $1', [permission])).rows[0].epoch);
    await decide(randomUUID(), 'revoke');
    const after = Number((await pool.query('SELECT epoch FROM revocation_epochs WHERE permission_id = $1', [permission])).rows[0].epoch);
    assert.equal(after, before + 1);
    assert.equal((await svc.validateAuthorization(ok.authorizationId!, req)).eligible, false);
    assert.equal(await state(), 'BLOCKED_REVOKED');

    // A new grant needs its own verified receipt.
    await decide(randomUUID(), 'grant');
    assert.equal(await state(), 'BLOCKED_VERIFICATION_FAILED');

    // Device revocation.
    await pool.query('UPDATE devices SET revoked_at = now() WHERE id = $1', [deviceId]);
    assert.equal(await state(), 'BLOCKED_REVOKED');

    // Unknown required chain => nothing verifies.
    const none = new CollectorAuthorizationService(new PostgresCollectorEvidenceProvider(pool, { requiredChain: '' }));
    assert.equal((await none.authorizeCollector(req)).eligible, false);
    // Query failure => fail closed.
    const broken = new CollectorAuthorizationService(new PostgresCollectorEvidenceProvider(new Pool({ connectionString: 'postgres://127.0.0.1:1/none' }), { requiredChain: CHAIN }));
    assert.equal((await broken.authorizeCollector(req)).state, 'BLOCKED_SERVICE_UNAVAILABLE');
  } finally {
    await pool?.end().catch(() => undefined);
    await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
    await adminPool.end();
  }
});
