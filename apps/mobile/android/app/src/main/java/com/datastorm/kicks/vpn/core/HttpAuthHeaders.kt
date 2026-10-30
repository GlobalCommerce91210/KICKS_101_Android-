package com.datastorm.kicks.vpn.core

internal const val DEVICE_ID_HEADER = "X-Kicks-Device"

/**
 * The Android collector auth contract binds the bearer session to one enrolled device.
 * Keep this shared so eligibility and metadata upload cannot drift apart.
 */
internal fun sessionHeaders(session: Session): Map<String, String> = mapOf(
  "Authorization" to "Bearer ${session.token}",
  DEVICE_ID_HEADER to session.deviceId
)
