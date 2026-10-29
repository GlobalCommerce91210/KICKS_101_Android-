package com.datastorm.kicks.vpn.core

import java.net.URLDecoder
import java.net.URLEncoder

data class Batch(val batchId: String, val observations: List<Observation>) {
  fun toJson(): String =
    "{\"batchId\":${Json.str(batchId)},\"schemaVersion\":${Json.str(Minimizer.SCHEMA_VERSION)}," +
      "\"observations\":[${observations.joinToString(",") { it.toJson() }}]}"
}

interface QueueStore {
  fun load(): String?
  fun save(snapshot: String)
  fun clear()
}

class MemoryQueueStore : QueueStore {
  @Volatile var data: String? = null
  override fun load() = data
  override fun save(snapshot: String) { data = snapshot }
  override fun clear() { data = null }
}

/**
 * Bounded observation queue.
 *
 * Backpressure: when [capacity] is reached the OLDEST pending observation is dropped (and counted)
 * so memory/disk stay bounded and the newest metadata wins; the in-flight batch is never dropped
 * mid-upload. The in-flight batch keeps its batchId across retries and restarts so the server's
 * replay protection (409) makes redelivery idempotent.
 */
class BoundedQueue(
  val capacity: Int = 2000,
  val maxBatch: Int = 250,
  private val store: QueueStore,
  private val newId: () -> String
) {
  private val pending = ArrayDeque<Observation>()
  private var inFlight: Batch? = null
  @Volatile var dropped: Long = 0; private set

  init { require(capacity in 1..100_000 && maxBatch in 1..250 && maxBatch <= capacity) }

  @Synchronized fun size() = pending.size + (inFlight?.observations?.size ?: 0)

  @Synchronized fun offer(o: Observation) {
    while (size() >= capacity && pending.isNotEmpty()) { pending.removeFirst(); dropped++ }
    if (size() >= capacity) { dropped++; return }
    pending.addLast(o)
  }

  /** Returns the same batch until it is acknowledged or discarded. */
  @Synchronized fun peekBatch(): Batch? {
    inFlight?.let { return it }
    if (pending.isEmpty()) return null
    val items = ArrayList<Observation>()
    while (items.size < maxBatch && pending.isNotEmpty()) items.add(pending.removeFirst())
    return Batch(newId(), items).also {
      inFlight = it
      // The batch identity must reach durable storage before any network send can begin.
      persist()
    }
  }

  @Synchronized fun ack(batchId: String) { if (inFlight?.batchId == batchId) inFlight = null; persist() }

  /** Removes observations recorded under a consent that is no longer the current grant. */
  @Synchronized fun retainConsent(consentId: String) {
    val b = inFlight
    if (b != null && b.observations.any { it.consentId != consentId }) {
      // Re-batch only the still-authorized observations under a fresh batchId.
      inFlight = null
      b.observations.filter { it.consentId == consentId }.asReversed().forEach { pending.addFirst(it) }
    }
    pending.removeAll { it.consentId != consentId }
    persist()
  }

  @Synchronized fun purge() { pending.clear(); inFlight = null; store.clear() }

  @Synchronized fun persist() {
    if (pending.isEmpty() && inFlight == null) { store.clear(); return }
    val sb = StringBuilder()
    inFlight?.let { b -> sb.append("B\t").append(b.batchId).append('\n'); b.observations.forEach { sb.append(line("F", it)) } }
    pending.forEach { sb.append(line("P", it)) }
    store.save(sb.toString())
  }

  /** Restores persisted state; malformed data is discarded rather than guessed at. Never trusted for authorization. */
  @Synchronized fun restore() {
    pending.clear(); inFlight = null
    val text = store.load() ?: return
    try {
      var batchId: String? = null
      val flight = ArrayList<Observation>()
      for (l in text.split('\n')) {
        if (l.isEmpty()) continue
        val f = l.split('\t')
        when (f[0]) {
          "B" -> batchId = f[1]
          "F" -> flight.add(decode(f))
          "P" -> pending.addLast(decode(f))
          else -> throw IllegalArgumentException()
        }
      }
      if (batchId != null && flight.isNotEmpty()) inFlight = Batch(batchId, flight)
      while (size() > capacity && pending.isNotEmpty()) { pending.removeFirst(); dropped++ }
    } catch (e: Exception) {
      pending.clear(); inFlight = null; store.clear()
    }
  }

  private fun enc(v: String?) = if (v == null) "-" else "~" + URLEncoder.encode(v, "UTF-8")
  private fun dec(v: String) = if (v == "-") null else URLDecoder.decode(v.substring(1), "UTF-8")
  private fun line(tag: String, o: Observation) = listOf(
    tag, o.eventId, o.occurredAt, o.sourceApp, o.attribution, o.destinationHost, o.protocol,
    o.bytesBucket, o.classification, o.consentId, o.consentPurpose
  ).mapIndexed { i, v -> if (i == 0) v else enc(v) }.joinToString("\t") + "\n"
  private fun decode(f: List<String>): Observation {
    require(f.size == 11)
    val v = f.drop(1).map { dec(it) }
    return Observation(v[0]!!, v[1]!!, v[2], v[3]!!, v[4]!!, v[5]!!, v[6]!!, v[7]!!, v[8]!!, v[9]!!)
  }
}
