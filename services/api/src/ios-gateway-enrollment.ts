import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import type { ConsumerIdentityStore } from './consumer-identity.js';
import type { ConsumerDeviceBindingStore } from './consumer-device-bindings.js';
import type { Store } from './store.js';

export type GatewayLease = {
  accountSubjectId: string; deviceId: string; tokenHash: string; publicKey: string;
  permissionId: string; activationId: string; purposeVersion: string; expiresAt: string; slot: number;
};
export interface GatewayLeaseStore {
  upsert(input: Omit<GatewayLease, 'slot'>, now: number): Promise<GatewayLease>;
  list(now: number): Promise<GatewayLease[]>;
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
    const lease = { ...input, slot }; this.leases.set(input.deviceId, lease); return { ...lease };
  }
  async list(now: number) { return [...this.leases.values()].filter(l => Date.parse(l.expiresAt) > now).map(l => ({ ...l })); }
}

export class PostgresGatewayLeaseStore implements GatewayLeaseStore {
  constructor(private readonly pool: Pool) {}
  private async schema() {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS ios_gateway_leases (
      device_id TEXT PRIMARY KEY, public_key TEXT NOT NULL UNIQUE, slot INTEGER NOT NULL UNIQUE CHECK(slot BETWEEN 2 AND 254),
      account_subject_id TEXT NOT NULL, token_hash TEXT NOT NULL, permission_id TEXT NOT NULL,
      activation_id TEXT NOT NULL, purpose_version TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL)`);
  }
  private row(r: Record<string, unknown>): GatewayLease {
    return { deviceId: String(r.device_id), publicKey: String(r.public_key), slot: Number(r.slot), accountSubjectId: String(r.account_subject_id),
      tokenHash: String(r.token_hash), permissionId: String(r.permission_id), activationId: String(r.activation_id),
      purposeVersion: String(r.purpose_version), expiresAt: new Date(String(r.expires_at)).toISOString() };
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
      const result = await client.query(`INSERT INTO ios_gateway_leases(device_id,public_key,slot,account_subject_id,token_hash,permission_id,activation_id,purpose_version,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(device_id) DO UPDATE SET public_key=EXCLUDED.public_key,
        token_hash=EXCLUDED.token_hash,permission_id=EXCLUDED.permission_id,activation_id=EXCLUDED.activation_id,
        purpose_version=EXCLUDED.purpose_version,expires_at=EXCLUDED.expires_at RETURNING *`,
      [input.deviceId,input.publicKey,slot,input.accountSubjectId,input.tokenHash,input.permissionId,input.activationId,input.purposeVersion,input.expiresAt]);
      await client.query('COMMIT'); return this.row(result.rows[0]);
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async list(now: number) { await this.schema(); return (await this.pool.query('SELECT * FROM ios_gateway_leases WHERE expires_at > $1', [new Date(now)])).rows.map(r => this.row(r)); }
}

export type IosGatewayConfiguration = {
  environment: 'staging'; serverHost: string; serverPort: number; serverPublicKey: string;
  purpose: string; purposeVersion: string; policyVersion: string;
};
const validKey = (key: string) => /^[A-Za-z0-9+/]{43}=$/.test(key) && Buffer.from(key, 'base64').toString('base64') === key && !Buffer.from(key, 'base64').every(b => b === 0);
export class IosGatewayEnrollment {
  constructor(private readonly dependencies: { identity: ConsumerIdentityStore; bindings: ConsumerDeviceBindingStore; store: Store; leases: GatewayLeaseStore },
    private readonly config: IosGatewayConfiguration, private readonly clock = Date.now) {
    if (config.environment !== 'staging' || !validKey(config.serverPublicKey) || !/^[a-zA-Z0-9.-]+$/.test(config.serverHost) ||
      !Number.isInteger(config.serverPort) || config.serverPort < 1 || config.serverPort > 65535 ||
      !config.purpose || !config.purposeVersion || !config.policyVersion) throw new Error('invalid_staging_gateway_configuration');
  }
  private async authorized(lease: Pick<GatewayLease,'accountSubjectId'|'deviceId'|'tokenHash'|'permissionId'>) {
    const { identity, bindings, store } = this.dependencies;
    const account = await identity.findAccountBySubjectId(lease.accountSubjectId);
    if (!account || ['closed','suspended'].includes(account.account_status)) return null;
    if ((await identity.getKicksEntitlement(lease.accountSubjectId))?.status !== 'active' ||
      (await identity.getKicksProfile(lease.accountSubjectId))?.status !== 'active') return null;
    const device = await store.findDeviceByTokenHash(lease.tokenHash);
    if (!device || device.revoked || device.id !== lease.deviceId) return null;
    const binding = (await bindings.list(lease.accountSubjectId)).find(b => b.device_id === lease.deviceId && b.platform === 'ios' && b.status === 'active' && b.collector_subject_id === device.subjectId);
    if (!binding) return null;
    const consent = await store.currentConsent(device.id, device.subjectId, lease.permissionId);
    return consent?.action === 'grant' && consent.activationId && consent.purpose === this.config.purpose &&
      consent.purposeVersion === this.config.purposeVersion && consent.policyVersion === this.config.policyVersion ? consent : null;
  }
  async enroll(input: { accountSubjectId: string; deviceId: string; deviceToken: string; permissionId: string; publicKey: string }) {
    if (!validKey(input.publicKey) || input.publicKey === this.config.serverPublicKey) throw new Error('invalid_client_public_key');
    const tokenHash = createHash('sha256').update(input.deviceToken).digest('hex');
    const identity = { accountSubjectId: input.accountSubjectId, deviceId: input.deviceId, tokenHash, permissionId: input.permissionId };
    const consent = await this.authorized(identity);
    if (!consent?.activationId) throw new Error('active_device_bound_consent_required');
    const now = this.clock();
    const lease = await this.dependencies.leases.upsert({ ...identity, publicKey: input.publicKey, activationId: consent.activationId,
      purposeVersion: consent.purposeVersion, expiresAt: new Date(now + 300_000).toISOString() }, now);
    // Recheck after persistence; a revoked grant cannot become a successful enrollment.
    if ((await this.authorized(identity))?.activationId !== lease.activationId) throw new Error('consent_changed');
    return { deviceId: lease.deviceId, permissionId: lease.permissionId, activationId: lease.activationId, purposeVersion: lease.purposeVersion,
      expiresAt: lease.expiresAt, tunnelServerHost: this.config.serverHost, collectionEnabled: false,
      wireguard: { serverPublicKey: this.config.serverPublicKey, serverPort: this.config.serverPort,
        addressIPv4: `10.88.0.${lease.slot}/32`, addressIPv6: `fd88:4b49:434b::${lease.slot.toString(16)}/128`, dnsServers: ['1.1.1.1','2606:4700:4700::1111'] } };
  }
  async peers() {
    const now = this.clock(); const peers = [];
    for (const lease of await this.dependencies.leases.list(now)) {
      const consent = await this.authorized(lease);
      if (consent?.activationId !== lease.activationId || Date.parse(lease.expiresAt) <= this.clock()) continue;
      peers.push({ publicKey: lease.publicKey, address: `10.88.0.${lease.slot}`, addressIPv6: `fd88:4b49:434b::${lease.slot.toString(16)}`,
        deviceId: lease.deviceId, consentId: lease.activationId, purposeVersion: lease.purposeVersion, authorization: 'active', expiresAt: lease.expiresAt });
    }
    return { environment: 'staging', collectionEnabled: false, peers };
  }
}
