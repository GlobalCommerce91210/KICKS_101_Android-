package com.datastorm.kicks.vpn

import android.content.Context
import android.net.VpnService
import androidx.core.app.NotificationManagerCompat
import com.datastorm.kicks.BuildConfig
import com.datastorm.kicks.vpn.core.AuthorizationGate
import com.datastorm.kicks.vpn.core.BoundedQueue
import com.datastorm.kicks.vpn.core.Clock
import com.datastorm.kicks.vpn.core.CollectorController
import com.datastorm.kicks.vpn.core.OsAuthorization
import java.io.File
import java.util.UUID

class AndroidOsAuthorization(private val context: Context) : OsAuthorization {
  override fun vpnAuthorized() = VpnService.prepare(context) == null
  override fun notificationsAllowed() = NotificationManagerCompat.from(context).areNotificationsEnabled()
}

/** Process-wide wiring shared by the React Native module and the VpnService. */
class CollectorComponents(context: Context) {
  private val dir: File = context.noBackupFilesDir
  private val cipher = KeystoreCipher("kicks_collector_v1")
  val sessions = SecureSessionStore(EncryptedFile(File(dir, "session.bin"), cipher))
  val binding = SecureDeviceBinding(EncryptedFile(File(dir, "device-owner.bin"), cipher))
  private val baseUrl = BuildConfig.COLLECTOR_API_BASE_URL
  val configured = BuildConfig.COLLECTOR_ENABLED && baseUrl.startsWith("https://")
  val os = AndroidOsAuthorization(context)
  val gate = AuthorizationGate(
    collectorEnabled = BuildConfig.COLLECTOR_ENABLED,
    sessions = sessions,
    os = os,
    authority = if (configured) HttpAuthorityClient(baseUrl) else null,
    binding = binding,
    clock = Clock { System.currentTimeMillis() }
  )
  val controller = CollectorController(
    gate,
    BoundedQueue(store = EncryptedQueueStore(EncryptedFile(File(dir, "queue.bin"), cipher)), newId = { UUID.randomUUID().toString() }),
    HttpBatchUploader(baseUrl),
    Clock { System.currentTimeMillis() }
  )

  init { controller.onStopped = { CollectorRuntime.service?.shutdown() } }
}

object CollectorRuntime {
  @Volatile var service: KicksVpnService? = null
  @Volatile private var instance: CollectorComponents? = null

  fun get(context: Context): CollectorComponents =
    instance ?: synchronized(this) { instance ?: CollectorComponents(context.applicationContext).also { instance = it } }
}
