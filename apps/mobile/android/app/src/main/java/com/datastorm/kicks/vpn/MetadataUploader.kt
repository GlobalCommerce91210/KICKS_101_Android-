package com.datastorm.kicks.vpn

import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets
import java.time.Instant
import java.util.UUID

enum class UploadResult { ACCEPTED, REPLAY_CONFIRMED }

object MetadataUploader {
  fun metadata(config: CollectorConfig, hostname: String, app: AppAttribution): QueuedUpload {
    val eventId = UUID.randomUUID().toString()
    val batchId = UUID.randomUUID().toString()
    val occurredAt = Instant.now().toString()
    val event = JSONObject()
      .put("eventId", eventId)
      .put("occurredAt", occurredAt)
      .put("sourceApp", app.packageName ?: JSONObject.NULL)
      .put("sourceAppName", app.displayName ?: JSONObject.NULL)
      .put("sourceAppCategory", app.category ?: JSONObject.NULL)
      .put("attribution", app.attribution)
      .put("attributionMethod", app.attributionMethod ?: JSONObject.NULL)
      .put("sourceUid", app.sourceUid ?: JSONObject.NULL)
      .put("attributionFailureReason", app.attributionFailureReason ?: JSONObject.NULL)
      .put("attributionSignals", JSONArray(app.attributionSignals))
      .put("attributionLookupAttempts", app.attributionLookupAttempts)
      .put("sharedUidPackageCount", app.sharedUidPackageCount ?: JSONObject.NULL)
      .put("appSigningCertificateSha256", app.signingCertificateSha256 ?: JSONObject.NULL)
      .put("appInstalledAt", app.installedAt ?: JSONObject.NULL)
      .put("appLastUpdatedAt", app.lastUpdatedAt ?: JSONObject.NULL)
      .put("isSystemApp", app.isSystemApp ?: JSONObject.NULL)
      .put("appVersionName", app.versionName ?: JSONObject.NULL)
      .put("appVersionCode", app.versionCode ?: JSONObject.NULL)
      .put("destinationHost", hostname)
      .put("protocol", "dns")
      .put("bytesBucket", "0-1KB")
      .put("classification", "unknown")
      .put("consentId", config.consentId)
      .put("consentPurpose", config.purpose)
    val body = JSONObject().put("batchId", batchId).put("schemaVersion", "2026-09-01").put("observations", JSONArray().put(event)).toString()
    return QueuedUpload(batchId, "/v1/metadata-batches", body, "metadata", hostname, app.packageName, occurredAt)
  }

  fun lifecycle(event: CollectionLifecycleEvent): QueuedUpload {
    val body = JSONObject().put("eventId", event.eventId).put("sessionId", event.sessionId).put("eventType", event.eventType).put("occurredAt", event.occurredAt).put("reason", event.reason ?: JSONObject.NULL).put("lastHeartbeatAt", event.lastHeartbeatAt ?: JSONObject.NULL).put("appVersion", "0.2.6").toString()
    return QueuedUpload(event.eventId, "/v1/collection-events", body, "lifecycle", null, null, event.occurredAt)
  }

  fun upload(config: CollectorConfig, upload: QueuedUpload): UploadResult {
    require(upload.path == "/v1/metadata-batches" || upload.path == "/v1/collection-events")
    val connection = URL(config.endpoint.trimEnd('/') + upload.path).openConnection() as HttpURLConnection
    try {
      connection.requestMethod = "POST"; connection.connectTimeout = 10_000; connection.readTimeout = 10_000; connection.doOutput = true; connection.instanceFollowRedirects = false
      connection.setRequestProperty("Authorization", "Bearer ${config.deviceToken}")
      connection.setRequestProperty("CF-Access-Client-Id", config.accessClientId)
      connection.setRequestProperty("CF-Access-Client-Secret", config.accessClientSecret)
      connection.setRequestProperty("Content-Type", "application/json")
      connection.outputStream.use { it.write(upload.body.toByteArray(StandardCharsets.UTF_8)) }
      val responseCode = connection.responseCode
      if (responseCode in 200..299) return UploadResult.ACCEPTED
      if (responseCode == 409) {
        val response = connection.errorStream?.bufferedReader(StandardCharsets.UTF_8)?.use { it.readText() }.orEmpty()
        if (response.contains("replay_detected")) return UploadResult.REPLAY_CONFIRMED
      }
      throw IllegalStateException("${upload.kind} upload rejected: $responseCode")
    } finally { connection.disconnect() }
  }
}
