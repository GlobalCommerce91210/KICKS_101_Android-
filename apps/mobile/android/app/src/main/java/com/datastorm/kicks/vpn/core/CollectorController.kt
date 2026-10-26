package com.datastorm.kicks.vpn.core

import java.util.UUID

enum class State { IDLE, STARTING, ACTIVE, PAUSED, STOPPED }

data class Status(val state: State, val reason: Reason?, val queued: Int, val dropped: Long)

/**
 * Owns the collector lifecycle. State is ACTIVE only after the authoritative gate allowed the start
 * AND the tunnel was established; any denial stops capture, upload and (for authorization loss) purges
 * the queue. Consent being recorded never starts anything: only [start] after explicit activation does.
 */
class CollectorController(
  private val gate: AuthorizationGate,
  val queue: BoundedQueue,
  uploader: BatchUploader,
  private val clock: Clock,
  backoff: Backoff = Backoff(),
  private val newId: () -> String = { UUID.randomUUID().toString() },
  private val runWorker: Boolean = true
) {
  private val pump = UploadPump(queue, gate, uploader, backoff)
  private val worker = UploadWorker({ pump.runOnce() }, { stop(it) })
  @Volatile var state = State.IDLE; private set
  @Volatile var reason: Reason? = null; private set
  @Volatile var onStopped: (Reason) -> Unit = {}

  fun status() = Status(state, reason, queue.size(), queue.dropped)

  /** Called from a background thread. [establish] opens the tunnel and returns false on failure. */
  @Synchronized fun start(establish: () -> Boolean): Decision {
    state = State.STARTING; reason = null
    val d = gate.check(Phase.START)
    if (d !is Decision.Allow) { applyDenial(d); return d }
    queue.restore()
    val ok = try { establish() } catch (e: Exception) { false }
    if (!ok) { stop(Reason.TUNNEL_FAILED); return Decision.Deny(Reason.TUNNEL_FAILED) }
    // Authorization may have been lost while the tunnel was coming up.
    val again = gate.check(Phase.RESUME)
    if (again !is Decision.Allow) { applyDenial(again); return again }
    state = State.ACTIVE
    if (runWorker) worker.start()
    return d
  }

  /** Re-checks after a network change or app/service resume. */
  @Synchronized fun resume(): Decision {
    if (state != State.ACTIVE && state != State.PAUSED) return Decision.Deny(reason ?: Reason.SERVICE_STOPPED)
    val d = gate.check(Phase.RESUME)
    if (d is Decision.Allow) { state = State.ACTIVE; reason = null } else applyDenial(d)
    return d
  }

  /** Buffers one DNS observation, only while authorization holds. Never blocks DNS forwarding. */
  fun onDns(qname: String?, bytes: Int) {
    if (state != State.ACTIVE && state != State.PAUSED) return
    when (val d = gate.check(Phase.BUFFER)) {
      is Decision.Allow -> {
        synchronized(this) { if (state == State.PAUSED) { state = State.ACTIVE; reason = null } }
        val o = Minimizer.fromDns(qname, bytes, d.grant, clock.nowMs(), newId()) ?: return
        if (state == State.ACTIVE) queue.offer(o)
      }
      else -> applyDenial(d)
    }
  }

  fun explicitStop() = stop(Reason.USER_STOP)

  fun stop(why: Reason) {
    synchronized(this) {
      if (state == State.STOPPED && reason != null) return
      gate.deactivate()
      worker.stop()
      state = State.STOPPED; reason = why
      if (why.purgesQueue) queue.purge() else queue.persist()
    }
    // Outside the lock so teardown can join the worker without deadlocking against it.
    onStopped(why)
  }

  /** Waits for the worker thread so shutdown never leaves a running thread behind. */
  fun awaitShutdown(timeoutMs: Long) = worker.join(timeoutMs)

  private fun applyDenial(d: Decision) {
    when (d) {
      is Decision.Deny -> stop(d.reason)
      is Decision.Unavailable -> synchronized(this) { if (state == State.ACTIVE) { state = State.PAUSED; reason = Reason.AUTHORITY_UNAVAILABLE } else if (state == State.STARTING) { stop(Reason.AUTHORITY_UNAVAILABLE) } }
      is Decision.Allow -> Unit
    }
  }
}
