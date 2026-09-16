package com.datastorm.kicks.vpn

import android.content.Intent
import android.net.VpnService
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.datastorm.kicks.BuildConfig

class KicksVpnModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "KicksVpn"

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
    if (!BuildConfig.COLLECTOR_ENABLED) {
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
