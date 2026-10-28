package com.datastorm.kicks.vpn.core

import java.time.Instant

/** Exactly the server's strict observation schema (2026-08-01). No other field may be added. */
data class Observation(
  val eventId: String,
  val occurredAt: String,
  val sourceApp: String?,
  val attribution: String,
  val destinationHost: String,
  val protocol: String,
  val bytesBucket: String,
  val classification: String,
  val consentId: String,
  val consentPurpose: String
) {
  fun toJson(): String = buildString {
    append('{')
    append("\"eventId\":").append(Json.str(eventId)).append(',')
    append("\"occurredAt\":").append(Json.str(occurredAt)).append(',')
    append("\"sourceApp\":").append(if (sourceApp == null) "null" else Json.str(sourceApp)).append(',')
    append("\"attribution\":").append(Json.str(attribution)).append(',')
    append("\"destinationHost\":").append(Json.str(destinationHost)).append(',')
    append("\"protocol\":").append(Json.str(protocol)).append(',')
    append("\"bytesBucket\":").append(Json.str(bytesBucket)).append(',')
    append("\"classification\":").append(Json.str(classification)).append(',')
    append("\"consentId\":").append(Json.str(consentId)).append(',')
    append("\"consentPurpose\":").append(Json.str(consentPurpose))
    append('}')
  }
}

object Json {
  fun str(v: String): String = buildString {
    append('"')
    for (ch in v) when {
      ch == '"' -> append("\\\"")
      ch == '\\' -> append("\\\\")
      ch < ' ' -> append(String.format("\\u%04x", ch.code))
      else -> append(ch)
    }
    append('"')
  }
}

object Minimizer {
  const val SCHEMA_VERSION = "2026-08-01"
  private val HOST = Regex("^(?=.{1,253}$)(?!-)[a-z0-9.-]+(?<!-)$")
  private val IPV4_LITERAL = Regex("^[0-9.]+$")

  /** Lower-cased DNS name or null when the destination cannot be stated with certainty. */
  fun normalizeHost(raw: String?): String? {
    val h = raw?.trim()?.trimEnd('.')?.lowercase() ?: return null
    if (h.isEmpty() || !HOST.matches(h) || IPV4_LITERAL.matches(h) || h.contains("..")) return null
    return h
  }

  fun bucket(bytes: Int): String = when {
    bytes <= 1024 -> "0-1KB"
    bytes <= 10 * 1024 -> "1-10KB"
    bytes <= 100 * 1024 -> "10-100KB"
    bytes <= 1024 * 1024 -> "100KB-1MB"
    else -> "1MB+"
  }

  /**
   * DNS metadata has no reliable app attribution and no destination classification, so those fields
   * are always reported as unknown instead of being inferred. Returns null (record nothing) when the
   * host is not certain; the schema has no "unknown host" value.
   */
  fun fromDns(qname: String?, bytes: Int, grant: Grant, nowMs: Long, eventId: String): Observation? {
    val host = normalizeHost(qname) ?: return null
    return Observation(
      eventId = eventId,
      occurredAt = Instant.ofEpochMilli(nowMs).toString(),
      sourceApp = null,
      attribution = "unknown",
      destinationHost = host,
      protocol = "dns",
      bytesBucket = bucket(bytes),
      classification = "unknown",
      consentId = grant.consentId,
      consentPurpose = grant.consentPurpose
    )
  }
}
