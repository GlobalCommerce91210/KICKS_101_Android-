package com.datastorm.kicks.vpn.core

/** Points in the collector lifecycle at which authorization is re-evaluated. */
enum class Phase { START, RESUME, BUFFER, RETRY, UPLOAD }

/** Why capture is not allowed, or why it stopped. Wire-stable strings are shown to the UI. */
enum class Reason(val purgesQueue: Boolean) {
  COLLECTOR_DISABLED(true),
  AUTHORITY_NOT_CONFIGURED(true),
  NOT_EXPLICITLY_ACTIVATED(true),
  NO_SESSION(true),
  SESSION_EXPIRED(true),
  SESSION_REVOKED(true),
  CROSS_ACCOUNT_REJECTED(true),
  DEVICE_NOT_OWNED(true),
  CONSENT_NOT_GRANTED(true),
  DATA_SHARING_OFF(true),
  OS_VPN_NOT_AUTHORIZED(true),
  NOTIFICATIONS_BLOCKED(true),
  TUNNEL_FAILED(false),
  NO_UPSTREAM_DNS(false),
  AUTHORITY_UNAVAILABLE(false),
  USER_STOP(false),
  SERVICE_STOPPED(false)
}

data class Session(val accountId: String, val deviceId: String, val token: String, val expiresAtMs: Long) {
  override fun toString() = "Session(accountId=$accountId, deviceId=$deviceId, token=<redacted>)"
}

data class Grant(val consentId: String, val consentPurpose: String)

/** Authoritative server view of the gates that are independent of the local device. */
data class AuthorityResponse(
  val sessionActive: Boolean,
  val accountId: String?,
  val deviceOwnerAccountId: String?,
  val consentState: String?,
  val consentId: String?,
  val consentPurpose: String?,
  val dataSharing: Boolean
)

sealed class AuthorityResult {
  data class Ok(val response: AuthorityResponse) : AuthorityResult()
  /** Definitive denial (for example HTTP 401/403): never retried as if it were transient. */
  data class Rejected(val reason: Reason) : AuthorityResult()
  /** Network/server failure: authorization cannot be proven, so nothing is captured or uploaded. */
  data class Unavailable(val detail: String) : AuthorityResult()
}

sealed class Decision {
  data class Allow(val grant: Grant, val session: Session) : Decision()
  data class Deny(val reason: Reason) : Decision()
  data class Unavailable(val detail: String) : Decision()
}

interface AuthorityClient { fun fetch(session: Session): AuthorityResult }
interface SessionSource { fun current(): Session? }
interface OsAuthorization { fun vpnAuthorized(): Boolean; fun notificationsAllowed(): Boolean }
interface DeviceBindingStore { fun boundAccount(): String?; fun bind(accountId: String) }
fun interface Clock { fun nowMs(): Long }

/**
 * Single authorization decision point. Account connection (session), collection consent, OS VPN
 * authorization and data sharing are evaluated as distinct gates and everything fails closed:
 * anything other than an explicit [Decision.Allow] means "do not capture, do not upload".
 */
class AuthorizationGate(
  private val collectorEnabled: Boolean,
  private val sessions: SessionSource,
  private val os: OsAuthorization,
  private val authority: AuthorityClient?,
  private val binding: DeviceBindingStore,
  private val clock: Clock,
  private val bufferStalenessMs: Long = 30_000
) {
  @Volatile private var explicitlyActivated = false
  private class Cached(val session: Session, val response: AuthorityResponse, val atMs: Long)
  private var cached: Cached? = null

  fun activate() { explicitlyActivated = true }
  fun deactivate() { explicitlyActivated = false; invalidate() }
  fun isActivated() = explicitlyActivated

  @Synchronized fun invalidate() { cached = null }

  fun check(phase: Phase): Decision {
    if (!collectorEnabled) return Decision.Deny(Reason.COLLECTOR_DISABLED)
    if (authority == null) return Decision.Deny(Reason.AUTHORITY_NOT_CONFIGURED)
    if (!explicitlyActivated) return Decision.Deny(Reason.NOT_EXPLICITLY_ACTIVATED)
    val session = sessions.current() ?: return Decision.Deny(Reason.NO_SESSION)
    if (session.expiresAtMs <= clock.nowMs()) return Decision.Deny(Reason.SESSION_EXPIRED)
    val bound = binding.boundAccount()
    if (bound != null && bound != session.accountId) return Decision.Deny(Reason.CROSS_ACCOUNT_REJECTED)
    if (!os.vpnAuthorized()) return Decision.Deny(Reason.OS_VPN_NOT_AUTHORIZED)
    if (!os.notificationsAllowed()) return Decision.Deny(Reason.NOTIFICATIONS_BLOCKED)

    val response = when (val r = authoritative(phase, session)) {
      is AuthorityResult.Ok -> r.response
      is AuthorityResult.Rejected -> { invalidate(); return Decision.Deny(r.reason) }
      is AuthorityResult.Unavailable -> { invalidate(); return Decision.Unavailable(r.detail) }
    }
    if (!response.sessionActive) return Decision.Deny(Reason.SESSION_REVOKED)
    if (response.accountId != session.accountId) return Decision.Deny(Reason.SESSION_REVOKED)
    val owner = response.deviceOwnerAccountId ?: return Decision.Deny(Reason.DEVICE_NOT_OWNED)
    if (owner != session.accountId) return Decision.Deny(Reason.CROSS_ACCOUNT_REJECTED)
    if (response.consentState != "granted" || response.consentId.isNullOrBlank() || response.consentPurpose.isNullOrBlank()) {
      return Decision.Deny(Reason.CONSENT_NOT_GRANTED)
    }
    if (!response.dataSharing) return Decision.Deny(Reason.DATA_SHARING_OFF)
    // Local one-device-one-account binding is recorded only once the server confirmed ownership.
    if (bound == null) binding.bind(session.accountId)
    return Decision.Allow(Grant(response.consentId, response.consentPurpose), session)
  }

  /** Only BUFFER may reuse a recent authoritative answer; every other phase asks the authority again. */
  @Synchronized private fun authoritative(phase: Phase, session: Session): AuthorityResult {
    val now = clock.nowMs()
    val c = cached
    if (phase == Phase.BUFFER && c != null && c.session == session && now - c.atMs in 0..bufferStalenessMs) {
      return AuthorityResult.Ok(c.response)
    }
    val result = authority!!.fetch(session)
    cached = if (result is AuthorityResult.Ok) Cached(session, result.response, now) else null
    return result
  }
}
