# M4 — Privacy, Consent, VPN and Android Permission Audit

Status: ACTIVE — audit baseline

This document records evidence and release blockers for GitHub issue #6. M4 begins as an audit-only workstream. Do not mutate protected KICK'S 0.2.5 collector/Moto datasets while resolving findings.

## Safety boundary

- Treat established 0.2.5 collector behavior and Moto/tablet historical datasets as protected.
- Do not reset, clean, overwrite, or destructively migrate collector data.
- No monitoring, commercial-data use, marketplace sharing, compensated opportunity participation, or marketing authorization may be inferred from account creation or another consent.
- Production must fail closed. Demo defaults must never become production authorization.

## Current Android permission inventory

Source manifest currently declares:

| Permission / capability | Observed purpose | Audit status |
|---|---|---|
| INTERNET | API/network communication | Expected; verify merged manifest |
| FOREGROUND_SERVICE | VPN monitoring foreground service | Expected; verify merged manifest |
| FOREGROUND_SERVICE_SPECIAL_USE | Special-use VPN foreground service | Requires Play declaration/review |
| POST_NOTIFICATIONS | Foreground monitoring notification | Expected; denial behavior must be tested |
| READ_EXTERNAL_STORAGE (maxSdk 32) | No source usage found in initial search | REVIEW / candidate removal |
| WRITE_EXTERNAL_STORAGE (maxSdk 32) | No source usage found in initial search | REVIEW / candidate removal |
| SYSTEM_ALERT_WINDOW | No source usage found in initial search | RELEASE BLOCKER until justified or removed |
| VIBRATE | Notification/UI behavior | Review necessity |
| BIND_VPN_SERVICE | Applied to KicksVpnService | Expected platform VPN binding control |

The final determination must use the merged release manifest, not only the checked-in source manifest.

## VPN behavior baseline

`KicksVpnService` is declared non-exported, protected by `android.permission.BIND_VPN_SERVICE`, and classified as a `specialUse` foreground service with the subtype `User-authorized, metadata-only privacy monitoring VPN`.

The current checked-in service posts a persistent notification stating that metadata monitoring is active, but intentionally establishes no TUN interface and then immediately stops. The source comment says this prevents traffic loss or collection until the independently owned forwarding/ingestion path is configured.

`KicksVpnModule.start()` separately checks Android VPN authorization and `BuildConfig.COLLECTOR_ENABLED` before starting the service.

Release requirement: user disclosure, notification text, Play VPN declaration, Data Safety answers, and actual signed-build behavior must describe the same behavior. Do not claim active monitoring when the release service does not actually monitor; do not enable monitoring without the corresponding explicit authorization.

## Collector metadata contract

The API's minimized collector observation contract currently permits only:

- eventId
- occurredAt
- sourceApp (nullable)
- attribution: verified / best_effort / unknown
- destinationHost
- protocol: dns / tcp / udp / tls / quic / other
- bytesBucket: 0-1KB / 1-10KB / 10-100KB / 100KB-1MB / 1MB+
- classification: expected / review / unpermissioned / unknown
- consentId
- consentPurpose

The schema is strict and rejects unknown observation fields. Metadata batch ingestion requires an active consent belonging to the authenticated device subject with an exact matching purpose, and rejects batch replay.

Data Safety mapping still requires confirmation of retention, deletion, sharing destination, encryption in transit/at rest, and whether each field is collected, shared, ephemeral, optional, or required in the production configuration.

## Consent separation audit

Required independent authorization domains:

1. Monitoring / collector operation
2. Commercial-data use
3. Marketplace sharing / buyer access
4. Compensated opportunities
5. Marketing communications

Account creation and product entitlement must grant none of these implicitly.

### RELEASE BLOCKER — permissions engine defaults

`services/api/src/permissions.ts` currently contains demo-seeded permissions for `user_demo_01`, including allowed commercial/buyer states. More importantly, `getMetadataPermissions()` initializes previously unseen app metadata categories as `allowed`.

This is incompatible with the M4 beta rule and the documented zero-trust deny-by-default boundary if reachable in production.

Required resolution before production beta:

- Production permission state starts blocked/denied unless an explicit, purpose-specific authorization exists.
- Demo seed behavior is unavailable in production.
- Monitoring consent remains distinct from commercial/marketplace/compensated/marketing authorization.
- Revocation is propagated to the corresponding activity and verified by tests.
- No account registration, login, device binding, or entitlement action creates implicit permission grants.

Do not resolve this blocker by rewriting protected collector behavior. Fix the permission/authorization layer and prove compatibility with collector regression tests.

## Initial findings

### M4-F01 — Default-allowed metadata permissions
Severity: RELEASE BLOCKER

Unseen app metadata permissions are created as allowed. Production must deny by default.

### M4-F02 — Demo permission seeds in runtime engine
Severity: RELEASE BLOCKER

The runtime permissions engine seeds a demo user with commercial and buyer permissions. Production must disable demo/runtime fallback authorization.

### M4-F03 — SYSTEM_ALERT_WINDOW declared without located source use
Severity: HIGH / Play review risk

Initial repository search found no direct source use. Trace merged-manifest origin and runtime requirement; remove if unnecessary.

### M4-F04 — Legacy external-storage permissions declared without located source use
Severity: MEDIUM

READ/WRITE_EXTERNAL_STORAGE are limited to API 32 but should be removed if the merged release application does not require them.

### M4-F05 — VPN disclosure must match signed release behavior
Severity: RELEASE BLOCKER

Current service declares metadata monitoring but establishes no TUN and immediately stops. Final disclosure and Play declarations must match actual 0.2.6 signed-build behavior.

## Acceptance-criteria progress

- [x] Begin inventory of collected data fields/categories
- [ ] Map every field to source, purpose, consent/legal basis, retention, deletion, and sharing destination
- [ ] Confirm all five authorization domains remain separate in production
- [ ] Verify revocation stops corresponding activity
- [ ] Review merged release Android manifest
- [ ] Remove unnecessary Android permissions
- [ ] Validate VPN/foreground-service behavior and user disclosure on signed/release candidate
- [ ] Validate denial/revocation states
- [ ] Prepare final Play Data Safety mapping and special permission/VPN declarations
- [ ] Confirm privacy policy/account-deletion disclosures match actual production behavior

## Next audit actions

1. Trace every permission and collected field through mobile/native/API code.
2. Produce a field-level Data Safety matrix.
3. Separate demo permission state from production authorization and add fail-closed tests.
4. Generate/review the merged release manifest before permission removal decisions.
5. Verify monitoring grant/revoke and foreground notification behavior on the release candidate.
6. Reconcile deletion/retention disclosures with M2 identity deletion behavior before M4 closes.
