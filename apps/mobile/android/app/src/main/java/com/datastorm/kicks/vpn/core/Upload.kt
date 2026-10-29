package com.datastorm.kicks.vpn.core

import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

sealed class UploadResult {
  object Accepted : UploadResult()
  /** HTTP 409: the server already has this batchId; treated as delivered. */
  object Duplicate : UploadResult()
  data class Unauthorized(val httpStatus: Int) : UploadResult()
  /** HTTP 400: schema rejection. Retrying cannot help, so the batch is discarded. */
  object Rejected : UploadResult()
  data class Transient(val detail: String) : UploadResult()
}

interface BatchUploader { fun upload(batch: Batch, session: Session): UploadResult }

class Backoff(
  private val baseMs: Long = 2_000,
  private val maxMs: Long = 300_000,
  val maxAttempts: Int = 8,
  private val jitter: (Long) -> Long = { it / 2 + (Math.random() * (it / 2 + 1)).toLong() }
) {
  fun delayMs(attempt: Int): Long {
    val shift = attempt.coerceIn(0, 30)
    val raw = minOf(maxMs, baseMs * (1L shl shift))
    return jitter(raw).coerceIn(1, maxMs)
  }
}

sealed class PumpResult {
  object Idle : PumpResult()
  data class Uploaded(val observations: Int) : PumpResult()
  data class RetryLater(val delayMs: Long) : PumpResult()
  data class Halted(val reason: Reason) : PumpResult()
}

/** One authorization-checked upload step. Used by [UploadWorker] and directly by tests. */
class UploadPump(
  private val queue: BoundedQueue,
  private val gate: AuthorizationGate,
  private val uploader: BatchUploader,
  private val backoff: Backoff
) {
  private var attempts = 0
  @Volatile var discardedBatches = 0; private set

  @Synchronized fun runOnce(): PumpResult {
    val decision = gate.check(if (attempts > 0) Phase.RETRY else Phase.UPLOAD)
    val allow = when (decision) {
      is Decision.Deny -> return PumpResult.Halted(decision.reason)
      is Decision.Unavailable -> {
        val delay = backoff.delayMs(attempts)
        attempts = minOf(attempts + 1, backoff.maxAttempts)
        return PumpResult.RetryLater(delay)
      }
      is Decision.Allow -> decision
    }
    queue.retainConsent(allow.grant.consentId)
    val batch = queue.peekBatch() ?: run { attempts = 0; return PumpResult.Idle }
    return when (val r = uploader.upload(batch, allow.session)) {
      UploadResult.Accepted, UploadResult.Duplicate -> { attempts = 0; queue.ack(batch.batchId); PumpResult.Uploaded(batch.observations.size) }
      UploadResult.Rejected -> { attempts = 0; discardedBatches++; queue.ack(batch.batchId); PumpResult.Uploaded(0) }
      is UploadResult.Unauthorized -> PumpResult.Halted(if (r.httpStatus == 403) Reason.CONSENT_NOT_GRANTED else Reason.SESSION_REVOKED)
      is UploadResult.Transient -> {
        attempts++
        if (attempts >= backoff.maxAttempts) { attempts = 0; discardedBatches++; queue.ack(batch.batchId); PumpResult.RetryLater(backoff.delayMs(backoff.maxAttempts)) }
        else PumpResult.RetryLater(backoff.delayMs(attempts))
      }
    }
  }
}

/** Single daemon thread. [stop] wakes it immediately and [join] guarantees it has exited. */
class UploadWorker(private val step: () -> PumpResult, private val onHalt: (Reason) -> Unit, private val idleMs: Long = 15_000) {
  private val stopSignal = CountDownLatch(1)
  private var thread: Thread? = null

  @Synchronized fun start() {
    if (thread != null) return
    thread = Thread({
      while (stopSignal.count > 0) {
        val wait = try {
          when (val r = step()) {
            is PumpResult.Halted -> { onHalt(r.reason); return@Thread }
            is PumpResult.RetryLater -> r.delayMs
            is PumpResult.Uploaded -> 0L
            PumpResult.Idle -> idleMs
          }
        } catch (e: Exception) { idleMs }
        if (wait > 0 && stopSignal.await(wait, TimeUnit.MILLISECONDS)) return@Thread
      }
    }, "kicks-upload").also { it.isDaemon = true; it.start() }
  }

  fun stop() = stopSignal.countDown()
  fun join(timeoutMs: Long): Boolean { val t = synchronized(this) { thread } ?: return true; if (t === Thread.currentThread()) return true; t.join(timeoutMs); return !t.isAlive }
}
