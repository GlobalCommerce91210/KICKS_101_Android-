package com.datastorm.kicks.vpn

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.net.VpnService
import android.os.IBinder
import android.os.ParcelFileDescriptor
import android.util.Log
import androidx.core.app.NotificationCompat
import com.datastorm.kicks.MainActivity
import com.datastorm.kicks.R
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

class KicksVpnService : VpnService() {
  companion object {
    const val ACTION_START = "com.datastorm.kicks.vpn.START"
    const val ACTION_STOP = "com.datastorm.kicks.vpn.STOP"
    private const val CHANNEL_ID = "kicks_privacy_monitor"
    private const val NOTIFICATION_ID = 731
    @Volatile var isActive = false
      private set
  }

  private var tun: ParcelFileDescriptor? = null
  @Volatile private var running = false
  private val worker = Executors.newSingleThreadExecutor()
  private val uploader = Executors.newSingleThreadScheduledExecutor()
  private val lifecycleScheduler = Executors.newSingleThreadScheduledExecutor()
  private val drainScheduled = AtomicBoolean(false)
  private lateinit var uploadQueue: DurableUploadQueue
  private lateinit var sessionJournal: CollectorSessionJournal
  private var heartbeatTask: ScheduledFuture<*>? = null
  private var currentSessionId: String? = null
  private var currentConfig: CollectorConfig? = null
  private var currentActivationId: String? = null

  override fun onCreate() {
    super.onCreate()
    uploadQueue = DurableUploadQueue(this)
    sessionJournal = CollectorSessionJournal(this)
  }

  override fun onBind(intent: Intent?): IBinder? = super.onBind(intent)

