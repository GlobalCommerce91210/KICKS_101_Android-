import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore, BatchConflict } from './store.js';
import { batchDigest } from './batch-digest.js';

test('lost acknowledgment retries preserve receipt and commit once; changed or foreign batches conflict', async () => {
  const store = new MemoryStore();
  const input = { batchId: 'batch', deviceId: 'owner', schemaVersion: 'one', observations: [], payloadDigest: batchDigest({ b: 2, a: 1 }) };
  const receipts = await Promise.all(Array.from({ length: 20 }, () => store.appendBatch(input)));
  assert.equal(receipts.filter(row => !row.replayed).length, 1);
  assert.equal(new Set(receipts.map(row => row.receiptId)).size, 1);
  assert.equal(new Set(receipts.map(row => row.committedAt)).size, 1);
  await assert.rejects(store.appendBatch({ ...input, payloadDigest: batchDigest({ a: 2 }) }), BatchConflict);
  await assert.rejects(store.appendBatch({ ...input, deviceId: 'foreign' }), BatchConflict);
  assert.equal(batchDigest({ a: 1, b: 2 }), input.payloadDigest);
  assert.notEqual(batchDigest([1,2]), batchDigest([2,1]));
});
