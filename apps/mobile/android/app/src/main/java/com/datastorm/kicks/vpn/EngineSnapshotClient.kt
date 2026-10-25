package com.datastorm.kicks.vpn

import java.net.HttpURLConnection
import java.net.URL

object EngineSnapshotClient {
  fun fetch(config: CollectorConfig): String = fetchPath(config, "/v1/me/engine?limit=50")

  fun fetchConsumerState(config: CollectorConfig): String = fetchPath(config, "/v1/me/consumer-state")
  fun getReceipt(config:CollectorConfig,id:String)=fetchPath(config,"/v1/receipts/$id")
  fun post(config:CollectorConfig,path:String,body:String="{}",idempotencyKey:String?=null):String{
    val connection=URL(config.endpoint.trimEnd('/')+path).openConnection() as HttpURLConnection
    try{connection.requestMethod="POST";connection.connectTimeout=10_000;connection.readTimeout=10_000;connection.doOutput=true;connection.instanceFollowRedirects=false;connection.setRequestProperty("Authorization","Bearer ${config.deviceToken}");connection.setRequestProperty("CF-Access-Client-Id",config.accessClientId);connection.setRequestProperty("CF-Access-Client-Secret",config.accessClientSecret);connection.setRequestProperty("Content-Type","application/json");connection.setRequestProperty("Accept","application/json");idempotencyKey?.let{connection.setRequestProperty("Idempotency-Key",it)};connection.outputStream.use{it.write(body.toByteArray(Charsets.UTF_8))};val status=connection.responseCode;val stream=if(status in 200..299)connection.inputStream else connection.errorStream;val response=stream?.bufferedReader(Charsets.UTF_8)?.use{it.readText()}?:"";if(status !in 200..299)throw IllegalStateException("KICK'S request rejected ($status): $response");return response}finally{connection.disconnect()}
  }

  private fun fetchPath(config: CollectorConfig, path: String): String {
    val connection = URL(config.endpoint.trimEnd('/') + path)
      .openConnection() as HttpURLConnection
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
      if (status !in 200..299) throw IllegalStateException("KICK'S request rejected ($status).")
      return connection.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
    } finally {
      connection.disconnect()
    }
  }
}
