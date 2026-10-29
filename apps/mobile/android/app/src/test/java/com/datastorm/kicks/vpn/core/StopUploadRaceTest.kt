package com.datastorm.kicks.vpn.core

import java.util.concurrent.CountDownLatch
import java.util.concurrent.ExecutionException
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class StopUploadRaceTest {
  @Test fun lateAcceptedCompletionAfterLogoutCannotRestoreOldBatchOrReachFreshSession() {
    exerciseLateCompletion(UploadResult.Accepted)
  }

  @Test fun lateTransientCompletionAfterLogoutCannotRequeueOldBatchOrReachFreshSession() {
    exerciseLateCompletion(UploadResult.Transient("offline"))
  }

  @Test fun lateRejectedCompletionAfterLogoutCannotRequeueOldBatchOrReachFreshSession() {
    exerciseLateCompletion(UploadResult.Rejected)
  }

  private fun exerciseLateCompletion(lateResult: UploadResult) {
    val h = Harness(worker = false)
    assertTrue(h.startOk() is Decision.Allow)
    h.controller.onDns("late.example", 1)
    assertEquals(1, h.queue.size())

    val entered = CountDownLatch(1)
    val release = CountDownLatch(1)
    val uploadCalls = AtomicInteger(0)
    val backgroundFailure = AtomicInteger(0)
    val lateUploader = object : BatchUploader {
      override fun upload(batch: Batch, session: Session): UploadResult {
        uploadCalls.incrementAndGet()
        entered.countDown()
        if (!release.await(5, TimeUnit.SECONDS)) {
          backgroundFailure.incrementAndGet()
          throw AssertionError("late uploader was not released")
        }
        return lateResult
      }
    }

    val pump = UploadPump(
      h.queue,
      h.gate,
      lateUploader,
      Backoff(baseMs = 1, maxMs = 1, maxAttempts = 1, jitter = { it })
    )
    val executor = Executors.newSingleThreadExecutor()
    var future: Future<PumpResult>? = null
    var primaryFailure: Throwable? = null
    try {
      future = executor.submit<PumpResult> { pump.runOnce() }
      assertTrue(entered.await(5, TimeUnit.SECONDS))

      h.controller.explicitStop()
      h.controller.onSessionEnded()
      assertEquals(0, h.queue.size())
      assertNull(h.store.load())

      release.countDown()
      val completion = future.get(5, TimeUnit.SECONDS)
      assertEquals(0, backgroundFailure.get())
      assertEquals(1, uploadCalls.get())
      assertEquals(0, h.queue.size())
      assertNull(h.store.load())
      assertExpectedCompletion(lateResult, completion)

      h.sessions.session = Session("acct-a", "dev-1", "fresh-session", h.clock.now + 60_000)
      h.gate.activate()
      assertTrue(h.startOk() is Decision.Allow)
      assertEquals(0, h.queue.size())

      val freshCalls = AtomicInteger(0)
      val freshUploader = object : BatchUploader {
        override fun upload(batch: Batch, session: Session): UploadResult {
          freshCalls.incrementAndGet()
          return UploadResult.Accepted
        }
      }
      val freshPump = UploadPump(
        h.queue,
        h.gate,
        freshUploader,
        Backoff(baseMs = 1, maxMs = 1, maxAttempts = 1, jitter = { it })
      )
      assertEquals(PumpResult.Idle, freshPump.runOnce())
      assertEquals(0, freshCalls.get())
      assertEquals(1, uploadCalls.get())
      h.controller.explicitStop()
    } catch (t: Throwable) {
      primaryFailure = t
      throw t
    } finally {
      release.countDown()
      val completed = future
      if (completed != null) {
        try {
          completed.get(5, TimeUnit.SECONDS)
        } catch (t: Throwable) {
          if (primaryFailure == null) throw t
          primaryFailure.addSuppressed(t)
        }
      }
      executor.shutdownNow()
      assertTrue(executor.awaitTermination(5, TimeUnit.SECONDS))
    }
  }

  private fun assertExpectedCompletion(lateResult: UploadResult, completion: PumpResult) {
    when (lateResult) {
      UploadResult.Accepted, UploadResult.Rejected -> assertTrue(completion is PumpResult.Uploaded)
      is UploadResult.Transient -> assertTrue(completion is PumpResult.RetryLater)
      UploadResult.Duplicate -> assertTrue(completion is PumpResult.Uploaded)
      is UploadResult.Unauthorized -> assertTrue(completion is PumpResult.Halted)
    }
  }
}