  @Synchronized override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      shutdown(true, "session_stopped", "monitoring_stopped_by_user")
      return START_NOT_STICKY
    }
    if (running) return START_STICKY

    val config = CollectorRuntimeConfig.get(this) ?: run {
      Log.w("KicksCollector", "collector_start_rejected reason=not_provisioned")
      stopSelf(startId); return START_NOT_STICKY
    }
    val activationId = ActiveMonitoringSession.current() ?: run {
      Log.w("KicksCollector", "collector_start_rejected reason=fresh_consent_required")
      stopSelf(startId); return START_NOT_STICKY
    }

    createChannel()
    val launch = PendingIntent.getActivity(this,0,Intent(this,MainActivity::class.java),PendingIntent.FLAG_IMMUTABLE)
    startForeground(NOTIFICATION_ID, NotificationCompat.Builder(this,CHANNEL_ID)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentTitle("KICK'S metadata monitoring")
      .setContentText("Consent-linked destination metadata only")
      .setOngoing(true).setContentIntent(launch).build())

    tun = Builder().setSession("KICK'S metadata monitor").setMtu(1500).addAddress("10.111.0.1",32).addDnsServer("10.111.0.2").addRoute("10.111.0.2",32).setBlocking(true).establish()
    if (tun == null) {
      Log.e("KicksCollector","collector_start_failed reason=vpn_establish_returned_null")
      shutdown(true,null,null); return START_NOT_STICKY
    }

    running = true; isActive = true; currentConfig = config; currentActivationId = activationId
    val session = sessionJournal.begin(); currentSessionId = session.sessionId
    try {
      session.crashEvent?.let(::enqueueLifecycle)
      enqueueLifecycle(session.startedEvent)
    } catch (error: QueueCapacityException) {
      sessionJournal.markFailure(session.sessionId,"durable_queue_capacity_reached")
      shutdown(true,null,null); return START_NOT_STICKY
    }
    scheduleDrain(config)
    heartbeatTask = lifecycleScheduler.scheduleAtFixedRate({ recordHeartbeat(config) },5,5,TimeUnit.MINUTES)
    worker.execute { loop(config, activationId) }
    Log.i("KicksCollector","collector_started session=${session.sessionId} activation=$activationId")
    return START_NOT_STICKY
  }

  private fun loop(config: CollectorConfig, activationId: String) {
    val descriptor = tun?.fileDescriptor ?: return
    val input = FileInputStream(descriptor)
    val output = FileOutputStream(descriptor)
    val buffer = ByteArray(32767)
    var consecutiveFailures = 0
    while (running && currentActivationId == activationId && !Thread.currentThread().isInterrupted) {
      try {
        val length = input.read(buffer)
        if (length <= 0) continue
        val query = DnsPacketCodec.parse(buffer,length) ?: continue
        val app = AppAttributionResolver.resolve(this,query)
        DatagramSocket().use { socket ->
          if (!protect(socket)) return@use
          socket.soTimeout = 5000
          socket.send(DatagramPacket(query.payload,query.payload.size,InetAddress.getByName("1.1.1.1"),53))
          val replyBytes = ByteArray(4096)
          val reply = DatagramPacket(replyBytes,replyBytes.size)
          socket.receive(reply)
          output.write(DnsPacketCodec.response(query,replyBytes.copyOf(reply.length)))
          submitMetadata(config,activationId,query.hostname,app)
          consecutiveFailures = 0
        }
      } catch (error: Exception) {
        if (!running || Thread.currentThread().isInterrupted) break
        consecutiveFailures += 1
        Log.e("KicksCollector","collector_loop_error",error)
        if (consecutiveFailures >= 5) {
          currentSessionId?.let { sessionJournal.markFailure(it,"collector_transport_failed_five_times") }
          ActiveMonitoringSession.markStopped()
          shutdown(true,null,null); break
        }
        try { Thread.sleep(250) } catch (_: InterruptedException) { Thread.currentThread().interrupt(); break }
      }
    }
  }

  private fun submitMetadata(config:CollectorConfig,activationId:String,hostname:String,app:AppAttribution){
    try {
      uploadQueue.append(MetadataUploader.metadata(config,activationId,hostname,app))
      scheduleDrain(config)
    } catch (error:QueueCapacityException) {
      currentSessionId?.let{sessionJournal.markFailure(it,"durable_queue_capacity_reached")}
      ActiveMonitoringSession.markStopped()
      shutdown(true,null,null)
    }
  }

  private fun enqueueLifecycle(event:CollectionLifecycleEvent){ uploadQueue.append(MetadataUploader.lifecycle(event)) }
  private fun recordHeartbeat(config:CollectorConfig){if(!running)return;val sessionId=currentSessionId?:return;try{sessionJournal.heartbeat(sessionId)?.let(::enqueueLifecycle);scheduleDrain(config)}catch(error:QueueCapacityException){sessionJournal.markFailure(sessionId,"durable_queue_capacity_reached");ActiveMonitoringSession.markStopped();shutdown(true,null,null)}}
  private fun scheduleDrain(config:CollectorConfig,delaySeconds:Long=0){if(!drainScheduled.compareAndSet(false,true))return;try{uploader.schedule({drain(config)},delaySeconds,TimeUnit.SECONDS)}catch(error:RejectedExecutionException){drainScheduled.set(false);if(running)Log.e("KicksCollector","metadata_upload_rejected",error)}}
  private fun drain(config:CollectorConfig){var retry=false;try{while(!Thread.currentThread().isInterrupted){val upload=uploadQueue.peek()?:break;MetadataUploader.upload(config,upload);uploadQueue.acknowledge(upload.id)}}catch(error:Exception){retry=true;Log.e("KicksCollector","durable_upload_deferred pending_bytes=${uploadQueue.pendingBytes()}",error)}finally{drainScheduled.set(false);if(running&&uploadQueue.hasPending())scheduleDrain(config,if(retry)15 else 0)}}

  @Synchronized private fun shutdown(requestStop:Boolean,lifecycleEvent:String?,reason:String?){
    val wasActive=running||tun!=null
    heartbeatTask?.cancel(false);heartbeatTask=null
    val sessionId=currentSessionId;val config=currentConfig
    if(lifecycleEvent!=null&&reason!=null&&sessionId!=null){runCatching{sessionJournal.end(sessionId,lifecycleEvent,reason)?.let(::enqueueLifecycle);if(config!=null)scheduleDrain(config)}.onFailure{sessionJournal.markUnclean(sessionId,"stop_event_could_not_be_durably_queued")}}
    currentSessionId=null;currentActivationId=null;running=false;isActive=false
    runCatching{tun?.close()};tun=null
    CollectorRuntimeConfig.clearRuntime();AppAttributionResolver.clearCache()
    stopForeground(STOP_FOREGROUND_REMOVE);if(requestStop)stopSelf();if(wasActive)Log.i("KicksCollector","collector_stopped")
  }

  override fun onRevoke(){ActiveMonitoringSession.markStopped();shutdown(true,"vpn_revoked","android_vpn_permission_revoked");super.onRevoke()}
  override fun onDestroy(){currentSessionId?.let{sessionJournal.markFailure(it,"collector_service_destroyed_without_clean_stop")};ActiveMonitoringSession.markStopped();shutdown(false,null,null);worker.shutdownNow();uploader.shutdownNow();lifecycleScheduler.shutdownNow();super.onDestroy()}
  private fun createChannel(){getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel(CHANNEL_ID,"KICK'S privacy monitoring",NotificationManager.IMPORTANCE_LOW))}
}
