package com.datastorm.kicks.vpn

import android.content.Intent
import android.net.VpnService
import com.datastorm.kicks.BuildConfig
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.util.concurrent.Executors

class KicksVpnModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private val bridgeExecutor = Executors.newSingleThreadExecutor()
  override fun getName() = "KicksVpn"

  @ReactMethod fun requestAuthorization(promise: Promise) {
    val intent = VpnService.prepare(context)
    if (intent == null) { promise.resolve("authorized"); return }
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    context.startActivity(intent)
    promise.resolve("authorization_opened")
  }

  @ReactMethod fun isActive(promise: Promise) = promise.resolve(KicksVpnService.isActive)
  @ReactMethod fun isProvisioned(promise: Promise) = promise.resolve(CollectorRuntimeConfig.isProvisioned(context))

  @ReactMethod fun getEngineSnapshot(promise: Promise) {
    val config = CollectorRuntimeConfig.get(context)
    if (config == null) { promise.reject("COLLECTOR_CONFIG_REQUIRED", "This device has not been securely provisioned."); return }
    bridgeExecutor.execute {
      runCatching { EngineSnapshotClient.fetch(config) }
        .onSuccess { promise.resolve(it) }
        .onFailure { promise.reject("ENGINE_SNAPSHOT_FAILED", it.message ?: "Unable to load the live Engine snapshot.") }
    }
  }

  @ReactMethod fun grantMonitoringConsent(promise: Promise) {
    val config = CollectorRuntimeConfig.get(context)
    if (config == null) { promise.reject("COLLECTOR_CONFIG_REQUIRED", "This device has not been securely provisioned."); return }
    if (KicksVpnService.isActive) { promise.reject("MONITORING_ALREADY_ACTIVE", "Stop monitoring before creating a new activation."); return }
    ActiveMonitoringSession.clearForNewActivation()
    bridgeExecutor.execute {
      runCatching { MonitoringConsentClient.grant(config) }
        .onSuccess { grant -> ActiveMonitoringSession.arm(grant.activationId); promise.resolve(grant.activationId) }
        .onFailure { error -> ActiveMonitoringSession.clearForNewActivation(); promise.reject("CONSENT_GRANT_FAILED", error.message ?: "Unable to create a fresh monitoring consent activation.") }
    }
  }

  @ReactMethod fun revokeMonitoringConsent(promise: Promise) {
    val config = CollectorRuntimeConfig.get(context)
    val activationId = ActiveMonitoringSession.revokeTarget()
    if (config == null || activationId == null) { ActiveMonitoringSession.clearRevoked(); promise.resolve("no_active_activation"); return }
    bridgeExecutor.execute {
      runCatching { MonitoringConsentClient.revoke(config, activationId) }
        .onSuccess { ActiveMonitoringSession.clearRevoked(); promise.resolve("revoked") }
        .onFailure { error -> promise.reject("CONSENT_REVOKE_FAILED", error.message ?: "Unable to revoke the monitoring activation.") }
    }
  }

  @ReactMethod fun start(promise: Promise) {
    if (VpnService.prepare(context) != null) { promise.reject("VPN_AUTH_REQUIRED", "Android VPN authorization is required."); return }
    if (!BuildConfig.COLLECTOR_ENABLED) { promise.reject("COLLECTOR_NOT_CONFIGURED", "The collector is disabled in this build."); return }
    if (!CollectorRuntimeConfig.isProvisioned(context)) { promise.reject("COLLECTOR_CONFIG_REQUIRED", "This device has not been securely provisioned."); return }
    if (ActiveMonitoringSession.current() == null) { promise.reject("FRESH_CONSENT_REQUIRED", "Fresh KICK'S monitoring consent is required before every activation."); return }
    context.startForegroundService(Intent(context, KicksVpnService::class.java).setAction(KicksVpnService.ACTION_START))
    promise.resolve("starting")
  }

  @ReactMethod fun stop(promise: Promise) {
    context.startService(Intent(context, KicksVpnService::class.java).setAction(KicksVpnService.ACTION_STOP))
    ActiveMonitoringSession.markStopped()
    CollectorRuntimeConfig.clearRuntime()
    promise.resolve("stopping")
  }

  override fun invalidate() { bridgeExecutor.shutdownNow(); super.invalidate() }
}
