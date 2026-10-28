package com.datastorm.kicks.vpn.core

import java.util.concurrent.atomic.AtomicInteger

const val CONSENT = "11111111-1111-4111-8111-111111111111"
const val PURPOSE = "fraud-detection"

class FakeClock(var now: Long = 1_000_000L) : Clock { override fun nowMs() = now }
class FakeSessions(var session: Session? = null) : SessionSource { override fun current() = session }
class FakeOs(var vpn: Boolean = true, var notifications: Boolean = true) : OsAuthorization {
  override fun vpnAuthorized() = vpn
  override fun notificationsAllowed() = notifications
}
class FakeBinding(var account: String? = null) : DeviceBindingStore {
  override fun boundAccount() = account
  override fun bind(accountId: String) { account = accountId }
}
class FakeAuthority(var result: AuthorityResult) : AuthorityClient {
  val calls = AtomicInteger()
  override fun fetch(session: Session): AuthorityResult { calls.incrementAndGet(); return result }
}
class FakeUploader(var next: () -> UploadResult = { UploadResult.Accepted }) : BatchUploader {
  val batches = ArrayList<Batch>()
  override fun upload(batch: Batch, session: Session): UploadResult { batches.add(batch); return next() }
}

fun okResponse(account: String = "acct-a", owner: String? = account, consent: String? = "granted", sharing: Boolean = true, active: Boolean = true) =
  AuthorityResult.Ok(AuthorityResponse(active, account, owner, consent, CONSENT, PURPOSE, sharing))

class Harness(
  enabled: Boolean = true,
  configured: Boolean = true,
  val clock: FakeClock = FakeClock(),
  val sessions: FakeSessions = FakeSessions(Session("acct-a", "dev-1", "secret-token", 1_000_000L + 3_600_000)),
  val os: FakeOs = FakeOs(),
  val binding: FakeBinding = FakeBinding(),
  val authority: FakeAuthority = FakeAuthority(okResponse()),
  val uploader: FakeUploader = FakeUploader(),
  capacity: Int = 10,
  maxBatch: Int = 4,
  worker: Boolean = true
) {
  val store = MemoryQueueStore()
  private var ids = 0
  val newId: () -> String = { "00000000-0000-4000-8000-%012d".format(++ids) }
  val gate = AuthorizationGate(enabled, sessions, os, if (configured) authority else null, binding, clock)
  val queue = BoundedQueue(capacity, maxBatch, store, newId)
  val controller = CollectorController(gate, queue, uploader, clock, Backoff(jitter = { it }), newId, worker)
  val pump = UploadPump(queue, gate, uploader, Backoff(jitter = { it }))
  val stops = ArrayList<Reason>()
  init { controller.onStopped = { stops.add(it) } }

  fun startOk(): Decision { gate.activate(); return controller.start { true } }
}
