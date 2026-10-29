package com.datastorm.kicks.vpn.core

import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WorkerLifecycleTest {
  @Test fun stoppedWorkerCanBeStartedAgain() {
    val firstStep = CountDownLatch(1)
    val secondStep = CountDownLatch(1)
    val stoppedFirstRun = AtomicBoolean(false)
    val worker = UploadWorker({
      if (stoppedFirstRun.get()) secondStep.countDown() else firstStep.countDown()
      PumpResult.Idle
    }, {}, idleMs = 1)

    worker.start()
    assertTrue(firstStep.await(1, TimeUnit.SECONDS))
    worker.stop()
    assertTrue(worker.join(1_000))

    stoppedFirstRun.set(true)
    worker.start()
    assertTrue(secondStep.await(1, TimeUnit.SECONDS))
    worker.stop()
    assertTrue(worker.join(1_000))
  }

  @Test fun authorizationLossStopsWorkerAndPurgesQueuedObservations() {
    val h = Harness(worker = false)
    assertTrue(h.startOk() is Decision.Allow)
    h.controller.onDns("stale.example", 1)
    assertEquals(1, h.queue.size())

    h.authority.result = AuthorityResult.Rejected(Reason.SESSION_REVOKED)
    val worker = UploadWorker({ h.pump.runOnce() }, { h.controller.stop(it) }, idleMs = 1)
    worker.start()

    val deadline = System.currentTimeMillis() + 1_000
    while (h.controller.state != State.STOPPED && System.currentTimeMillis() < deadline) Thread.sleep(5)
    assertEquals(State.STOPPED, h.controller.state)
    assertEquals(Reason.SESSION_REVOKED, h.controller.reason)
    assertEquals(0, h.queue.size())
    assertNull(h.store.load())
    assertTrue(h.uploader.batches.isEmpty())
    assertTrue(worker.join(1_000))
  }
}
