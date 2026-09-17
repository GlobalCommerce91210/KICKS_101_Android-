# M4 — Privacy, Consent, VPN and Android Permission Audit

Status: ACTIVE — field/consent trace in progress

This document records evidence and release blockers for GitHub issue #6. M4 remains isolated from protected KICK'S 0.2.5 collector/Moto datasets.

## Safety boundary

- Treat established 0.2.5 collector behavior and Moto/tablet historical datasets as protected.
- Do not reset, clean, overwrite, or destructively migrate collector data.
- No monitoring, commercial-data use, marketplace sharing, compensated opportunity participation, or marketing authorization may be inferred from account creation or another consent.
- Production must fail closed. Demo defaults must never become production authorization.

## Android permission inventory

| Permission / capability | Observed purpose | Audit status |
|---|---|---|
| INTERNET | API/network communication | Expected; verify merged release manifest |
| FOREGROUND_SERVICE | VPN monitoring foreground service | Expected if release collector is active |
| FOREGROUND_SERVICE_SPECIAL_USE | Special-use VPN foreground service | Requires Play declaration/review |
| POST_NOTIFICATIONS | Foreground monitoring notification | Expected; denial behavior must be tested |
| READ_EXTERNAL_STORAGE (maxSdk 32) | No direct source use located | REVIEW / candidate removal |
| WRITE_EXTERNAL_STORAGE (maxSdk 32) | No direct source use located | REVIEW / candidate removal |
| SYSTEM_ALERT_WINDOW | No direct source use located | RELEASE BLOCKER until justified or removed |
| VIBRATE | Notification/UI behavior | Review necessity |
| BIND_VPN_SERVICE | Applied to KicksVpnService | Expected platform VPN binding control |

Final permission decisions require the merged release manifest, including permissions introduced by dependencies.

## VPN behavior baseline

`KicksVpnService` is non-exported, protected by `android.permission.BIND_VPN_SERVICE`, and declared as a `specialUse` foreground service with subtype `User-authorized, metadata-only privacy monitoring VPN`.

The checked-in service posts a notification saying metadata monitoring is active, but intentionally establishes no TUN interface and immediately stops. `KicksVpnModule.start()` checks Android VPN authorization and `BuildConfig.COLLECTOR_ENABLED` before starting it.

Release requirement: in-app disclosure, foreground notification, Play VPN declaration, Data Safety answers, and actual signed-build behavior must match. Do not claim active monitoring when the release service does not monitor, and do not activate monitoring without explicit monitoring authorization.

## Collector field-level Data Safety matrix — current contract

The `/v1/metadata-batches` observation schema is strict and rejects unknown fields. This matrix describes the checked-in contract; retention/deletion/storage statements remain provisional until M5 persistence and M2 deletion semantics are finalized.

| Field | Source | Purpose | Authorization | Production retention/deletion | Sharing | Play/Data Safety note |
|---|---|---|---|---|---|---|
| eventId | Collector-generated UUID | Replay/dedup/event correlation | Active monitoring purpose consent | TBD M5/M2 | None by collector contract | Identifier used for app functionality/security; verify persistence |
| occurredAt | Device/collector timestamp | Event chronology | Active monitoring purpose consent | TBD M5/M2 | None by collector contract | Activity timestamp |
| sourceApp | Collector attribution, nullable | Explain which app generated traffic | Active monitoring purpose consent | TBD M5/M2 | No marketplace sharing without separate authorization | App/activity metadata; optional/nullable |
| attribution | Collector inference | Confidence in source attribution | Active monitoring purpose consent | TBD M5/M2 | None by collector contract | Derived diagnostic metadata |
| destinationHost | Network metadata | Explain outbound destination | Active monitoring purpose consent | TBD M5/M2 | No marketplace sharing without separate authorization | Network/activity metadata; host only, not URL/query/payload |
| protocol | Network metadata | Connection classification | Active monitoring purpose consent | TBD M5/M2 | None by collector contract | Network diagnostic metadata |
| bytesBucket | Derived/minimized network volume | Coarse transfer-size analysis | Active monitoring purpose consent | TBD M5/M2 | No marketplace sharing without separate authorization | Coarse bucket, not exact payload size/content |
| classification | Derived engine/collector state | Expected/review/unpermissioned/unknown classification | Active monitoring purpose consent | TBD M5/M2 | None by collector contract | Derived privacy/security signal |
| consentId | Consent record UUID | Bind event to authorization | Exact active consent required | Consent/audit retention TBD | None | Consent/audit identifier |
| consentPurpose | Consent record purpose | Enforce purpose limitation | Exact purpose match required | Consent/audit retention TBD | None | Purpose-enforcement metadata |

### Explicitly excluded by collector schema

The strict collector observation contract does not accept raw payloads, URL query strings, arbitrary headers, passwords, account numbers, message content, or arbitrary extra identifiers. Tests must continue proving unknown/payload fields are rejected.

## Authorization-domain separation

Production requires five independently revocable authorization domains:

1. Monitoring / collector operation
2. Commercial-data use
3. Marketplace sharing / buyer access
4. Compensated opportunities
5. Marketing communications

DataStorm account creation and KICK'S entitlement grant none of these implicitly. Monitoring authorization permits collection only for the stated monitoring purpose; it is not commercial-use or marketplace authorization.

## Consent-path trace

### Collector ingestion path — strong foundation

`/v1/metadata-batches` authenticates a device and rejects an observation unless its `consentId` belongs to that device subject, is currently `granted`, and exactly matches `consentPurpose`. Batch replay is rejected. This path should remain protected and regression-tested.

