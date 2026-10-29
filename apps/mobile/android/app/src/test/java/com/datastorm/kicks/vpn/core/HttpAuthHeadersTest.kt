package com.datastorm.kicks.vpn.core

import org.junit.Assert.assertEquals
import org.junit.Test

class HttpAuthHeadersTest {
  @Test fun uploadAuthIncludesBearerAndDeviceContext() {
    val session = Session(
      accountId = "account-1",
      deviceId = "device-1",
      token = "token-1",
      expiresAtMs = Long.MAX_VALUE
    )

    assertEquals(
      mapOf(
        "Authorization" to "Bearer token-1",
        DEVICE_ID_HEADER to "device-1"
      ),
      sessionHeaders(session)
    )
  }
}
