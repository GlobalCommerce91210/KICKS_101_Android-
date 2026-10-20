import { createHash, randomUUID } from 'node:crypto';
import type { CollectorRecoveryAuthority } from './collector-recovery.js';
import type { Pool } from 'pg';
import type { ConsumerIdentityStore } from './consumer-identity.js';
import type { ConsumerDeviceBindingStore } from './consumer-device-bindings.js';
import type { Store } from './store.js';

export type GatewayLease = {
  accountSubjectId: string; deviceId: string; tokenHash: string; publicKey: string;
  permissionId: string; activationId: string; purposeVersion: string; expiresAt: string; slot: number;
  revision?: string; recoveryEpoch?: string; appliedAt?: string | null;
};
export interface GatewayLeaseStore {
  upsert(input: Omit<GatewayLease, 'slot'>, now: number): Promise<GatewayLease>;
  list(now: number): Promise<GatewayLease[]>;
  acknowledge(revisions: string[], now: number): Promise<void>;
}

// Test-only store. Deployments must explicitly supply the durable implementation.
export class MemoryGatewayLeaseStore implements GatewayLeaseStore {
  private leases = new Map<string, GatewayLease>();
  async upsert(input: Omit<GatewayLease, 'slot'>, now: number) {
    for (const [id, value] of this.leases) if (Date.parse(value.expiresAt) <= now) this.leases.delete(id);
    if ([...this.leases.values()].some(l => l.deviceId !== input.deviceId && l.publicKey === input.publicKey)) throw new Error('public_key_in_use');
    const existing = this.leases.get(input.deviceId);
    if (existing && existing.accountSubjectId !== input.accountSubjectId) throw new Error('device_lease_in_use');
    const occupied = new Set([...this.leases.values()].map(l => l.slot));
    const slot = existing?.slot ?? Array.from({ length: 253 }, (_, i) => i + 2).find(i => !occupied.has(i));
    if (!slot) throw new Error('gateway_capacity');
    const lease = { ...input, slot, revision: randomUUID(), appliedAt: null }; this.leases.set(input.deviceId, lease); return { ...lease };
  }
  async list(now: number) { return [...this.leases.values()].filter(l => Date.parse(l.expiresAt) > now).map(l => ({ ...l })); }
  async acknowledge(revisions: string[], now: number) {
    for (const lease of this.leases.values()) if (lease.revision && revisions.includes(lease.revision)) lease.appliedAt = new Date(now).toISOString();
  }
}

