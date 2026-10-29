package com.datastorm.kicks.vpn.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LogoutPurgeTest {
  @Test fun stopThenLogoutPurgesDurableQueueBeforeAnyRestart() {
    val h = Harness(worker = false)
    assertTrue(h.startOk() is Decision.Allow)
    h.controller.onDns("stale.example", 1)
    h.controller.explicitStop()
    assertEquals(State.STOPPED, h.controller.state)
    assertEquals(1, h.queue.size())
    assertTrue(h.store.load() != null)

    // The worker is already stopped; session end must synchronously invalidate queued work.
    h.sessions.session = null
    h.controller.onSessionEnded()
    assertEquals(Reason.SESSION_REVOKED, h.controller.reason)
    assertEquals(0, h.queue.size())
    assertNull(h.store.load())

    // Restart cannot replay stale observations and remains separately gated by session/activation.
    assertEquals(Decision.Deny(Reason.NO_SESSION), h.controller.start { true })
    assertEquals(0, h.queue.size())
    assertNull(h.store.load())
    assertTrue(h.uploader.batches.isEmpty())
  }

  @Test fun freshLawfulEnrollmentStartsSeparatelyAfterPriorPurge() {
    val h = Harness(worker = false)
    assertTrue(h.startOk() is Decision.Allow)
    h.controller.onDns("stale.example", 1)
    h.controller.explicitStop()
    h.sessions.session = null
    h.controller.onSessionEnded()

    val fresh = Harness(worker = false)
    assertTrue(fresh.startOk() is Decision.Allow)
    fresh.controller.onDns("fresh.example", 1)
    assertEquals(1, fresh.queue.size())
    assertEquals("fresh.example", fresh.queue.peekBatch()!!.observations.single().destinationHost)
    fresh.controller.explicitStop()
  }
}
