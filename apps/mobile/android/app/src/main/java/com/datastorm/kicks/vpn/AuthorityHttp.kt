package com.datastorm.kicks.vpn

import com.datastorm.kicks.vpn.core.AuthorityClient
import com.datastorm.kicks.vpn.core.AuthorityResult
import com.datastorm.kicks.vpn.core.Batch
import com.datastorm.kicks.vpn.core.BatchUploader
import com.datastorm.kicks.vpn.core.Session
import com.datastorm.kicks.vpn.core.UploadResult
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
    setRequestProperty("X-Kicks-Device", session.deviceId)
    setRequestProperty("Accept", "application/json")
  }
}

/**
 * The former GET eligibility fallback is intentionally removed. The frozen POST contract needs
 * permissionId and purpose context that this legacy Session-only interface does not carry. Until
 * the real account/consent adapter supplies that context, fail closed and keep monitoring off.
 */
class HttpAuthorityClient(private val baseUrl: String) : AuthorityClient {
  override fun fetch(session: Session): AuthorityResult =
    AuthorityResult.Unavailable("eligibility_post_requires_permission_purpose_context")
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
