package com.datastorm.kicks.vpn

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.VpnService
import android.os.Build
import android.os.IBinder
import android.os.ParcelFileDescriptor
import androidx.core.app.NotificationCompat
import com.datastorm.kicks.MainActivity
import com.datastorm.kicks.R
import com.datastorm.kicks.vpn.core.Decision
import com.datastorm.kicks.vpn.core.DnsPacket
import com.datastorm.kicks.vpn.core.Reason
import com.datastorm.kicks.vpn.core.State
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.Inet4Address
import java.net.InetAddress
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.ExecutorService
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.atomic.AtomicBoolean

/**
 * DNS-metadata forwarder. The tunnel only owns a virtual DNS address (a single /32 route), so ALL other
 * traffic keeps using the normal network and connectivity is preserved by construction. DNS queries are
 * forwarded unmodified to the real resolver through a protect()ed socket; only the queried host name,
 * a size bucket and a timestamp are ever turned into an observation. If anything about authorization or
 * the tunnel fails, the tunnel is closed and the OS falls back to the network's own resolver.
 */
class KicksVpnService : VpnService() {
  companion object {
    const val ACTION_START = "com.datastorm.kicks.vpn.START"
    const val ACTION_STOP = "com.datastorm.kicks.vpn.STOP"
    private const val CHANNEL_ID = "kicks_privacy_monitor"
    private const val NOTIFICATION_ID = 731
    private const val CLIENT_ADDRESS = "10.111.222.1"
    private const val VIRTUAL_DNS = "10.111.222.2"
    private const val UPSTREAM_TIMEOUT_MS = 4_000
  }

  private val closing = AtomicBoolean(false)
  private val started = AtomicBoolean(false)
  @Volatile private var running = false
  @Volatile private var tun: ParcelFileDescriptor? = null
  @Volatile private var upstream: InetAddress? = null
  @Volatile private var upstreamNetwork: Network? = null
  private var reader: Thread? = null
  private var callback: ConnectivityManager.NetworkCallback? = null
  private val sockets: MutableSet<DatagramSocket> = ConcurrentHashMap.newKeySet()
  private val control: ExecutorService = Executors.newSingleThreadExecutor { Thread(it, "kicks-control") }
  private val resolvers: ExecutorService = Executors.newFixedThreadPool(4) { Thread(it, "kicks-dns").apply { isDaemon = true } }
  private val components by lazy { CollectorRuntime.get(this) }

  override fun onBind(intent: Intent?): IBinder? = super.onBind(intent)

