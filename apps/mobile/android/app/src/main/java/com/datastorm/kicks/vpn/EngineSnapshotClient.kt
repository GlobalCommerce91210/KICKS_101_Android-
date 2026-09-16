package com.datastorm.kicks.vpn

import java.net.HttpURLConnection
import java.net.URL

object EngineSnapshotClient {
  fun fetch(config: CollectorConfig): String {
    val connection = URL(config.endpoint.trimEnd('/') + "/v1/me/engine?limit=50").openConnection() as HttpURLConnection
    try {
      connection.requestMethod = "GET"
      connection.connectTimeout = 10_000
      connection.readTimeout = 10_000
      connection.instanceFollowRedirects = false
      connection.useCaches = false
      connection.setRequestProperty("Authorization", "Bearer ${config.deviceToken}")
      connection.setRequestProperty("CF-Access-Client-Id", config.accessClientId)
      connection.setRequestProperty("CF-Access-Client-Secret", config.accessClientSecret)
      connection.setRequestProperty("Accept", "application/json")
      connection.setRequestProperty("Cache-Control", "no-cache, no-store")
      connection.setRequestProperty("Pragma", "no-cache")
      val status = connection.responseCode
      if (status !in 200..299) throw IllegalStateException("Engine snapshot request rejected ($status).")
      return connection.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
    } finally { connection.disconnect() }
  }
}
