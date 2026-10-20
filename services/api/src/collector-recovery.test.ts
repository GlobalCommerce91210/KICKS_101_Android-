import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { MemoryCollectorRecoveryAuthority, PostgresCollectorRecoveryAuthority } from './collector-recovery.js';

test('independent revocation survives primary-state rollback and device tombstones block all activations', async () => {
  const authority = new MemoryCollectorRecoveryAuthority('current');
  await authority.assertReady('current');
  await authority.revoke('device', 'old-activation');
  assert.equal(await authority.isRevoked('device','old-activation'),true);
  assert.equal(await authority.isRevoked('device','new-activation'),false);
  await authority.revoke('device',null);
  assert.equal(await authority.isRevoked('device','new-activation'),true);
  authority.held = true;
  await assert.rejects(authority.assertReady('current'));
  authority.held = false;
  await assert.rejects(authority.assertReady('restored-old-epoch'));
});

test('PostgreSQL authority requires explicit checkpoint; tombstones survive reconnect and resist mutation',
  {skip:!process.env.KICKS_TEST_DATABASE_URL}, async () => {
  const admin = new Pool({connectionString:process.env.KICKS_TEST_DATABASE_URL});
  const schema='test_recovery_'+randomUUID().replaceAll('-','');
  await admin.query('CREATE SCHEMA '+schema);
  const url = new URL(process.env.KICKS_TEST_DATABASE_URL!);
  url.searchParams.set('options','-c search_path='+schema);
  let pool = new Pool({connectionString:url.toString()});
  try {
    const sql = await readFile(new URL('../db/collector-recovery-authority.sql',import.meta.url),'utf8');
    await pool.query(sql); await pool.query(sql);
    const epoch=randomUUID(); const authority = new PostgresCollectorRecoveryAuthority(pool);
    await assert.rejects(authority.assertReady(epoch));
    await pool.query('INSERT INTO collector_recovery_checkpoint(singleton,epoch) VALUES(true,$1)',[epoch]);
    await assert.rejects(authority.assertReady(epoch));
    await pool.query('UPDATE collector_recovery_checkpoint SET held=false');
    await authority.assertReady(epoch);
    await authority.revoke('device','activation'); await authority.revoke('device','activation');
    await assert.rejects(pool.query('DELETE FROM collector_revocations'));
    await assert.rejects(pool.query('TRUNCATE collector_revocations'));
    await pool.end(); pool = new Pool({connectionString:url.toString()});
    assert.equal(await new PostgresCollectorRecoveryAuthority(pool).isRevoked('device','activation'),true);
    await assert.rejects(new PostgresCollectorRecoveryAuthority(pool).assertReady(randomUUID()));
  } finally { await pool.end(); await admin.query('DROP SCHEMA '+schema+' CASCADE'); await admin.end(); }
});
