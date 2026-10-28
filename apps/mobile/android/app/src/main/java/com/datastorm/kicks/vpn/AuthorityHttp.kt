package com.datastorm.kicks.vpn

import com.datastorm.kicks.vpn.core.AuthorityClient
import com.datastorm.kicks.vpn.core.AuthorityResponse
import com.datastorm.kicks.vpn.core.AuthorityResult
import com.datastorm.kicks.vpn.core.Batch
import com.datastorm.kicks.vpn.core.BatchUploader
import com.datastorm.kicks.vpn.core.Reason
import com.datastorm.kicks.vpn.core.Session
import com.datastorm.kicks.vpn.core.UploadResult
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

private fun connect(base: String, path: String, method: String, session: Session): HttpURLConnection {
  require(base.startsWith("https://")) { "https required" }
  return (URL(base.trimEnd('/') + path).openConnection() as HttpURLConnection).apply {
    requestMethod = method
    connectTimeout = 8_000
    readTimeout = 10_000
    instanceFollowRedirects = false
    setRequestProperty("Authorization", "Bearer " + session.token)
    setRequestProperty("Accept", "application/json")
  }
}

/**
 * Authoritative eligibility lookup. NOTE: GET /v1/collector/eligibility is the contract this client
 * expects from the backend (consent/enrollment work tracked separately); until it exists the call
 * fails and the collector stays off.
 */
class HttpAuthorityClient(private val baseUrl: String) : AuthorityClient {
  override fun fetch(session: Session): AuthorityResult = try {
    val c = connect(baseUrl, "/v1/collector/eligibility", "GET", session)
    c.setRequestProperty("X-Kicks-Device", session.deviceId)
    try {
      when (val code = c.responseCode) {
        200 -> {
          val j = JSONObject(c.inputStream.bufferedReader().use { it.readText() })
          AuthorityResult.Ok(
            AuthorityResponse(
              sessionActive = j.optBoolean("sessionActive", false),
              accountId = j.optString("accountId").ifEmpty { null },
              deviceOwnerAccountId = j.optString("deviceOwnerAccountId").ifEmpty { null },
              consentState = j.optString("consentState").ifEmpty { null },
              consentId = j.optString("consentId").ifEmpty { null },
              consentPurpose = j.optString("consentPurpose").ifEmpty { null },
              dataSharing = j.optBoolean("dataSharing", false)
            )
          )
        }
        401 -> AuthorityResult.Rejected(Reason.SESSION_REVOKED)
        403 -> {
          val body = try { c.errorStream?.bufferedReader()?.use { it.readText() } ?: "" } catch (e: Exception) { "" }
          AuthorityResult.Rejected(if (body.contains("device_owned_by_another_account")) Reason.CROSS_ACCOUNT_REJECTED else Reason.CONSENT_NOT_GRANTED)
        }
        else -> AuthorityResult.Unavailable("http_$code")
      }
    } finally { c.disconnect() }
  } catch (e: Exception) { AuthorityResult.Unavailable(e.javaClass.simpleName) }
}

class HttpBatchUploader(private val baseUrl: String) : BatchUploader {
  override fun upload(batch: Batch, session: Session): UploadResult = try {
    val c = connect(baseUrl, "/v1/metadata-batches", "POST", session)
    c.doOutput = true
    c.setRequestProperty("Content-Type", "application/json")
    try {
      c.outputStream.use { it.write(batch.toJson().toByteArray(Charsets.UTF_8)) }
      when (val code = c.responseCode) {
        202 -> UploadResult.Accepted
        409 -> UploadResult.Duplicate
        401, 403 -> UploadResult.Unauthorized(code)
        400 -> UploadResult.Rejected
        else -> UploadResult.Transient("http_$code")
      }
    } finally { c.disconnect() }
  } catch (e: Exception) { UploadResult.Transient(e.javaClass.simpleName) }
}