export class PostgresGatewayLeaseStore implements GatewayLeaseStore {
  private schemaReady: Promise<void> | null = null;
  constructor(private readonly pool: Pool) {}
  private async schema() {
    if (!this.schemaReady) this.schemaReady = this.createSchema().catch(error => { this.schemaReady = null; throw error; });
    await this.schemaReady;
  }
  private async createSchema() {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS ios_gateway_leases (
      device_id TEXT PRIMARY KEY, public_key TEXT NOT NULL UNIQUE, slot INTEGER NOT NULL UNIQUE CHECK(slot BETWEEN 2 AND 254),
      account_subject_id TEXT NOT NULL, token_hash TEXT NOT NULL, permission_id TEXT NOT NULL,
      activation_id TEXT NOT NULL, purpose_version TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL);
      ALTER TABLE ios_gateway_leases ADD COLUMN IF NOT EXISTS revision uuid;
      ALTER TABLE ios_gateway_leases ADD COLUMN IF NOT EXISTS recovery_epoch text;
      ALTER TABLE ios_gateway_leases ADD COLUMN IF NOT EXISTS applied_at timestamptz`);
  }
  private row(r: Record<string, unknown>): GatewayLease {
    return { deviceId: String(r.device_id), publicKey: String(r.public_key), slot: Number(r.slot), accountSubjectId: String(r.account_subject_id),
      tokenHash: String(r.token_hash), permissionId: String(r.permission_id), activationId: String(r.activation_id),
      purposeVersion: String(r.purpose_version), expiresAt: new Date(String(r.expires_at)).toISOString(),
      revision: r.revision ? String(r.revision) : undefined, recoveryEpoch: r.recovery_epoch ? String(r.recovery_epoch) : undefined,
      appliedAt: r.applied_at ? new Date(String(r.applied_at)).toISOString() : null };
  }
  async upsert(input: Omit<GatewayLease, 'slot'>, now: number) {
    await this.schema(); const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Serialize address allocation across API instances; never allocate from a process counter.
      await client.query("SELECT pg_advisory_xact_lock(hashtext('ios_gateway_leases'))");
      await client.query('DELETE FROM ios_gateway_leases WHERE expires_at <= $1', [new Date(now)]);
      const previous = await client.query('SELECT * FROM ios_gateway_leases WHERE device_id=$1', [input.deviceId]);
      if (previous.rows[0] && previous.rows[0].account_subject_id !== input.accountSubjectId) throw new Error('device_lease_in_use');
      const allocation = await client.query(`SELECT n FROM generate_series(2,254) n WHERE NOT EXISTS
        (SELECT 1 FROM ios_gateway_leases WHERE slot=n) ORDER BY n LIMIT 1`);
      const slot = previous.rows[0]?.slot ?? allocation.rows[0]?.n;
      if (!slot) throw new Error('gateway_capacity');
      await client.query(`INSERT INTO ios_gateway_leases(device_id,public_key,slot,account_subject_id,token_hash,permission_id,activation_id,purpose_version,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(device_id) DO UPDATE SET public_key=EXCLUDED.public_key,
        token_hash=EXCLUDED.token_hash,permission_id=EXCLUDED.permission_id,activation_id=EXCLUDED.activation_id,
        purpose_version=EXCLUDED.purpose_version,expires_at=EXCLUDED.expires_at RETURNING *`,
      [input.deviceId,input.publicKey,slot,input.accountSubjectId,input.tokenHash,input.permissionId,input.activationId,input.purposeVersion,input.expiresAt]);
      const versioned = await client.query('UPDATE ios_gateway_leases SET revision=$2,recovery_epoch=$3,applied_at=NULL WHERE device_id=$1 RETURNING *',
        [input.deviceId, randomUUID(), input.recoveryEpoch ?? null]);
      await client.query('COMMIT'); return this.row(versioned.rows[0]);
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async list(now: number) { await this.schema(); return (await this.pool.query('SELECT * FROM ios_gateway_leases WHERE expires_at > $1', [new Date(now)])).rows.map(r => this.row(r)); }
  async acknowledge(revisions: string[], now: number) {
    await this.schema();
    await this.pool.query('UPDATE ios_gateway_leases SET applied_at=$2 WHERE revision=ANY($1::uuid[]) AND expires_at>$2', [revisions, new Date(now)]);
  }
}

export type IosGatewayConfiguration = {
  environment: 'staging'; serverHost: string; serverPort: number; serverPublicKey: string;
  purpose: string; purposeVersion: string; policyVersion: string;
  permissionId?: string;
  recoveryEpoch?: string;
};
const validKey = (key: string) => /^[A-Za-z0-9+/]{43}=$/.test(key) && Buffer.from(key, 'base64').toString('base64') === key && !Buffer.from(key, 'base64').every(b => b === 0);
export class IosGatewayEnrollment {
  async assertActivation(deviceId: string, activationId: string) {
    if (!this.config.recoveryEpoch) return;
    const recovery = this.dependencies.recovery;
    if (!recovery) throw Error('collector_recovery_authority_required');
    await recovery.assertReady(this.config.recoveryEpoch);
    if (await recovery.isRevoked(deviceId, activationId)) throw Error('collector_activation_revoked');
  }
  async beforeConsent(deviceId: string, subjectId: string, permissionId: string, action: string, current?: import('./store.js').ConsentEvent | null) {
    if (!this.config.recoveryEpoch) return;
    const recovery = this.dependencies.recovery!;
    if (!recovery) throw Error('collector_recovery_authority_required');
    if (action !== 'grant') {
      const prior = current === undefined ? await this.dependencies.store.currentConsent(deviceId, subjectId, permissionId) : current;
      if (prior?.activationId) await recovery.revoke(deviceId, prior.activationId);
    } else {
      await recovery.assertReady(this.config.recoveryEpoch);
      if (await recovery.isRevoked(deviceId, '*')) throw Error('device_reenrollment_review_required');
    }
  }
  async beforeUnlink(deviceId: string) {
    if (!this.config.recoveryEpoch) return;
    if (!this.dependencies.recovery) throw Error('collector_recovery_authority_required');
    await this.dependencies.recovery.revoke(deviceId, null);
  }
  monitoringPolicy() {
    return this.config.permissionId ? { permissionId: this.config.permissionId, purpose: this.config.purpose,
      purposeVersion: this.config.purposeVersion, policyVersion: this.config.policyVersion } : null;
  }
  constructor(private readonly dependencies: { identity: ConsumerIdentityStore; bindings: ConsumerDeviceBindingStore; store: Store; leases: GatewayLeaseStore; recovery?: CollectorRecoveryAuthority },
    private readonly config: IosGatewayConfiguration, private readonly clock = Date.now) {
    if (config.environment !== 'staging' || !validKey(config.serverPublicKey) || !/^[a-zA-Z0-9.-]+$/.test(config.serverHost) ||
      !Number.isInteger(config.serverPort) || config.serverPort < 1 || config.serverPort > 65535 ||
      !config.purpose || !config.purposeVersion || !config.policyVersion) throw new Error('invalid_staging_gateway_configuration');
  }
  private async authorized(lease: Pick<GatewayLease,'accountSubjectId'|'deviceId'|'tokenHash'|'permissionId'>) {
    if (this.config.recoveryEpoch) {
      if (!this.dependencies.recovery) throw Error('collector_recovery_authority_required');
      await this.dependencies.recovery.assertReady(this.config.recoveryEpoch);
    }
    const { identity, bindings, store } = this.dependencies;
    const account = await identity.findAccountBySubjectId(lease.accountSubjectId);
    if (!account || account.account_status !== 'active' || !account.email_verified) return null;
    if ((await identity.getKicksEntitlement(lease.accountSubjectId))?.status !== 'active' ||
      (await identity.getKicksProfile(lease.accountSubjectId))?.status !== 'active') return null;
    const device = await store.findDeviceByTokenHash(lease.tokenHash);
    if (!device || device.revoked || device.id !== lease.deviceId) return null;
    const binding = (await bindings.list(lease.accountSubjectId)).find(b => b.device_id === lease.deviceId && b.platform === 'ios' && b.status === 'active' && b.collector_subject_id === device.subjectId);
    if (!binding) return null;
    const consent = await store.currentConsent(device.id, device.subjectId, lease.permissionId);
    if (consent?.activationId && await this.dependencies.recovery?.isRevoked(device.id, consent.activationId)) return null;
    return consent?.action === 'grant' && consent.activationId && consent.purpose === this.config.purpose &&
      consent.purposeVersion === this.config.purposeVersion && consent.policyVersion === this.config.policyVersion ? consent : null;
  }
  async enroll(input: { accountSubjectId: string; deviceId: string; deviceToken: string; permissionId: string; publicKey: string }) {
    if (this.config.permissionId && input.permissionId !== this.config.permissionId) throw new Error('monitoring_permission_mismatch');
    if (!validKey(input.publicKey) || input.publicKey === this.config.serverPublicKey) throw new Error('invalid_client_public_key');
    const tokenHash = createHash('sha256').update(input.deviceToken).digest('hex');
    const identity = { accountSubjectId: input.accountSubjectId, deviceId: input.deviceId, tokenHash, permissionId: input.permissionId };
    const consent = await this.authorized(identity);
    if (!consent?.activationId) throw new Error('active_device_bound_consent_required');
    const now = this.clock();
    const lease = await this.dependencies.leases.upsert({ ...identity, publicKey: input.publicKey, activationId: consent.activationId,
      purposeVersion: consent.purposeVersion, recoveryEpoch: this.config.recoveryEpoch, expiresAt: new Date(now + 300_000).toISOString() }, now);
    // Recheck after persistence; a revoked grant cannot become a successful enrollment.
    if ((await this.authorized(identity))?.activationId !== lease.activationId) throw new Error('consent_changed');
    return { deviceId: lease.deviceId, permissionId: lease.permissionId, activationId: lease.activationId, purposeVersion: lease.purposeVersion,
      revision: lease.revision, recoveryEpoch: lease.recoveryEpoch, gatewayApplied: false,
      expiresAt: lease.expiresAt, tunnelServerHost: this.config.serverHost, collectionEnabled: false,
      wireguard: { serverPublicKey: this.config.serverPublicKey, serverPort: this.config.serverPort,
        addressIPv4: `10.88.0.${lease.slot}/32`, addressIPv6: `fd88:4b49:434b::${lease.slot.toString(16)}/128`, dnsServers: ['1.1.1.1','2606:4700:4700::1111'] } };
  }
  async peers() {
    const now = this.clock(); const peers = [];
    for (const lease of await this.dependencies.leases.list(now)) {
      if (lease.recoveryEpoch !== this.config.recoveryEpoch) continue;
      const consent = await this.authorized(lease);
      if (consent?.activationId !== lease.activationId || Date.parse(lease.expiresAt) <= this.clock()) continue;
      peers.push({ publicKey: lease.publicKey, address: `10.88.0.${lease.slot}`, addressIPv6: `fd88:4b49:434b::${lease.slot.toString(16)}`,
        deviceId: lease.deviceId, consentId: lease.activationId, revision: lease.revision, recoveryEpoch: lease.recoveryEpoch,
        purposeVersion: lease.purposeVersion, authorization: 'active', expiresAt: lease.expiresAt });
    }
    if (this.config.recoveryEpoch) await this.dependencies.recovery!.assertReady(this.config.recoveryEpoch);
    peers.sort((a,b) => a.deviceId.localeCompare(b.deviceId));
    const snapshotId = createHash('sha256').update(JSON.stringify(peers)).digest('hex');
    return { environment: 'staging', collectionEnabled: false, snapshotId, peers };
  }
  async acknowledge(snapshotId: string) {
    const snapshot = await this.peers();
    if (snapshot.snapshotId !== snapshotId) throw Error('gateway_snapshot_changed');
    await this.dependencies.leases.acknowledge(snapshot.peers.map(peer => peer.revision!).filter(Boolean), this.clock());
  }
  async status(accountSubjectId: string, deviceId: string) {
    const now = this.clock();
    const unavailable = (reason: string) => ({ ready: false, reason, checkedAt: new Date(now).toISOString(), collectionEnabled: false });
    if (this.config.recoveryEpoch) {
      try {
        if (!this.dependencies.recovery) return unavailable('recovery_authority_unavailable');
        await this.dependencies.recovery.assertReady(this.config.recoveryEpoch);
      } catch (error) {
        return unavailable(error instanceof Error && error.message === 'collector_recovery_hold' ? 'recovery_hold' : 'recovery_authority_unavailable');
      }
    }
    let lease: GatewayLease | undefined;
    try { lease = (await this.dependencies.leases.list(now)).find(row => row.deviceId === deviceId && row.accountSubjectId === accountSubjectId); }
    catch { return unavailable('lease_store_unavailable'); }
    if (!lease) return unavailable('no_current_lease');
    if (lease.recoveryEpoch !== this.config.recoveryEpoch) return unavailable('recovery_epoch_mismatch');
    try {
      if ((await this.authorized(lease))?.activationId !== lease.activationId) return unavailable('authorization_inactive');
    } catch { return unavailable('authorization_unavailable'); }
    const applied = Date.parse(lease.appliedAt ?? '');
    const ready = Number.isFinite(applied) && applied >= now - 10_000 && applied <= now;
    return { ready, reason: ready ? 'gateway_applied' : !Number.isFinite(applied) ? 'gateway_pending_ack' : applied > now ? 'gateway_clock_skew' : 'gateway_ack_stale',
      checkedAt: new Date(now).toISOString(), collectionEnabled: false,
      acknowledgmentAgeSeconds: Number.isFinite(applied) ? Math.max(0, Math.floor((now-applied)/1000)) : null,
      revision: lease.revision, recoveryEpoch: lease.recoveryEpoch, activationId: lease.activationId, expiresAt: lease.expiresAt };
  }
}
