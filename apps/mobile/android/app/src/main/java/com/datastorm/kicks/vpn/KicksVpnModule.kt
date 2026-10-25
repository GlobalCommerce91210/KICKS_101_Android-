package com.datastorm.kicks.vpn

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.VpnService
import android.os.Build
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.datastorm.kicks.BuildConfig

class KicksVpnModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "KicksVpn"

  @ReactMethod
  fun getStatus(promise: Promise) {
    val vpnAuthorized = VpnService.prepare(context) == null
    val notificationPermission = Build.VERSION.SDK_INT < 33 ||
      context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
    val collectorEnabled = BuildConfig.COLLECTOR_ENABLED
    val state = when {
      !collectorEnabled -> "UNAVAILABLE"
      !vpnAuthorized -> "DISCONNECTED"
      !notificationPermission -> "DISCONNECTED"
      else -> "DISCONNECTED" // Never report VERIFIED without a running native forwarding path and backend proof.
    }
    val result = com.facebook.react.bridge.Arguments.createMap().apply {
      putString("state", state)
      putBoolean("vpnAuthorized", vpnAuthorized)
      putBoolean("notificationPermissionGranted", notificationPermission)
      putBoolean("collectorEnabled", collectorEnabled)
      putBoolean("monitoringDefaultOn", false)
      putString("verification", "not_verified")
    }
    promise.resolve(result)
  }

  @ReactMethod
  fun requestAuthorization(promise: Promise) {
    val intent = VpnService.prepare(context)
    if (intent == null) {
      promise.resolve("authorized")
      return
    }
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    context.startActivity(intent)
    promise.resolve("authorization_opened")
  }

  @ReactMethod
  fun start(promise: Promise) {
    if (VpnService.prepare(context) != null) {
      promise.reject("VPN_AUTH_REQUIRED", "Android VPN authorization is required.")
      return
    }
    if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {\n      promise.reject("NOTIFICATION_PERMISSION_REQUIRED", "Notification permission is required so monitoring cannot run invisibly.")\n      return\n    }\n    if (!BuildConfig.COLLECTOR_ENABLED) {
      promise.reject("COLLECTOR_NOT_CONFIGURED", "The beta collector is disabled until a production endpoint and forwarding path are configured.")
      return
    }
    context.startForegroundService(Intent(context, KicksVpnService::class.java).setAction(KicksVpnService.ACTION_START))
    promise.resolve("starting")
  }

  @ReactMethod
  fun stop(promise: Promise) {
    context.startService(Intent(context, KicksVpnService::class.java).setAction(KicksVpnService.ACTION_STOP))
    promise.resolve("stopping")
  }
}
