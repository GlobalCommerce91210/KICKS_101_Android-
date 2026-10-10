package com.datastorm.kicks.vpn

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import org.json.JSONObject
import java.io.File
import java.nio.ByteBuffer
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

object SecureCollectorConfigStore {
  private const val KEY_ALIAS = "datastorm_kicks_collector_config_v1"
  private const val FILE_NAME = "collector-config-v1.bin"
  private const val FORMAT_VERSION: Byte = 1
  private const val GCM_TAG_BITS = 128

  fun save(context: Context, config: CollectorConfig) {
    val plain = JSONObject()
      .put("endpoint", config.endpoint)
      .put("deviceToken", config.deviceToken)
      .put("consentId", config.consentId)
      .put("purpose", config.purpose)
      .put("accessClientId", config.accessClientId)
      .put("accessClientSecret", config.accessClientSecret)
      .toString().toByteArray(Charsets.UTF_8)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
    val encrypted = cipher.doFinal(plain)
    plain.fill(0)
    val payload = ByteBuffer.allocate(2 + cipher.iv.size + encrypted.size).put(FORMAT_VERSION).put(cipher.iv.size.toByte()).put(cipher.iv).put(encrypted).array()
    val target = File(context.noBackupFilesDir, FILE_NAME)
    val temporary = File(context.noBackupFilesDir, "$FILE_NAME.tmp")
    temporary.outputStream().use { output ->
      output.write(payload); output.flush(); if (output is java.io.FileOutputStream) output.fd.sync()
    }
    check(temporary.renameTo(target)) { "Unable to commit encrypted collector configuration." }
  }

  fun load(context: Context): CollectorConfig? {
    val target = File(context.noBackupFilesDir, FILE_NAME)
    if (!target.exists()) return null
    return runCatching {
      val buffer = ByteBuffer.wrap(target.readBytes())
      check(buffer.get() == FORMAT_VERSION) { "Unsupported collector configuration version." }
      val ivLength = buffer.get().toInt() and 0xff
      check(ivLength in 12..32 && buffer.remaining() > ivLength) { "Invalid encrypted collector configuration." }
      val iv = ByteArray(ivLength).also(buffer::get)
      val encrypted = ByteArray(buffer.remaining()).also(buffer::get)
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(GCM_TAG_BITS, iv))
      val plain = cipher.doFinal(encrypted)
      try {
        val json = JSONObject(String(plain, Charsets.UTF_8))
        CollectorConfig(json.getString("endpoint"), json.getString("deviceToken"), json.getString("consentId"), json.getString("purpose"), json.getString("accessClientId"), json.getString("accessClientSecret")).also { check(it.endpoint == CollectorRuntimeConfig.STAGING_ENDPOINT) }
      } finally { plain.fill(0) }
    }.getOrNull()
  }

  private fun getOrCreateKey(): SecretKey {
    val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
    return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
      init(KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).setRandomizedEncryptionRequired(true).build())
      generateKey()
    }
  }
}
