package com.datastorm.kicks.vpn.core

import org.junit.Assert.*
import org.junit.Test

class AuthorizationAtStartTest {
  private fun denied(h: Harness, reason: Reason) {
    val d = h.startOk()
    assertEquals(Decision.Deny(reason), d)
    assertEquals(State.STOPPED, h.controller.state)
    assertEquals(reason, h.controller.reason)
  }

  @Test fun disabledByDefaultBuildFlag() = denied(Harness(enabled = false), Reason.COLLECTOR_DISABLED)
  @Test fun unconfiguredAuthorityDenies() = denied(Harness(configured = false), Reason.AUTHORITY_NOT_CONFIGURED)
  @Test fun noSessionDenies() { val h = Harness(); h.sessions.session = null; denied(h, Reason.NO_SESSION) }
  @Test fun expiredSessionDenies() { val h = Harness(); h.clock.now += 3_600_001; denied(h, Reason.SESSION_EXPIRED) }
  @Test fun osVpnNotAuthorizedDenies() { val h = Harness(); h.os.vpn = false; denied(h, Reason.OS_VPN_NOT_AUTHORIZED) }
  @Test fun notificationsBlockedDenies() { val h = Harness(); h.os.notifications = false; denied(h, Reason.NOTIFICATIONS_BLOCKED) }
  @Test fun consentNotGrantedDenies() { val h = Harness(); h.authority.result = okResponse(consent = "revoked"); denied(h, Reason.CONSENT_NOT_GRANTED) }
  @Test fun dataSharingOffDenies() { val h = Harness(); h.authority.result = okResponse(sharing = false); denied(h, Reason.DATA_SHARING_OFF) }
  @Test fun serverSideSessionRevokedDenies() { val h = Harness(); h.authority.result = okResponse(active = false); denied(h, Reason.SESSION_REVOKED) }
  @Test fun authorityRejectionDenies() { val h = Harness(); h.authority.result = AuthorityResult.Rejected(Reason.SESSION_REVOKED); denied(h, Reason.SESSION_REVOKED) }
  @Test fun unprovenDeviceOwnershipDenies() { val h = Harness(); h.authority.result = okResponse(owner = null); denied(h, Reason.DEVICE_NOT_OWNED) }

  @Test fun authorityOutageFailsClosedAtStart() {
    val h = Harness(); h.authority.result = AuthorityResult.Unavailable("timeout")
    assertTrue(h.startOk() is Decision.Unavailable)
    assertEquals(State.STOPPED, h.controller.state)
  }

  @Test fun recordedConsentAloneNeverStartsCollection() {
    val h = Harness()
    assertEquals(State.IDLE, h.controller.state)
    assertEquals(Decision.Deny(Reason.NOT_EXPLICITLY_ACTIVATED), h.gate.check(Phase.START))
    h.controller.onDns("example.com", 10)
    assertEquals(0, h.queue.size())
  }

  @Test fun activeOnlyAfterEveryGateAndTunnel() {
    val h = Harness()
    assertTrue(h.startOk() is Decision.Allow)
    assertEquals(State.ACTIVE, h.controller.state)
    h.controller.explicitStop()
  }

  @Test fun tunnelFailureIsNotReportedActive() {
    val h = Harness(); h.gate.activate()
    h.controller.start { false }
    assertEquals(State.STOPPED, h.controller.state)
    assertEquals(Reason.TUNNEL_FAILED, h.controller.reason)
  }

  @Test fun authorizationLostWhileTunnelComesUpNeverActivates() {
    val h = Harness(); h.gate.activate()
    h.controller.start { h.os.vpn = false; true }
    assertEquals(State.STOPPED, h.controller.state)
    assertEquals(Reason.OS_VPN_NOT_AUTHORIZED, h.controller.reason)
  }
}

