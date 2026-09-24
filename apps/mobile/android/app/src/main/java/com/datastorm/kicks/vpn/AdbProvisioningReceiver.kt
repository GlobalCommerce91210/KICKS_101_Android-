package com.datastorm.kicks.vpn

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.datastorm.kicks.BuildConfig

class AdbProvisioningReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (!BuildConfig.COLLECTOR_PROVISIONING_ENABLED) { resultCode = RESULT_DISABLED; return }
    runCatching {
      when (intent.action) {
        ACTION_PROVISION -> CollectorRuntimeConfig.provision(context,intent.requireValue("deviceToken"),intent.requireValue("consentId"),intent.requireValue("purpose"),intent.requireValue("accessClientId"),intent.requireValue("accessClientSecret"))
        ACTION_UPDATE_ACCESS -> {
          requireAccessRotationOnly(intent.hasExtra("deviceToken"), intent.hasExtra("consentId"), intent.hasExtra("purpose"))
          CollectorRuntimeConfig.updateAccessCredentials(context,intent.requireValue("accessClientId"),intent.requireValue("accessClientSecret"))
        }
        else -> error("Unsupported provisioning action.")
      }
    }.onSuccess { resultCode = RESULT_PROVISIONED; Log.i("KicksProvisioning","collector_credentials_encrypted") }
      .onFailure { resultCode = RESULT_INVALID; Log.e("KicksProvisioning","collector_provisioning_rejected") }
    intent.replaceExtras(null)
  }
  private fun Intent.requireValue(name:String):String=getStringExtra(name)?.takeIf(String::isNotBlank)?:error("Missing provisioning value.")
  companion object { const val ACTION_PROVISION="com.datastorm.kicks.PROVISION_COLLECTOR";const val ACTION_UPDATE_ACCESS="com.datastorm.kicks.UPDATE_ACCESS_CREDENTIALS";private const val RESULT_DISABLED=20;private const val RESULT_INVALID=21;private const val RESULT_PROVISIONED=22 }
}

internal fun requireAccessRotationOnly(
  hasDeviceToken: Boolean,
  hasConsentId: Boolean,
  hasPurpose: Boolean,
) {
  check(!hasDeviceToken && !hasConsentId && !hasPurpose) {
    "Enrollment fields are not accepted for Access credential rotation."
  }
}
