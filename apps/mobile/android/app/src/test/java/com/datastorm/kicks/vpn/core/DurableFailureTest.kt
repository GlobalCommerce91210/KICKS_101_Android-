package com.datastorm.kicks.vpn.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

private class FailAfterFirstSave(private val failedSaveNumbers: Set<Int>) : QueueStore {
  private var saveCount = 0
  private var snapshot: String? = null

  override fun load() = snapshot

  override fun save(value: String) {
    saveCount++
    if (saveCount in failedSaveNumbers) throw IllegalStateException("simulated durable-store outage")
    snapshot = value
  }

  override fun clear() { snapshot = null }
}

class DurableFailureTest {
  @Test fun uploadWaitsForDurabilityAndPreservesBatchIdentity() {
    val store = FailAfterFirstSave(setOf(2, 3, 4))
    val queue = BoundedQueue(capacity = 10, maxBatch = 2, store = store) { "batch-1" }
    val uploader = FakeUploader()
    val gate = AuthorizationGate(
      collectorEnabled = true,
      sessions = FakeSessions(Session("acct-a", "dev-1", "token", Long.MAX_VALUE)),
      os = FakeOs(),
      authority = FakeAuthority(okResponse()),
      binding = FakeBinding(),
      clock = FakeClock()
    )
    val pump = UploadPump(queue, gate, uploader, Backoff(jitter = { it }))
    gate.activate()
    queue.offer(
      Observation(
        eventId = "00000000-0000-4000-8000-000000000011",
        occurredAt = "2026-01-01T00:00:00Z",
        sourceApp = null,
        attribution = "unknown",
        destinationHost = "example.com",
        protocol = "dns",
        bytesBucket = "0-1KB",
        classification = "unknown",
        consentId = CONSENT,
        consentPurpose = PURPOSE
      )
    )

    repeat(3) {
      try { pump.runOnce() } catch (_: IllegalStateException) { }
      assertTrue("uploader must stay unsent while durability fails", uploader.batches.isEmpty())
    }

    assertEquals(PumpResult.Uploaded(1), pump.runOnce())
    assertEquals(1, uploader.batches.size)
    assertEquals("batch-1", uploader.batches.single().batchId)
  }
}
