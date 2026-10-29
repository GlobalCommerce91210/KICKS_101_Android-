package com.datastorm.kicks.vpn.core

import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class StopUploadRaceTest {
  @Test fun lateCompletionAfterLogoutCannotRestoreOldBatchOrReachFreshSession() {
    val h = Harness(worker = false)
    assertTrue(h.startOk() is Decision.Allow)
    h.controller.onDns("late.example", 1)
    assertEquals(1, h.queue.size())

    val entered = CountDownLatch(1)
    val release = CountDownLatch(1)
    val uploadCalls = AtomicInteger(0)
    val lateUploader = object : BatchUploader {
      override fun upload(batch: Batch, session: Session): UploadResult {
        uploadCalls.incrementAndGet()
        entered.countDown()
        assertTrue(release.await(1, TimeUnit.SECONDS))
        return UploadResult.Accepted
      }
    }

    val pump = UploadPump(
      h.queue,
      h.gate,
      lateUploader,
      Backoff(baseMs = 1, maxMs = 1, maxAttempts = 1, jitter = { it })
    )
    val uploadThread = Thread { pump.runOnce() }
    uploadThread.start()
    assertTrue(entered.await(1, TimeUnit.SECONDS))

    h.controller.explicitStop()
    h.controller.onSessionEnded()
    assertEquals(0, h.queue.size())
    assertNull(h.store.load())

    release.countDown()
    uploadThread.join(1_000)
    assertFalse(uploadThread.isAlive)
    assertEquals(1, uploadCalls.get())
    assertEquals(0, h.queue.size())
    assertNull(h.store.load())

    h.sessions.session = Session("acct-a", "dev-1", "fresh-session", h.clock.now + 60_000)
    h.gate.activate()
    assertTrue(h.startOk() is Decision.Allow)
    assertEquals(0, h.queue.size())
    assertEquals(1, uploadCalls.get())
    h.controller.explicitStop()
  }
}
