package com.datastorm.kicks.vpn

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets
import java.util.UUID

data class MonitoringGrant(val permissionId: String, val activationRequestId: String, val activationId: String)

object MonitoringConsentClient {
  private const val POLICY_VERSION = "2026-09-16"
  private const val PURPOSE_VERSION = "monitoring-v1"

  fun grant(config: CollectorConfig): MonitoringGrant {
    val activationRequestId = UUID.randomUUID().toString()
    val body = JSONObject()
      .put("permissionId", config.consentId)
      .put("action", "grant")
      .put("policyVersion", POLICY_VERSION)
      .put("purposeVersion", PURPOSE_VERSION)
      .put("purpose", CollectorRuntimeConfig.MONITORING_PURPOSE)
      .put("activationRequestId", activationRequestId)
      .toString()
    val response = post(config, body)
    val activationId = JSONObject(response).optString("activationId")
    require(activationId.matches(Regex("^[0-9a-fA-F-]{36}$"))) { "Consent ledger did not return a valid activation identifier." }
    return MonitoringGrant(config.consentId, activationRequestId, activationId)
  }

  fun revoke(config: CollectorConfig, activationId: String) {
    val body = JSONObject()
      .put("permissionId", config.consentId)
      .put("action", "revoke")
      .put("policyVersion", POLICY_VERSION)
      .put("purposeVersion", PURPOSE_VERSION)
      .put("purpose", CollectorRuntimeConfig.MONITORING_PURPOSE)
      .put("activationId", activationId)
      .toString()
    post(config, body)
  }

  private fun post(config: CollectorConfig, body: String): String {
    val connection = URL(config.endpoint.trimEnd('/') + "/v1/consent-events").openConnection() as HttpURLConnection
    try {
      connection.requestMethod = "POST"
      connection.connectTimeout = 10_000
      connection.readTimeout = 10_000
      connection.doOutput = true
      connection.instanceFollowRedirects = false
      connection.setRequestProperty("Authorization", "Bearer ${config.deviceToken}")
      connection.setRequestProperty("CF-Access-Client-Id", config.accessClientId)
      connection.setRequestProperty("CF-Access-Client-Secret", config.accessClientSecret)
      connection.setRequestProperty("Content-Type", "application/json")
      connection.outputStream.use { it.write(body.toByteArray(StandardCharsets.UTF_8)) }
      val status = connection.responseCode
      val text = (if (status in 200..299) connection.inputStream else connection.errorStream)
        ?.bufferedReader(StandardCharsets.UTF_8)?.use { it.readText() }.orEmpty()
      if (status !in 200..299) throw IllegalStateException("Consent ledger rejected the request ($status).")
      return text
    } finally { connection.disconnect() }
  }
}