### PermissionsEngine — RELEASE BLOCKER

`services/api/src/permissions.ts` seeds `user_demo_01` with allowed commercial/buyer permissions. For an unseen app, `getMetadataPermissions()` also creates commercial, transactional, intent, behavioral, engagement, device and operational metadata permissions as `allowed`.

Production resolution: no demo seed authorization; unknown/new permission state must be blocked until explicit purpose-specific authorization exists.

### IntelligenceEngine — RELEASE BLOCKER

`services/api/src/intelligence.ts` independently creates default gates. Several metadata categories default to `allowed`, buyer overrides can be `allowed`, and missing gate state falls back to `allowed`. Marketplace eligibility is then true when an event has positive estimated value and any metadata item is allowed.

This means fixing `PermissionsEngine` alone is insufficient. Production intelligence and marketplace eligibility must fail closed and require explicit authorization from the authoritative consent/permission layer.

### Marketplace offer inconsistency — HIGH

The initial marketplace catalog includes an operational/device offer whose `consent_required` flag is false. M4's beta rule requires collection/commercial use to be backed by the appropriate explicit authorization. Before production, offer-level flags must not bypass subject-level marketplace/commercial authorization.

## Release-configuration observations

Current checked-in Android/Expo configuration still reports version `0.2.5`; `app.json` has `trafficMode: demo`; `COLLECTOR_ENABLED` defaults to false; and Android release signing currently points to the debug signing configuration. These are not changed by M4 because release versioning/signing belongs to M6 and production environment hardening belongs to M5.

Privacy implication: Play disclosures must describe the exact signed 0.2.6 artifact, not aspirational behavior or demo configuration.

## Findings

### M4-F01 — Default-allowed metadata permissions
Severity: RELEASE BLOCKER

Unseen app metadata permissions are created as allowed. Production must deny by default.

### M4-F02 — Demo permission seeds in runtime engine
Severity: RELEASE BLOCKER

Runtime permission state seeds commercial and buyer permissions for a demo user. Production must disable demo/runtime fallback authorization.

### M4-F03 — SYSTEM_ALERT_WINDOW declared without located source use
Severity: HIGH / Play review risk

Trace merged-manifest origin and runtime requirement; remove if unnecessary.

### M4-F04 — Legacy external-storage permissions without located source use
Severity: MEDIUM

READ/WRITE_EXTERNAL_STORAGE are limited to API 32 but should be removed if the merged release application does not require them.

### M4-F05 — VPN disclosure must match signed release behavior
Severity: RELEASE BLOCKER

Current service declares metadata monitoring but establishes no TUN and immediately stops. Final disclosure and Play declarations must match actual signed-build behavior.

### M4-F06 — Intelligence default gates fail open
Severity: RELEASE BLOCKER

Intelligence default gates and missing-gate fallback allow metadata categories without an authoritative explicit permission. Production must fail closed.

### M4-F07 — Marketplace eligibility can derive from default permission state
Severity: RELEASE BLOCKER

Marketplace eligibility currently follows allowed metadata state, including default state. Eligibility must require explicit marketplace/commercial authorization, separate from monitoring.

### M4-F08 — Marketplace offer marks consent not required
Severity: HIGH

An initial operational/device marketplace offer has `consent_required: false`. Offer configuration cannot override required subject authorization.

### M4-F09 — Release/disclosure configuration not yet 0.2.6 production state
Severity: EXPECTED DEPENDENCY / M5-M6

Version, demo traffic mode, collector enablement, and signing are not yet release-candidate state. Data Safety/VPN declarations cannot be finalized until the signed artifact is known.

## Planned fail-closed remediation

The remediation should be coordinated and additive:

- Preserve `/v1/metadata-batches` exact-purpose consent checks and replay/minimization behavior.
- Remove production demo authorization seeds or isolate them behind an explicit non-production fixture.
- Change new/unknown metadata permission defaults to blocked.
- Change intelligence default gates and missing-gate fallback to blocked.
- Require explicit marketplace authorization independently of monitoring authorization.
- Prevent offer configuration from bypassing subject consent.
- Add regression tests proving account creation/device binding/monitoring consent alone do not authorize commercial use or marketplace eligibility.
- Add revoke tests proving revocation stops only the corresponding authorized activity.

No remediation may delete or mutate Moto historical data.

## Acceptance-criteria progress

- [x] Inventory every collector field/category in the checked-in minimized contract
- [~] Map each field to source, purpose, authorization, retention, deletion and sharing destination (retention/deletion pending M2/M5)
- [~] Confirm monitoring, commercial, marketplace, compensated-opportunity and marketing consent remain separate (design mapped; production defaults currently violate requirement)
- [ ] Verify revocation stops corresponding activity
- [ ] Review merged release Android manifest
- [ ] Remove unnecessary Android permissions
- [~] Validate VPN/foreground-service source behavior and disclosure (device/release validation pending)
- [ ] Validate denial/revocation states
- [~] Prepare Play Data Safety mapping and special permission/VPN declarations (field matrix started; signed artifact pending)
- [ ] Privacy policy and account-deletion disclosures match production behavior

## Next actions

1. Implement fail-closed permission/intelligence defaults on the isolated M4 branch with regression tests.
2. Keep collector ingestion behavior unchanged and run collector regression coverage.
3. Generate/review merged release manifest before removing Android permissions.
4. Verify grant/revoke behavior on the release candidate.
5. Reconcile retention/deletion with M2 and production persistence with M5.
6. Finalize Play Data Safety and VPN declarations against the exact M6 signed artifact.
