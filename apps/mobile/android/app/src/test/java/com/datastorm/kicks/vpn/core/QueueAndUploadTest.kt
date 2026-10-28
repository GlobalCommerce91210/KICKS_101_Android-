package com.datastorm.kicks.vpn.core

import org.junit.Assert.*
import org.junit.Test

private fun obs(i: Int, consent: String = CONSENT) = Observation(
  "00000000-0000-4000-8000-%012d".format(i), "2026-01-01T00:00:00Z", null, "unknown", "h$i.example", "dns", "0-1KB", "unknown", consent, PURPOSE
)

class BoundedQueueTest {
  private fun q(cap: Int = 3, max: Int = 2, store: QueueStore = MemoryQueueStore()): BoundedQueue {
    var n = 0; return BoundedQueue(cap, max, store) { "batch-${++n}" }
  }

  @Test fun dropsOldestWhenFullAndCountsIt() {
    val q = q(); (1..5).forEach { q.offer(obs(it)) }
    assertEquals(3, q.size()); assertEquals(2L, q.dropped)
    assertEquals(listOf("h3.example", "h4.example"), q.peekBatch()!!.observations.map { it.destinationHost })
  }

  @Test fun inFlightBatchIsStableUntilAcked() {
    val q = q(); (1..3).forEach { q.offer(obs(it)) }
    val a = q.peekBatch()!!; q.offer(obs(9))
    assertSame(a, q.peekBatch()); assertEquals(3, q.size())
    q.ack(a.batchId)
    assertNotEquals(a.batchId, q.peekBatch()!!.batchId)
  }

  @Test fun batchNeverExceedsServerLimit() {
    val q = BoundedQueue(1000, 250, MemoryQueueStore()) { "b" }
    (1..600).forEach { q.offer(obs(it)) }
    assertEquals(250, q.peekBatch()!!.observations.size)
  }

  @Test fun survivesRestartWithSameBatchId() {
    val store = MemoryQueueStore(); val q1 = q(store = store)
    (1..3).forEach { q1.offer(obs(it)) }
    val flight = q1.peekBatch()!!; q1.persist()
    val q2 = q(store = store); q2.restore()
    assertEquals(3, q2.size())
    assertEquals(flight, q2.peekBatch())
  }

  @Test fun specialCharactersRoundTrip() {
    val store = MemoryQueueStore(); val q1 = q(store = store)
    q1.offer(obs(1).copy(consentPurpose = "a\tb\nc \"d\" é")); q1.persist()
    val q2 = q(store = store); q2.restore()
    assertEquals("a\tb\nc \"d\" é", q2.peekBatch()!!.observations[0].consentPurpose)
  }

  @Test fun corruptStoreIsDiscarded() {
    val store = MemoryQueueStore(); store.save("garbage\nP\tx")
    val q = q(store = store); q.restore()
    assertEquals(0, q.size()); assertNull(store.load())
  }

  @Test fun oversizedRestoredStateIsTrimmedToCapacity() {
    val store = MemoryQueueStore(); val big = q(cap = 10, max = 2, store = store)
    (1..8).forEach { big.offer(obs(it)) }; big.persist()
    val small = q(cap = 3, max = 2, store = store); small.restore()
    assertEquals(3, small.size())
  }

  @Test fun retainConsentRemovesStaleConsentData() {
    val q = q(); q.offer(obs(1, "old")); q.offer(obs(2)); q.peekBatch(); q.offer(obs(3, "old"))
    q.retainConsent(CONSENT)
    assertEquals(listOf("h2.example"), q.peekBatch()!!.observations.map { it.destinationHost })
  }

  @Test fun purgeEmptiesQueueAndStore() {
    val store = MemoryQueueStore(); val q = q(store = store)
    q.offer(obs(1)); q.persist(); q.purge()
    assertEquals(0, q.size()); assertNull(store.load())
  }
}

class UploadPumpTest {
  private fun loaded(h: Harness): Harness {
    // helper runs without the background worker so pump steps are deterministic
    h.startOk(); (1..2).forEach { h.controller.onDns("h$it.example", 1) }; return h }

  @Test fun uploadsAndAcks() {
    val h = loaded(Harness(worker = false))
    assertEquals(PumpResult.Uploaded(2), h.pump.runOnce())
    assertEquals(0, h.queue.size())
    assertEquals(PumpResult.Idle, h.pump.runOnce())
    h.controller.explicitStop()
  }

  @Test fun uploadedPayloadHasOnlyApprovedFields() {
    val h = loaded(Harness(worker = false)); h.pump.runOnce()
    val json = h.uploader.batches.single().toJson()
    val keys = Regex("\"([A-Za-z]+)\":").findAll(json).map { it.groupValues[1] }.toSet()
    assertEquals(setOf("batchId", "schemaVersion", "observations", "eventId", "occurredAt", "sourceApp", "attribution",
      "destinationHost", "protocol", "bytesBucket", "classification", "consentId", "consentPurpose"), keys)
    assertFalse(json.contains("secret-token"))
    h.controller.explicitStop()
  }