class CrossAccountTest {
  @Test fun localBindingToAnotherAccountIsRejected() {
    val h = Harness(binding = FakeBinding("acct-other"))
    assertEquals(Decision.Deny(Reason.CROSS_ACCOUNT_REJECTED), h.startOk())
  }
  @Test fun bindingRecordedOnlyAfterServerConfirmsOwnership() {
    val h = Harness(worker = false); h.authority.result = okResponse(owner = "acct-other")
    h.startOk(); assertNull(h.binding.account)
    h.authority.result = okResponse(); h.startOk(); assertEquals("acct-a", h.binding.account)
    h.controller.explicitStop()
  }
  @Test fun authoritativeOwnerMismatchIsRejected() {
    val h = Harness(); h.authority.result = okResponse(owner = "acct-other")
    assertEquals(Decision.Deny(Reason.CROSS_ACCOUNT_REJECTED), h.startOk())
  }
  @Test fun relinkMidFlightStopsAndPurges() {
    val h = Harness(); h.startOk()
    h.controller.onDns("example.com", 5)
    h.sessions.session = Session("acct-b", "dev-1", "t", h.clock.now + 1000)
    h.binding.account = "acct-a"
    h.controller.onDns("example.org", 5)
    assertEquals(Reason.CROSS_ACCOUNT_REJECTED, h.controller.reason)
    assertEquals(0, h.queue.size())
  }
}

class BufferAndMidFlightLossTest {
  @Test fun buffersMinimizedMetadataOnly() {
    val h = Harness(); h.startOk()
    h.controller.onDns("Example.COM.", 2048)
    val batch = h.queue.peekBatch()!!
    val o = batch.observations.single()
    assertEquals("example.com", o.destinationHost)
    assertEquals("unknown", o.attribution); assertNull(o.sourceApp); assertEquals("unknown", o.classification)
    assertEquals("1-10KB", o.bytesBucket); assertEquals(CONSENT, o.consentId)
    h.controller.explicitStop()
  }

  @Test fun uncertainDestinationIsNotRecorded() {
    val h = Harness(); h.startOk()
    h.controller.onDns(null, 10); h.controller.onDns("10.1.2.3", 10); h.controller.onDns("bad host", 10)
    assertEquals(0, h.queue.size())
    h.controller.explicitStop()
  }

  @Test fun consentRevokedMidFlightStopsAndPurgesWithoutUpload() {
    val h = Harness(); h.startOk()
    h.controller.onDns("a.example", 1)
    h.clock.now += 31_000  // buffer cache stale -> authoritative re-check
    h.authority.result = okResponse(consent = "revoked")
    h.controller.onDns("b.example", 1)
    assertEquals(State.STOPPED, h.controller.state)
    assertEquals(Reason.CONSENT_NOT_GRANTED, h.controller.reason)
    assertEquals(0, h.queue.size())
    assertTrue(h.uploader.batches.isEmpty())
    assertFalse(h.gate.isActivated())
  }

  @Test fun localSessionLossStopsImmediatelyDespiteFreshCache() {
    val h = Harness(); h.startOk()
    h.controller.onDns("a.example", 1)
    h.sessions.session = null // logout
    h.controller.onDns("b.example", 1)
    assertEquals(Reason.NO_SESSION, h.controller.reason)
    assertEquals(0, h.queue.size())
  }

  @Test fun osVpnRevokedStopsImmediately() {
    val h = Harness(); h.startOk()
    h.os.vpn = false
    h.controller.onDns("a.example", 1)
    assertEquals(Reason.OS_VPN_NOT_AUTHORIZED, h.controller.reason)
  }

  @Test fun sessionExpiryStopsCapture() {
    val h = Harness(); h.startOk()
    h.clock.now += 3_600_001
    h.controller.onDns("a.example", 1)
    assertEquals(Reason.SESSION_EXPIRED, h.controller.reason)
  }

  @Test fun bufferReusesRecentAuthorityAnswerOnly() {
    val h = Harness(worker = false); h.startOk()
    val before = h.authority.calls.get()
    h.controller.onDns("a.example", 1); h.controller.onDns("b.example", 1)
    assertEquals(before, h.authority.calls.get())
    h.clock.now += 31_000
    h.controller.onDns("c.example", 1)
    assertEquals(before + 1, h.authority.calls.get())
    h.controller.explicitStop()
  }

