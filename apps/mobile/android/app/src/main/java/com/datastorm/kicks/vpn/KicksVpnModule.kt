package com.datastorm.kicks.vpn

import android.content.Intent
import android.net.VpnService
import com.datastorm.kicks.vpn.core.Reason
import com.datastorm.kicks.vpn.core.Session
import com.datastorm.kicks.vpn.core.State
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class KicksVpnModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private val components get() = CollectorRuntime.get(context)

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

  /**
   * Explicit user activation. Resolves "starting" only; the UI must poll [getStatus] and treat
   * collection as on only when the native state is "active".
   */
  @ReactMethod
  fun start(promise: Promise) {
    val c = components
    if (!c.configured) {
      promise.reject("COLLECTOR_NOT_CONFIGURED", "The collector is disabled until the build enables it and an https collector endpoint is configured.")
      return
    }
    if (VpnService.prepare(context) != null) {
      promise.reject("VPN_AUTH_REQUIRED", "Android VPN authorization is required.")
      return
    }
    if (c.sessions.current() == null) {
      promise.reject("NO_SESSION", "Sign in and connect this device before starting monitoring.")
      return
    }
    if (c.controller.state == State.ACTIVE || c.controller.state == State.STARTING) {
      promise.resolve("starting")
      return
    }
    c.gate.activate()
    try {
      context.startForegroundService(Intent(context, KicksVpnService::class.java).setAction(KicksVpnService.ACTION_START))
    } catch (e: Exception) {
      c.gate.deactivate()
      promise.reject("SERVICE_START_FAILED", "Android refused to start the monitoring service.")
      return
    }
    promise.resolve("starting")
  }

  @ReactMethod
  fun stop(promise: Promise) {
    components.controller.explicitStop()
    promise.resolve("stopped")
  }

  @ReactMethod
  fun getStatus(promise: Promise) {
    val c = components
    val s = c.controller.status()
    val map = Arguments.createMap()
    map.putString("state", s.state.name.lowercase())
    if (s.reason != null) map.putString("reason", s.reason.name) else map.putNull("reason")
    map.putInt("queued", s.queued)
    map.putDouble("dropped", s.dropped.toDouble())
    map.putBoolean("collectorConfigured", c.configured)
    map.putBoolean("sessionPresent", c.sessions.current() != null)
    map.putBoolean("vpnAuthorized", c.os.vpnAuthorized())
    promise.resolve(map)
  }

  /** Called by the identity-provider integration after sign-in (token lives in Keystore-encrypted storage). */
  @ReactMethod
  fun setSession(accountId: String, deviceId: String, token: String, expiresAtMs: Double, promise: Promise) {
    val c = components
    val bound = c.binding.boundAccount()
    if (bound != null && bound != accountId) {
      promise.reject("DEVICE_OWNED_BY_OTHER_ACCOUNT", "This device is already linked to a different account. Sign in with the original account or unlink the device first.")
      return
    }
    try {
      val current = c.sessions.current()
      if (current != null && current.accountId != accountId) c.controller.stop(Reason.CROSS_ACCOUNT_REJECTED)
      c.sessions.save(Session(accountId, deviceId, token, expiresAtMs.toLong()))
      c.gate.invalidate()
      promise.resolve("saved")
    } catch (e: IllegalArgumentException) {
      promise.reject("INVALID_SESSION", "Session values are invalid.")
    }
  }

  /** Logout / remote revocation handling: removes credentials and stops + purges immediately. */
  @ReactMethod
  fun clearSession(promise: Promise) {
    components.sessions.clear()
    components.controller.stop(Reason.NO_SESSION)
    promise.resolve("cleared")
  }
}
