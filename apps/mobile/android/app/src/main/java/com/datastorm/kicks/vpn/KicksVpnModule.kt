package com.datastorm.kicks.vpn

import android.app.Activity
import android.content.Intent
import android.net.VpnService
import com.datastorm.kicks.BuildConfig
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.util.concurrent.Executors

class KicksVpnModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private val bridgeExecutor = Executors.newSingleThreadExecutor()
  private var authorizationPromise: Promise? = null

  private val activityEventListener: ActivityEventListener = object : BaseActivityEventListener() {
    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
      if (requestCode != VPN_AUTH_REQUEST) return
      val pending = authorizationPromise ?: return
      authorizationPromise = null
      pending.resolve(if (resultCode == Activity.RESULT_OK) "authorized" else "denied")
    }
  }

  init {
    context.addActivityEventListener(activityEventListener)
  }

  override fun getName() = "KicksVpn"

  @ReactMethod
  fun requestAuthorization(promise: Promise) {
    val intent = VpnService.prepare(context)
    if (intent == null) {
      promise.resolve("authorized")
      return
    }

    val activity = context.currentActivity
    if (activity == null) {
      promise.reject("ACTIVITY_REQUIRED", "Return to KICK'S and try again.")
      return
    }

    if (authorizationPromise != null) {
      promise.reject("VPN_AUTH_IN_PROGRESS", "Android VPN authorization is already open.")
      return
    }

    authorizationPromise = promise
    activity.startActivityForResult(intent, VPN_AUTH_REQUEST)
  }

  @ReactMethod
  fun isActive(promise: Promise) = promise.resolve(KicksVpnService.isActive)

  @ReactMethod
  fun isProvisioned(promise: Promise) = promise.resolve(CollectorRuntimeConfig.isProvisioned(context))

  @ReactMethod
  fun getEngineSnapshot(promise: Promise) {
    val config = CollectorRuntimeConfig.get(context)
    if (config == null) {
      promise.reject("COLLECTOR_CONFIG_REQUIRED", "This device has not been securely provisioned.")
      return
    }
    bridgeExecutor.execute {
      runCatching { EngineSnapshotClient.fetch(config) }
        .onSuccess { promise.resolve(it) }
        .onFailure { promise.reject("ENGINE_SNAPSHOT_FAILED", it.message ?: "Unable to load the live Engine snapshot.") }
    }
  }

  @ReactMethod
  fun getConsumerState(promise: Promise) {
    val config = CollectorRuntimeConfig.get(context)
    if (config == null) {
      promise.reject("COLLECTOR_CONFIG_REQUIRED", "This device has not been securely provisioned.")
      return
    }
    bridgeExecutor.execute {
      runCatching { EngineSnapshotClient.fetchConsumerState(config) }
        .onSuccess { promise.resolve(it) }
        .onFailure { promise.reject("CONSUMER_STATE_FAILED", it.message ?: "Unable to load your KICK'S account state.") }
    }
  }

  private fun apiCall(promise: Promise, block: (CollectorConfig) -> String) {
    val config = CollectorRuntimeConfig.get(context)
    if (config == null) {
      promise.reject("COLLECTOR_CONFIG_REQUIRED", "This device has not been securely provisioned.")
      return
    }
    bridgeExecutor.execute {
      runCatching { block(config) }
        .onSuccess { promise.resolve(it) }
        .onFailure { promise.reject("CONSUMER_ACTION_FAILED", it.message ?: "The action could not be completed.") }
    }
  }

  @ReactMethod
  fun grantMonitoringConsent(promise: Promise) {
    val config = CollectorRuntimeConfig.get(context)
    if (config == null) {
      promise.reject("COLLECTOR_CONFIG_REQUIRED", "This device has not been securely provisioned.")
      return
    }
    if (KicksVpnService.isActive) {
      promise.reject("MONITORING_ALREADY_ACTIVE", "Stop monitoring before creating a new activation.")
      return
    }
    ActiveMonitoringSession.clearForNewActivation()
    bridgeExecutor.execute {
      runCatching { MonitoringConsentClient.grant(config) }
        .onSuccess { grant ->
          ActiveMonitoringSession.arm(grant.activationId)
          promise.resolve(grant.activationId)
        }
        .onFailure { error ->
          ActiveMonitoringSession.clearForNewActivation()
          promise.reject("CONSENT_GRANT_FAILED", error.message ?: "Unable to create a fresh monitoring consent activation.")
        }
    }
  }

  @ReactMethod
  fun revokeMonitoringConsent(promise: Promise) {
    val config = CollectorRuntimeConfig.get(context)
    val activationId = ActiveMonitoringSession.revokeTarget()
    if (config == null || activationId == null) {
      ActiveMonitoringSession.clearRevoked()
      promise.resolve("no_active_activation")
      return
    }
    bridgeExecutor.execute {
      runCatching { MonitoringConsentClient.revoke(config, activationId) }
        .onSuccess {
          ActiveMonitoringSession.clearRevoked()
          promise.resolve("revoked")
        }
        .onFailure { error ->
          promise.reject("CONSENT_REVOKE_FAILED", error.message ?: "Unable to revoke the monitoring activation.")
        }
    }
  }

  @ReactMethod
  fun acceptOpportunity(id: String, promise: Promise) =
    apiCall(promise) { EngineSnapshotClient.post(it, "/v1/opportunities/$id/accept", "{}", "accept-$id") }

  @ReactMethod
  fun deliverOpportunity(id: String, promise: Promise) =
    apiCall(promise) { EngineSnapshotClient.post(it, "/v1/opportunities/$id/deliver") }

  @ReactMethod
  fun revokeCommercialPermission(id: String, promise: Promise) =
    apiCall(promise) { EngineSnapshotClient.post(it, "/v1/permissions/$id/revoke", "{}", "revoke-$id") }

  @ReactMethod
  fun submitFeedback(body: String, promise: Promise) =
    apiCall(promise) { EngineSnapshotClient.post(it, "/v1/feedback", body) }

  @ReactMethod
  fun submitAppeal(body: String, promise: Promise) =
    apiCall(promise) { EngineSnapshotClient.post(it, "/v1/appeals", body) }

  @ReactMethod
  fun getValueReceipt(id: String, promise: Promise) =
    apiCall(promise) { EngineSnapshotClient.getReceipt(it, id) }

  @ReactMethod
  fun start(promise: Promise) {
    if (VpnService.prepare(context) != null) {
      promise.reject("VPN_AUTH_REQUIRED", "Android VPN authorization is required.")
      return
    }
    if (!BuildConfig.COLLECTOR_ENABLED) {
      promise.reject("COLLECTOR_NOT_CONFIGURED", "The collector is disabled in this build.")
      return
    }
    if (!CollectorRuntimeConfig.isProvisioned(context)) {
      promise.reject("COLLECTOR_CONFIG_REQUIRED", "This device has not been securely provisioned.")
      return
    }
    if (ActiveMonitoringSession.current() == null) {
      promise.reject("FRESH_CONSENT_REQUIRED", "Fresh KICK'S monitoring consent is required before every activation.")
      return
    }
    context.startForegroundService(Intent(context, KicksVpnService::class.java).setAction(KicksVpnService.ACTION_START))
    promise.resolve("starting")
  }

  @ReactMethod
  fun stop(promise: Promise) {
    context.startService(Intent(context, KicksVpnService::class.java).setAction(KicksVpnService.ACTION_STOP))
    ActiveMonitoringSession.markStopped()
    CollectorRuntimeConfig.clearRuntime()
    promise.resolve("stopping")
  }

  override fun invalidate() {
    authorizationPromise?.reject("MODULE_INVALIDATED", "KICK'S closed before Android authorization completed.")
    authorizationPromise = null
    context.removeActivityEventListener(activityEventListener)
    bridgeExecutor.shutdownNow()
    super.invalidate()
  }

  companion object {
    private const val VPN_AUTH_REQUEST = 4317
  }
}