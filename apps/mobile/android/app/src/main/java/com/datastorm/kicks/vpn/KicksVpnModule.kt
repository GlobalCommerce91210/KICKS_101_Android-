package com.datastorm.kicks.vpn

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.VpnService
import android.os.Build
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets
import java.util.concurrent.Executors
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.datastorm.kicks.BuildConfig

class KicksVpnModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private val verificationExecutor = Executors.newSingleThreadExecutor()
  @Volatile private var backendEligibilityVerified = false
  override fun getName() = "KicksVpn"

  @ReactMethod
  fun verifyBackendEligibility(apiBaseUrl: String, deviceToken: String, permissionId: String, purpose: String, activationRequested: Boolean, promise: Promise) {
    if (apiBaseUrl.isBlank() || deviceToken.isBlank() || permissionId.isBlank() || purpose.isBlank() || !activationRequested) {
      promise.resolve(com.facebook.react.bridge.Arguments.createMap().apply {
        putBoolean("eligible", false)
        putString("reason", "missing_explicit_activation_or_identity")
      })
      return
    }
    val base = try { URL(apiBaseUrl) } catch (_: Exception) {
      promise.resolve(com.facebook.react.bridge.Arguments.createMap().apply {
        putBoolean("eligible", false)
        putString("reason", "invalid_api_url")
      })
      return
    }
    if (base.protocol != "https" && !BuildConfig.DEBUG) {
      promise.resolve(com.facebook.react.bridge.Arguments.createMap().apply {
        putBoolean("eligible", false)
        putString("reason", "https_required")
      })
      return
    }
    verificationExecutor.execute {
      var connection: HttpURLConnection? = null
      try {
        connection = URL(base.toString().trimEnd('/') + "/v1/collector/eligibility").openConnection() as HttpURLConnection
        connection.requestMethod = "POST"
        connection.connectTimeout = 5000
        connection.readTimeout = 5000
        connection.doOutput = true
        connection.setRequestProperty("Authorization", "Bearer $deviceToken")
        connection.setRequestProperty("Content-Type", "application/json")
        val body = JSONObject().apply {
          put("permissionId", permissionId)
          put("purpose", purpose)
          put("activationRequested", true)
        }.toString()
        connection.outputStream.use { it.write(body.toByteArray(StandardCharsets.UTF_8)) }
        val statusCode = connection.responseCode
        val stream = if (statusCode in 200..299) connection.inputStream else connection.errorStream
        val response = stream?.bufferedReader(StandardCharsets.UTF_8)?.use { it.readText() } ?: "{}"
        val backendEligible = statusCode == 200 && JSONObject(response).optBoolean("eligible", false)
        val vpnAuthorized = VpnService.prepare(context) == null
        val notificationsGranted = Build.VERSION.SDK_INT < 33 ||
          context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        val eligible = backendEligible && vpnAuthorized && notificationsGranted && BuildConfig.COLLECTOR_ENABLED
        backendEligibilityVerified = eligible
        val reason = when {
          !backendEligible -> "backend_consent_or_device_verification_failed"
          !vpnAuthorized -> "vpn_authorization_required"
          !notificationsGranted -> "notification_permission_required"
          !BuildConfig.COLLECTOR_ENABLED -> "native_collector_unavailable"
          else -> "eligible"
        }
        promise.resolve(com.facebook.react.bridge.Arguments.createMap().apply {
          putBoolean("eligible", eligible)
          putBoolean("backendEligible", backendEligible)
          putBoolean("vpnAuthorized", vpnAuthorized)
          putBoolean("notificationPermissionGranted", notificationsGranted)
          putBoolean("collectorEnabled", BuildConfig.COLLECTOR_ENABLED)
          putString("reason", reason)
        })
      } catch (_: Exception) {
        promise.resolve(com.facebook.react.bridge.Arguments.createMap().apply {
          putBoolean("eligible", false)
          putString("reason", "backend_verification_unavailable")
        })
      } finally {
        connection?.disconnect()
      }
    }
  }

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
    if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
      promise.reject("NOTIFICATION_PERMISSION_REQUIRED", "Notification permission is required so monitoring cannot run invisibly.")
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
