# Android collector: architecture, guardrails and device verification

Status: implemented behind build gates and **not production ready**. It is disabled by default and
cannot start until identity-provider and backend work (see "Remaining blockers") is in place.

## Gates (all distinct, all required)

| Gate | Source of truth | Local check |
| --- | --- | --- |
| Build enabled | `kicks.collectorEnabled=true` and `kicks.collectorApiBaseUrl=https://…` Gradle properties | `BuildConfig` |
| Explicit activation | user toggles monitoring in Settings (never persisted, never implied by consent) | `AuthorizationGate.activate()` |
| Account connection | signed-in session in Keystore-encrypted storage; server confirms it is active | expiry, presence |
| Device ownership | server returns `deviceOwnerAccountId`; must equal the session account | local binding rejects a different account |
| Collection consent | server `consentState == granted` with `consentId` + `consentPurpose` | — |
| Data sharing | server `dataSharing == true` | — |
| OS VPN authorization | `VpnService.prepare() == null`, `onRevoke()` | every check |
| Notifications | `areNotificationsEnabled()` so monitoring is always visible | every check |

A consent grant alone never starts collection. The UI shows monitoring as on only when the native
state is `active`, i.e. the gate allowed the start **and** the tunnel is established.

## Flow

```
Settings toggle -> requestAuthorization (VpnService.prepare) -> start()
  -> foreground KicksVpnService -> CollectorController.start
       gate(START) -> establish tunnel -> gate(RESUME) -> ACTIVE + upload worker
DNS query -> forwarded unchanged (protect()ed socket) -> reply written to tun
          -> controller.onDns -> gate(BUFFER) -> Minimizer -> BoundedQueue
UploadWorker loop -> gate(UPLOAD / RETRY, always a fresh authority call) -> POST /v1/metadata-batches
```

Code: `vpn/core/*` is pure Kotlin (JVM-testable); `vpn/*` holds Android adapters
(`KicksVpnService`, `KicksVpnModule`, `SecureStorage`, `AuthorityHttp`, `CollectorRuntime`).

### Forwarding path

The tunnel owns only one virtual DNS address (`10.111.222.2/32` route). All other traffic never enters
the tunnel, so normal connectivity is preserved by construction. DNS queries are forwarded to the real
resolver of the underlying network. If no resolver is available, or anything fails, the tunnel is
closed and Android falls back to the network's own resolver (fail open for connectivity, fail closed
for collection). Known limits: apps using Private DNS (DoT/DoH) or hard-coded resolvers are not seen;
DNS over TCP and replies larger than the tunnel MTU are not handled.

### Data minimization

Observation fields are exactly the server's strict schema: `eventId, occurredAt, sourceApp,
attribution, destinationHost, protocol, bytesBucket, classification, consentId, consentPurpose`.
Only the DNS question name is read. No payloads, URLs, paths, query strings or credentials.
`sourceApp` is `null`, `attribution` and `classification` are `unknown` (DNS gives no reliable
attribution). A host that is not a clean DNS name (IP literal, malformed) is dropped, because the schema has no
"unknown host" value.

### Queue and worker

* Capacity 2000 observations; when full the oldest pending item is dropped and counted (`dropped`).
* Batches ≤ 250 (server limit). The in-flight batch keeps its `batchId` across retries and restarts;
  `409` is treated as delivered, `400` discards the batch, `401/403` halt the collector.
* Queue is persisted AES-GCM encrypted (Android Keystore, no-backup dir). After restart it is
  re-authorized, observations from a different consent are removed, and corrupt data is discarded.
* Exponential backoff 2s → 5 min with jitter; a batch is discarded after 8 failed attempts.
* Authorization loss (denial) stops capture and upload and purges the queue; transient authority
  outages only pause (no capture, no upload) and recover on the next successful check.
* The worker re-checks authorization every 15 s even when idle, so remote revocation is noticed
  without traffic. Logout, `onRevoke`, expiry and stop take effect immediately.

### Session and ownership

`setSession`/`clearSession` on the `KicksVpn` native module are the hooks for the identity provider.
Tokens are stored only in Keystore-encrypted no-backup files; restored sessions still pass the gate.
The device binding is recorded only after the server confirms ownership, survives logout and rejects a
different account with `DEVICE_OWNED_BY_OTHER_ACCOUNT` (surfaced in Settings).

## Tests

`apps/mobile/android/app/src/test/java/com/datastorm/kicks/vpn/core` — authorization at start/resume/
buffer/retry/upload, mid-flight loss of consent/session/OS authorization, queue bounds/retry/restart,
cross-account rejection, logout/revocation/expiry, network-change resume, shutdown. Run in CI job
`collector-core` (or with Gradle `testDebugUnitTest` in a generated Android project).

## Manual physical-device checklist (evidence not yet collected)

1. Default build: Settings toggle reports collector not configured; nothing runs.
2. Enabled build, no session: start is refused with a sign-in message.
3. Signed-in test account + granted consent: recording consent alone leaves monitoring OFF.
4. Toggle on, accept the Android VPN prompt: persistent notification appears; status becomes ACTIVE only after.
5. Browse, stream, make calls: connectivity is normal; DNS resolves; no visible slowdown.
6. Inspect uploads on the server: only schema fields, `attribution=unknown`, no URLs/payloads.
7. Revoke consent server-side: capture and upload stop within ~15 s and the notification disappears.
8. Repeat for: logout, remote session revocation, session expiry, removing VPN permission in Android settings, disabling notifications.
9. Switch Wi‑Fi ⇄ mobile and toggle airplane mode: DNS keeps working; collection resumes only after re-authorization.
10. Sign in with a second account on the same device: rejected as owned by another account.
11. Force-stop the app and reboot: collector stays off until explicitly activated again.
12. Stop from Settings: no leftover VPN key icon, no running service.

## Identity provider integration (provider-agnostic)

Implemented without choosing a vendor (`services/api/src/oidc.ts`, `server.ts`):

* Set `KICKS_OIDC_ISSUER`, `KICKS_OIDC_AUDIENCE` and `KICKS_OIDC_JWKS_URI` (https). The API verifies
  RS256/ES256 JWTs (signature against the JWKS with refresh on unknown `kid`, `iss`, `aud`, `exp`,
  `nbf`, non-empty `sub`); `alg=none`/HS* are rejected. `sub` is the account ID.
* `POST /v1/devices/enroll` binds a device ID to `sub`; another account gets
  `403 device_owned_by_another_account`. `POST /v1/devices/:id/revoke` revokes a device.
* `GET /v1/collector/eligibility` returns session/owner/consent/data-sharing state; `PUT /v1/data-sharing`
  sets the separate sharing choice. Uploads and consent events accept an IdP token only together with
  an `X-Kicks-Device` header for a device enrolled to that account.
* Mobile: `apps/mobile/services/identityApi.ts` enrolls and calls `setSession` / `clearSession`.
* Tests: `services/api/src/oidc.test.ts` uses a locally generated key pair.

The legacy admin-minted staging device token path still exists for existing tests and should be
removed/disabled once a real provider is configured. State is still in-memory (not yet PostgreSQL).

## Remaining blockers (external, not implemented here)

* The provider has not been selected: no tenant, issuer, audience, JWKS URI or Android client (PKCE,
  `kicks://` redirect) exists, and no sign-in SDK is integrated, so no screen calls `enrollDevice` yet.
* Token refresh, provider-side token revocation propagation (beyond short expiry and device revoke)
  and persistent device/ownership storage are pending.
* Physical-device evidence, a real-test-account lifecycle run and the 30 consent acceptance cases are
  not yet run.
