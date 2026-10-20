import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

// Real shell control-flow tests with fake clients: no database or decryption key.
test('restore checks independent hash before database access and rejects nonempty or unnamed targets', {skip:process.platform==='win32'}, async()=>{
  const directory=await mkdtemp(join(tmpdir(),'kicks-restore-preflight-'));
  try {
    const marker=join(directory,'calls'),ciphertext=join(directory,'backup.age');
    const content='synthetic ciphertext fixture'; await writeFile(ciphertext,content);
    await writeFile(join(directory,'psql'),`#!/bin/sh
printf 'psql\n' >> "$KICKS_TEST_MARKER"
case "$*" in
  *information_schema*) printf '%s\n' "$KICKS_TEST_TABLES" ;;
  *) printf '%s\n' "$KICKS_TEST_DATABASE" ;;
esac
`,{mode:0o700});
    await writeFile(join(directory,'age'),`#!/bin/sh
printf 'age\n' >> "$KICKS_TEST_MARKER"
printf 'synthetic dump'
`,{mode:0o700});
    await writeFile(join(directory,'pg_restore'),`#!/bin/sh
printf 'restore\n' >> "$KICKS_TEST_MARKER"
cat >/dev/null
`,{mode:0o700});
    const base={...process.env,PATH:directory+':'+process.env.PATH,PGSERVICE:'isolated_fixture',
      KICKS_RESTORE_CIPHERTEXT:ciphertext,KICKS_RESTORE_AGE_IDENTITY:join(directory,'unused-test-identity'),
      KICKS_RESTORE_EXPECTED_SHA256:createHash('sha256').update(content).digest('hex'),
      KICKS_TEST_MARKER:marker,KICKS_TEST_TABLES:'0',KICKS_TEST_DATABASE:'kicks_restore_fixture'};
    const script=resolve('infrastructure/ios-gateway/restore-collector-drill.sh');
    const run=changes=>spawnSync('bash',[script],{env:{...base,...changes},encoding:'utf8'});
    const calls=async()=>readFile(marker,'utf8').catch(()=>'');
    const mismatch=run({KICKS_RESTORE_EXPECTED_SHA256:'0'.repeat(64)});
    assert.notEqual(mismatch.status,0); assert.match(mismatch.stderr,/hash mismatch/); assert.equal(await calls(),'');
    const missing=run({KICKS_RESTORE_EXPECTED_SHA256:''});
    assert.notEqual(missing.status,0); assert.equal(await calls(),'');
    const protectedTarget=run({KICKS_TEST_DATABASE:'protected_live_database'});
    assert.notEqual(protectedTarget.status,0); assert.doesNotMatch(await calls(),/age|restore/);
    await writeFile(marker,'');
    const nonempty=run({KICKS_TEST_TABLES:'1'});
    assert.notEqual(nonempty.status,0); assert.doesNotMatch(await calls(),/age|restore/);
    await writeFile(marker,'');
    const valid=run({});
    assert.equal(valid.status,0,valid.stderr); assert.match(await calls(),/restore/);
  } finally { await rm(directory,{recursive:true,force:true}); }
});
