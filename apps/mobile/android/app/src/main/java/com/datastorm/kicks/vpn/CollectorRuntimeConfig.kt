package com.datastorm.kicks.vpn

import android.content.Context

data class CollectorConfig(
  val endpoint: String,
  val deviceToken: String,
  val consentId: String,
  val purpose: String,
  val accessClientId: String,
  val accessClientSecret: String,
)

object CollectorRuntimeConfig {
  const val STAGING_ENDPOINT = "https://staging-api.datastorminc.live"
  const val MONITORING_PURPOSE = "KICK'S private exfiltration monitoring"

  @Volatile private var value: CollectorConfig? = null

  fun provision(
    context: Context,
    deviceToken: String,
    consentId: String,
    purpose: String,
    accessClientId: String,
    accessClientSecret: String,
  ) {
    require(deviceToken.length >= 32) { "A revocable device credential is required." }
    require(consentId.matches(Regex("^[0-9a-fA-F-]{36}$"))) { "A valid consent identifier is required." }
    require(purpose.isNotBlank() && purpose.length <= 160) { "A bounded consent purpose is required." }
    require(accessClientId.endsWith(".access")) { "A Cloudflare Access client identifier is required." }
    require(accessClientSecret.length >= 32) { "A Cloudflare Access client secret is required." }
    val config = CollectorConfig(STAGING_ENDPOINT, deviceToken, consentId, purpose, accessClientId, accessClientSecret)
    SecureCollectorConfigStore.save(context, config)
    value = config
  }

  fun updateConsent(context: Context, consentId: String, purpose: String = MONITORING_PURPOSE): CollectorConfig {
    require(consentId.matches(Regex("^[0-9a-fA-F-]{36}$"))) { "A valid consent identifier is required." }
    val current = get(context) ?: throw IllegalStateException("This device has not been securely provisioned.")
    val updated = current.copy(consentId = consentId, purpose = purpose)
    SecureCollectorConfigStore.save(context, updated)
    value = updated
    return updated
  }

  fun get(context: Context): CollectorConfig? = value ?: SecureCollectorConfigStore.load(context)?.also { value = it }
  fun isProvisioned(context: Context): Boolean = get(context) != null
  fun clearRuntime() { value = null }
}