  @Test fun authorityOutagePausesCaptureThenResumes() {
    val h = Harness(); h.startOk()
    h.clock.now += 31_000
    h.authority.result = AuthorityResult.Unavailable("offline")
    h.controller.onDns("a.example", 1)
    assertEquals(State.PAUSED, h.controller.state)
    assertEquals(0, h.queue.size())
    h.authority.result = okResponse()
    h.controller.onDns("b.example", 1)
    assertEquals(State.ACTIVE, h.controller.state)
    assertEquals(1, h.queue.size())
    h.controller.explicitStop()
  }

  @Test fun userStopKeepsQueueButFailClosedStopPurges() {
    val h = Harness(worker = false); h.startOk()
    h.controller.onDns("a.example", 1)
    h.controller.explicitStop()
    assertEquals(1, h.queue.size())
    assertNotNull(h.store.load())
    val h2 = Harness(worker = false); h2.startOk(); h2.controller.onDns("a.example", 1)
    h2.controller.stop(Reason.SESSION_REVOKED)
    assertEquals(0, h2.queue.size()); assertNull(h2.store.load())
  }
}

class NetworkChangeAndShutdownTest {
  @Test fun resumeAfterNetworkChangeRechecksAuthority() {
    val h = Harness(worker = false); h.startOk()
    val before = h.authority.calls.get()
    assertTrue(h.controller.resume() is Decision.Allow)
    assertEquals(before + 1, h.authority.calls.get())
    h.controller.explicitStop()
  }

  @Test fun resumeRecoversFromPause() {
    val h = Harness(); h.startOk()
    h.authority.result = AuthorityResult.Unavailable("net")
    assertTrue(h.controller.resume() is Decision.Unavailable)
    assertEquals(State.PAUSED, h.controller.state)
    h.authority.result = okResponse()
    assertTrue(h.controller.resume() is Decision.Allow)
    assertEquals(State.ACTIVE, h.controller.state)
    h.controller.explicitStop()
  }

  @Test fun resumeStopsWhenOsAuthorizationLost() {
    val h = Harness(); h.startOk()
    h.os.vpn = false
    assertTrue(h.controller.resume() is Decision.Deny)
    assertEquals(State.STOPPED, h.controller.state)
  }

  @Test fun resumeDoesNothingWhenNotRunning() {
    val h = Harness()
    assertTrue(h.controller.resume() is Decision.Deny)
    assertEquals(0, h.authority.calls.get())
  }

  @Test fun stopIsIdempotentAndNotifiesOnce() {
    val h = Harness(); h.startOk()
    h.controller.explicitStop(); h.controller.stop(Reason.SESSION_REVOKED)
    assertEquals(listOf(Reason.USER_STOP), h.stops)
  }

  @Test fun workerThreadExitsOnStop() {
    val h = Harness(); h.startOk()
    h.controller.explicitStop()
    assertTrue(h.controller.awaitShutdown(2_000))
  }

  @Test fun workerHaltsAndStopsControllerWhenSessionRevokedRemotely() {
    val h = Harness(); h.startOk()
    h.authority.result = AuthorityResult.Rejected(Reason.SESSION_REVOKED)
    val deadline = System.currentTimeMillis() + 3_000
    while (h.controller.state != State.STOPPED && System.currentTimeMillis() < deadline) Thread.sleep(10)
    assertEquals(Reason.SESSION_REVOKED, h.controller.reason)
    assertTrue(h.controller.awaitShutdown(2_000))
  }

  @Test fun restartAfterStopWorks() {
    val h = Harness(); h.startOk(); h.controller.explicitStop()
    assertTrue(h.startOk() is Decision.Allow)
    assertEquals(State.ACTIVE, h.controller.state)
    h.controller.explicitStop()
  }
}
