package com.datastorm.kicks.vpn

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import com.datastorm.kicks.vpn.core.DeviceBindingStore
import com.datastorm.kicks.vpn.core.QueueStore
import com.datastorm.kicks.vpn.core.Session
import com.datastorm.kicks.vpn.core.SessionSource
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** AES-256-GCM with a non-exportable Android Keystore key. Undecryptable data is treated as absent (fail closed). */
class KeystoreCipher(private val alias: String) {
  private fun key(): SecretKey {
    val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (ks.getKey(alias, null) as? SecretKey)?.let { return it }
    val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    gen.init(
      KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .build()
    )
    return gen.generateKey()
  }

  fun encrypt(plain: ByteArray): ByteArray {
    val c = Cipher.getInstance("AES/GCM/NoPadding")
    c.init(Cipher.ENCRYPT_MODE, key())
    return byteArrayOf(c.iv.size.toByte()) + c.iv + c.doFinal(plain)
  }

  fun decrypt(blob: ByteArray): ByteArray? = try {
    val ivLen = blob[0].toInt()
    val c = Cipher.getInstance("AES/GCM/NoPadding")
    c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, blob, 1, ivLen))
    c.doFinal(blob, 1 + ivLen, blob.size - 1 - ivLen)
  } catch (e: Exception) { null }
}

/** Encrypted file in the no-backup directory so credentials/queue are never included in device backups. */
class EncryptedFile(private val file: File, private val cipher: KeystoreCipher) {
  @Synchronized fun read(): String? = try {
    if (file.exists()) cipher.decrypt(file.readBytes())?.toString(Charsets.UTF_8) else null
  } catch (e: Exception) { null }

  @Synchronized fun write(text: String) {
    val tmp = File(file.path + ".tmp")
    tmp.writeBytes(cipher.encrypt(text.toByteArray(Charsets.UTF_8)))
    if (!tmp.renameTo(file)) { file.delete(); tmp.renameTo(file) }
  }

  @Synchronized fun delete() { file.delete(); File(file.path + ".tmp").delete() }
}

class EncryptedQueueStore(private val f: EncryptedFile) : QueueStore {
  override fun load() = f.read()
  override fun save(snapshot: String) = f.write(snapshot)
  override fun clear() = f.delete()
}

/** Session restore reads only this store; restored sessions still pass through the authorization gate. */
class SecureSessionStore(private val f: EncryptedFile) : SessionSource {
  override fun current(): Session? {
    val p = f.read()?.split('\n') ?: return null
    if (p.size != 4) return null
    val exp = p[3].toLongOrNull() ?: return null
    return Session(p[0], p[1], p[2], exp)
  }

  fun save(s: Session) {
    require(listOf(s.accountId, s.deviceId, s.token).none { it.isBlank() || it.contains('\n') })
    f.write(listOf(s.accountId, s.deviceId, s.token, s.expiresAtMs.toString()).joinToString("\n"))
  }

  fun clear() = f.delete()
}

/** One device is owned by one account. Survives logout; only an authoritative server-side unlink may change it. */
class SecureDeviceBinding(private val f: EncryptedFile) : DeviceBindingStore {
  override fun boundAccount(): String? = f.read()?.takeIf { it.isNotBlank() }
  override fun bind(accountId: String) = f.write(accountId)
}
