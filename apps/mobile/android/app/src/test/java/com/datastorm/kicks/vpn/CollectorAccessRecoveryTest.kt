package com.datastorm.kicks.vpn

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class CollectorAccessRecoveryTest {
  private val original = CollectorConfig(
    endpoint = CollectorRuntimeConfig.STAGING_ENDPOINT,
    deviceToken = "original-device-token-with-at-least-32-characters",
    consentId = "11111111-2222-3333-4444-555555555555",
    purpose = CollectorRuntimeConfig.MONITORING_PURPOSE,
    accessClientId = "old.access",
    accessClientSecret = "old-secret-with-at-least-32-characters",
  )

  @Test fun accessRotationPreservesEnrollmentAndPurpose() {
    val updated = original.withAccessCredentials("new.access", "new-secret-with-at-least-32-characters")
    assertEquals(original.endpoint, updated.endpoint)
    assertEquals(original.deviceToken, updated.deviceToken)
    assertEquals(original.consentId, updated.consentId)
    assertEquals(original.purpose, updated.purpose)
    assertEquals("new.access", updated.accessClientId)
    assertEquals("new-secret-with-at-least-32-characters", updated.accessClientSecret)
    assertEquals("old.access", original.accessClientId)
  }

  @Test fun invalidAccessPairDoesNotMutateOriginal() {
    assertThrows(IllegalArgumentException::class.java) { original.withAccessCredentials("not-a-client-id", "new-secret-with-at-least-32-characters") }
    assertThrows(IllegalArgumentException::class.java) { original.withAccessCredentials("new.access", "short") }
    assertEquals("old.access", original.accessClientId)
  }

  @Test fun consent403DistinguishesCloudflareFromUnknownOrigin() {
    assertEquals(
      "Cloudflare Access rejected the consent request (403). Monitoring remains off.",
      consentFailureMessage(403, "access-audience"),
    )
    assertEquals(
      "Consent ledger rejected the request (403). Monitoring remains off.",
      consentFailureMessage(403, null),
    )
  }
}