  @Test fun duplicateIsTreatedAsDelivered() {
    val h = loaded(Harness(worker = false)); h.uploader.next = { UploadResult.Duplicate }
    assertTrue(h.pump.runOnce() is PumpResult.Uploaded); assertEquals(0, h.queue.size())
    h.controller.explicitStop()
  }

  @Test fun retryKeepsBatchIdAndBacksOffWithinBounds() {
    val h = loaded(Harness(worker = false)); h.uploader.next = { UploadResult.Transient("503") }
    val delays = (1..5).map { (h.pump.runOnce() as PumpResult.RetryLater).delayMs }
    assertEquals(1, h.uploader.batches.map { it.batchId }.toSet().size)
    assertEquals(delays.sorted(), delays)
    assertTrue(delays.all { it in 1..300_000 })
    h.controller.explicitStop()
  }

  @Test fun retryCapDiscardsPoisonBatch() {
    val h = loaded(Harness(worker = false)); h.uploader.next = { UploadResult.Transient("503") }
    repeat(8) { h.pump.runOnce() }
    assertEquals(0, h.queue.size()); assertEquals(1, h.pump.discardedBatches)
    h.controller.explicitStop()
  }

  @Test fun schemaRejectionDropsBatchWithoutRetry() {
    val h = loaded(Harness(worker = false)); h.uploader.next = { UploadResult.Rejected }
    h.pump.runOnce()
    assertEquals(0, h.queue.size()); assertEquals(1, h.uploader.batches.size)
    h.controller.explicitStop()
  }

  @Test fun authorizationRecheckedBeforeEveryRetry() {
    val h = loaded(Harness(worker = false)); h.uploader.next = { UploadResult.Transient("x") }
    h.pump.runOnce()
    val calls = h.authority.calls.get()
    h.authority.result = okResponse(consent = "revoked")
    assertEquals(PumpResult.Halted(Reason.CONSENT_NOT_GRANTED), h.pump.runOnce())
    assertEquals(calls + 1, h.authority.calls.get())
    assertEquals(1, h.uploader.batches.size)
  }

  @Test fun consentLostBetweenBufferAndUploadSendsNothing() {
    val h = loaded(Harness(worker = false)); h.authority.result = okResponse(consent = "revoked")
    assertEquals(PumpResult.Halted(Reason.CONSENT_NOT_GRANTED), h.pump.runOnce())
    assertTrue(h.uploader.batches.isEmpty())
  }

  @Test fun logoutBeforeUploadSendsNothing() {
    val h = loaded(Harness(worker = false)); h.sessions.session = null
    assertEquals(PumpResult.Halted(Reason.NO_SESSION), h.pump.runOnce())
    assertTrue(h.uploader.batches.isEmpty())
  }

  @Test fun expiredSessionBlocksUpload() {
    val h = loaded(Harness(worker = false)); h.clock.now += 3_700_000
    assertEquals(PumpResult.Halted(Reason.SESSION_EXPIRED), h.pump.runOnce())
    assertTrue(h.uploader.batches.isEmpty())
  }

  @Test fun osAuthorizationLossBlocksUpload() {
    val h = loaded(Harness(worker = false)); h.os.vpn = false
    assertEquals(PumpResult.Halted(Reason.OS_VPN_NOT_AUTHORIZED), h.pump.runOnce())
    assertTrue(h.uploader.batches.isEmpty())
  }

  @Test fun serverUnauthorizedHaltsMappedToReason() {
    val h = loaded(Harness(worker = false)); h.uploader.next = { UploadResult.Unauthorized(401) }
    assertEquals(PumpResult.Halted(Reason.SESSION_REVOKED), h.pump.runOnce())
    h.uploader.next = { UploadResult.Unauthorized(403) }
    assertEquals(PumpResult.Halted(Reason.CONSENT_NOT_GRANTED), h.pump.runOnce())
  }

  @Test fun authorityOutagePausesUploadWithBackoff() {
    val h = loaded(Harness(worker = false)); h.authority.result = AuthorityResult.Unavailable("down")
    assertTrue(h.pump.runOnce() is PumpResult.RetryLater)
    assertTrue(h.uploader.batches.isEmpty()); assertEquals(2, h.queue.size())
  }

  @Test fun restartedQueueIsReauthorizedAndConsentFiltered() {
    val h = Harness(worker = false); h.startOk()
    h.queue.offer(obs(1, "stale-consent")); h.queue.persist(); h.controller.explicitStop()
    val h2 = Harness(worker = false); h2.store.save(h.store.load()!!)
    h2.startOk()
    assertEquals(PumpResult.Idle, h2.pump.runOnce())
    assertEquals(0, h2.queue.size())
    assertTrue(h2.uploader.batches.isEmpty())
    h2.controller.explicitStop()
  }
}

