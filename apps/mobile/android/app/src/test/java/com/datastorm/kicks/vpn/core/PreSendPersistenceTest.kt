package com.datastorm.kicks.vpn.core

import org.junit.Assert.assertEquals
import org.junit.Test

class PreSendPersistenceTest {
  @Test fun inFlightBatchIsDurableBeforeUpload() {
    val store = MemoryQueueStore()
    val q1 = BoundedQueue(capacity = 10, maxBatch = 2, store = store) { "batch-1" }
    val observation = Observation(
      eventId = "00000000-0000-4000-8000-000000000001",
      occurredAt = "2026-01-01T00:00:00Z",
      sourceApp = null,
      attribution = "unknown",
      destinationHost = "example.com",
      protocol = "dns",
      bytesBucket = "0-1KB",
      classification = "unknown",
      consentId = "00000000-0000-4000-8000-000000000002",
      consentPurpose = "testing"
    )
    q1.offer(observation)

    val beforeSend = q1.peekBatch()!!

    val q2 = BoundedQueue(capacity = 10, maxBatch = 2, store = store) { "batch-2" }
    q2.restore()
    assertEquals(beforeSend, q2.peekBatch())
  }
}
