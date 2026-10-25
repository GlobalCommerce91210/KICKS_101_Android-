package com.datastorm.kicks.vpn

/**
 * Process-local authorization latch. It is intentionally not persisted:
 * after process death or a later OFF -> ON transition KICK'S must obtain
 * fresh consumer consent before the collector can start again.
 */
object ActiveMonitoringSession {
  @Volatile private var activeActivationId: String? = null
  @Volatile private var revokeCandidateId: String? = null

  @Synchronized fun arm(activationId: String) {
    require(activationId.matches(Regex("^[0-9a-fA-F-]{36}$"))) { "A valid activation identifier is required." }
    activeActivationId = activationId
    revokeCandidateId = activationId
  }

  fun current(): String? = activeActivationId

  @Synchronized fun markStopped(): String? {
    val previous = activeActivationId
    activeActivationId = null
    if (previous != null) revokeCandidateId = previous
    return previous
  }

  fun revokeTarget(): String? = activeActivationId ?: revokeCandidateId

  @Synchronized fun clearRevoked() {
    activeActivationId = null
    revokeCandidateId = null
  }

  @Synchronized fun clearForNewActivation() {
    activeActivationId = null
    revokeCandidateId = null
  }
}