class BackoffTest {
  @Test fun growsExponentiallyAndIsCapped() {
    val b = Backoff(1000, 30_000, 8, jitter = { it })
    assertEquals(listOf(1000L, 2000L, 4000L, 8000L, 16000L, 30000L, 30000L), (0..6).map { b.delayMs(it) })
    assertEquals(30_000L, b.delayMs(1000))
  }
  @Test fun jitterStaysInRange() { repeat(200) { assertTrue(Backoff(1000, 30_000).delayMs(3) in 4000..8000) } }
}

class MinimizerAndDnsTest {
  private val grant = Grant(CONSENT, PURPOSE)

  @Test fun bucketsMatchServerEnum() {
    assertEquals(listOf("0-1KB", "1-10KB", "10-100KB", "100KB-1MB", "1MB+"),
      listOf(0, 5000, 50_000, 500_000, 5_000_000).map { Minimizer.bucket(it) })
  }
  @Test fun hostNormalization() {
    assertEquals("a.b.com", Minimizer.normalizeHost("A.B.com."))
    listOf("", "a b", "http://x.com", "x.com/path", "x.com?q=1", "1.2.3.4", "-a.com", "a..b", "user@x.com").forEach { assertNull(it, Minimizer.normalizeHost(it)) }
  }
  @Test fun observationIsUnknownAttributed() {
    val o = Minimizer.fromDns("x.com", 1, grant, 0, "e")!!
    assertEquals("1970-01-01T00:00:00Z", o.occurredAt)
    assertEquals("unknown", o.attribution); assertNull(o.sourceApp)
  }
  @Test fun jsonEscapes() { assertEquals("\"a\\\"b\\\\\\n\"".replace("\\n", "\\u000a"), Json.str("a\"b\\\n")) }

  private fun query(name: String, dstPort: Int = 53, frag: Int = 0): ByteArray {
    val labels = name.split('.')
    val q = ArrayList<Byte>()
    q.addAll(listOf(0x12, 0x34, 0x01, 0x00, 0, 1, 0, 0, 0, 0, 0, 0).map { it.toByte() })
    labels.forEach { l -> q.add(l.length.toByte()); l.forEach { q.add(it.code.toByte()) } }
    q.addAll(listOf(0, 0, 1, 0, 1).map { it.toByte() })
    val total = 28 + q.size
    val p = ByteArray(total)
    p[0] = 0x45; p[2] = (total ushr 8).toByte(); p[3] = total.toByte(); p[6] = (frag ushr 8).toByte(); p[7] = frag.toByte(); p[8] = 64; p[9] = 17
    byteArrayOf(10, 111, 111.toByte(), 1).copyInto(p, 12); byteArrayOf(10, 111, 111.toByte(), 2).copyInto(p, 16)
    p[20] = 0x30; p[21] = 0x39; p[22] = (dstPort ushr 8).toByte(); p[23] = dstPort.toByte()
    val udp = 8 + q.size; p[24] = (udp ushr 8).toByte(); p[25] = udp.toByte()
    q.toByteArray().copyInto(p, 28)
    return p
  }

  @Test fun parsesDnsQuestionName() {
    val d = DnsPacket.parse(query("www.example.com"))!!
    assertEquals("www.example.com", d.qname); assertEquals(53, d.dstPort); assertEquals(0x3039, d.srcPort)
  }
  @Test fun rejectsNonDnsFragmentsAndTruncated() {
    assertNull(DnsPacket.parse(query("a.com", dstPort = 443)))
    assertNull(DnsPacket.parse(query("a.com", frag = 0x0010)))
    val p = query("a.com"); assertNull(DnsPacket.parse(p, 20))
    assertNull(DnsPacket.parse(ByteArray(40)))
  }
  @Test fun compressionPointersInQuestionAreRejectedAsUnknownName() {
    val p = query("a.com"); p[40] = 0xC0.toByte()
    assertNull(DnsPacket.parse(p)!!.qname)
  }
  @Test fun responseSwapsEndpointsWithValidChecksum() {
    val q = DnsPacket.parse(query("a.com"))!!
    val r = DnsPacket.buildResponse(q, byteArrayOf(1, 2, 3))
    assertEquals(0, DnsPacket.checksum(r, 0, 20))
    assertArrayEquals(q.dstIp, r.copyOfRange(12, 16)); assertArrayEquals(q.srcIp, r.copyOfRange(16, 20))
    assertEquals(0x3039, ((r[22].toInt() and 0xff) shl 8) or (r[23].toInt() and 0xff))
    assertEquals(31, r.size)
  }
}
