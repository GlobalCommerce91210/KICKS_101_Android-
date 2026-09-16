package com.datastorm.kicks.vpn

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.net.VpnService
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.datastorm.kicks.MainActivity
import com.datastorm.kicks.R

class KicksVpnService : VpnService() {
  companion object {
    const val ACTION_START = "com.datastorm.kicks.vpn.START"
    const val ACTION_STOP = "com.datastorm.kicks.vpn.STOP"
    private const val CHANNEL_ID = "kicks_privacy_monitor"
    private const val NOTIFICATION_ID = 731
  }

  override fun onBind(intent: Intent?): IBinder? = super.onBind(intent)

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      stopForeground(STOP_FOREGROUND_REMOVE)
      stopSelf()
      return START_NOT_STICKY
    }
    createChannel()
    val launch = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
    val notification = NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentTitle("KICK'S privacy monitoring")
      .setContentText("Metadata monitoring is active. Tap to review or pause.")
      .setOngoing(true)
      .setContentIntent(launch)
      .build()
    startForeground(NOTIFICATION_ID, notification)

    // No TUN interface is established until the independently owned forwarding
    // and ingestion path is configured. This prevents accidental traffic loss
    // or collection by an incomplete beta build.
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
    return START_NOT_STICKY
  }

  private fun createChannel() {
    val channel = NotificationChannel(CHANNEL_ID, "KICK'S privacy monitoring", NotificationManager.IMPORTANCE_LOW)
    getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
  }
}