  override fun onCreate() {
    super.onCreate()
    CollectorRuntime.service = this
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      components.controller.explicitStop()
      shutdown()
      return START_NOT_STICKY
    }
    createChannel()
    startForegroundCompat(notification("Checking authorization before monitoring starts."))
    // Never auto-start from a system restart or a stray intent: only an explicit, gated start proceeds.
    if (intent?.action != ACTION_START || !started.compareAndSet(false, true)) {
      if (intent?.action != ACTION_START) shutdown()
      return START_NOT_STICKY
    }
    control.execute {
      val decision = components.controller.start { establish() }
      if (decision is Decision.Allow) {
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification("Metadata monitoring is active. Tap to review or pause."))
      } else {
        shutdown()
      }
    }
    return START_NOT_STICKY
  }

  /** The OS revoked VPN authorization (another VPN took over or the user removed it): stop at once. */
  override fun onRevoke() {
    components.controller.stop(Reason.OS_VPN_NOT_AUTHORIZED)
    shutdown()
    super.onRevoke()
  }

  override fun onDestroy() {
    components.controller.stop(Reason.SERVICE_STOPPED)
    teardown()
    CollectorRuntime.service = null
    super.onDestroy()
  }

  private fun establish(): Boolean {
    val cm = getSystemService(ConnectivityManager::class.java)
    if (!refreshUpstream(cm)) { components.controller.stop(Reason.NO_UPSTREAM_DNS); return false }
    val pfd = Builder()
      .setSession("KICK'S privacy monitoring")
      .addAddress(CLIENT_ADDRESS, 32)
      .addDnsServer(VIRTUAL_DNS)
      .addRoute(VIRTUAL_DNS, 32)
      .setMtu(1500)
      .setBlocking(true)
      .establish() ?: return false
    tun = pfd
    running = true
    val request = NetworkRequest.Builder()
      .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
      .addCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN)
      .build()
    val cb = object : ConnectivityManager.NetworkCallback() {
      override fun onAvailable(network: Network) = networkChanged(cm)
      override fun onLinkPropertiesChanged(network: Network, lp: android.net.LinkProperties) = networkChanged(cm)
      override fun onLost(network: Network) = networkChanged(cm)
    }
    callback = cb
    cm.registerNetworkCallback(request, cb)
    reader = Thread({ readLoop(pfd) }, "kicks-tun").also { it.start() }
    return true
  }

  /** Network-change recovery: re-pick the resolver, then re-run the authorization gate (RESUME). */
  private fun networkChanged(cm: ConnectivityManager) {
    if (!running) return
    refreshUpstream(cm)
    try { control.execute { if (running) components.controller.resume() } } catch (e: RejectedExecutionException) { }
  }

  private fun refreshUpstream(cm: ConnectivityManager): Boolean {
    val candidates = listOfNotNull(cm.activeNetwork) + cm.allNetworks
    for (n in candidates) {
      val caps = cm.getNetworkCapabilities(n) ?: continue
      if (caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN) || !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) continue
      val dns = cm.getLinkProperties(n)?.dnsServers?.filter { it.hostAddress != VIRTUAL_DNS } ?: continue
      val pick = dns.firstOrNull { it is Inet4Address } ?: dns.firstOrNull() ?: continue
      upstream = pick; upstreamNetwork = n
      return true
    }
    upstream = null; upstreamNetwork = null
    return false
  }

  private fun readLoop(pfd: ParcelFileDescriptor) {
    val input = FileInputStream(pfd.fileDescriptor)
    val output = FileOutputStream(pfd.fileDescriptor)
    val buf = ByteArray(32767)
    try {
      while (running) {
        val n = input.read(buf)
        if (n < 0) break
        if (n == 0) continue
        val q = DnsPacket.parse(buf, n) ?: continue // anything that is not a DNS question is dropped
        try { resolvers.execute { resolve(q, output) } } catch (e: RejectedExecutionException) { break }
      }
    } catch (e: Exception) {
      if (running) components.controller.stop(Reason.TUNNEL_FAILED)
    }
  }

  private fun resolve(q: com.datastorm.kicks.vpn.core.DnsQuery, output: FileOutputStream) {
    val target = upstream ?: return
    val socket = DatagramSocket()
    sockets.add(socket)
    try {
      protect(socket)
      upstreamNetwork?.bindSocket(socket)
      socket.soTimeout = UPSTREAM_TIMEOUT_MS
      socket.send(DatagramPacket(q.payload, q.payload.size, target, 53))
      val rbuf = ByteArray(4096)
      val reply = DatagramPacket(rbuf, rbuf.size)
      socket.receive(reply)
      val response = rbuf.copyOf(reply.length)
      synchronized(output) { output.write(DnsPacket.buildResponse(q, response)) }
      // Recorded after the answer is delivered so authorization lookups never delay DNS.
      components.controller.onDns(q.qname, q.payload.size + response.size)
    } catch (e: Exception) {
      // timeout/IO: the app retries on its own; nothing is recorded
    } finally {
      sockets.remove(socket); socket.close()
    }
  }

  /** Idempotent, deterministic teardown on its own thread (callers may be the worker or main thread). */
  fun shutdown() {
    Thread({ teardown() }, "kicks-shutdown").start()
  }

  private fun teardown() {
    if (!closing.compareAndSet(false, true)) return
    running = false
    callback?.let { try { getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(it) } catch (e: Exception) { } }
    callback = null
    try { tun?.close() } catch (e: Exception) { }
    tun = null
    resolvers.shutdownNow()
    control.shutdownNow()
    sockets.forEach { try { it.close() } catch (e: Exception) { } }
    sockets.clear()
    reader?.let { if (it !== Thread.currentThread()) it.join(2_000) }
    components.controller.awaitShutdown(2_000)
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  private fun startForegroundCompat(n: Notification) {
    if (Build.VERSION.SDK_INT >= 34) startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    else startForeground(NOTIFICATION_ID, n)
  }

  private fun notification(text: String): Notification {
    val launch = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentTitle("KICK'S privacy monitoring")
      .setContentText(text)
      .setOngoing(true)
      .setContentIntent(launch)
      .build()
  }

  private fun createChannel() {
    val channel = NotificationChannel(CHANNEL_ID, "KICK'S privacy monitoring", NotificationManager.IMPORTANCE_LOW)
    getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
  }
}
