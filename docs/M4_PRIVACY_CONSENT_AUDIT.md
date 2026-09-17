# M4 — Privacy, Consent, VPN and Android Permission Audit

Status: ACTIVE — fail-closed remediation implemented; validation/manifest audit pending

This work remains isolated from protected KICK'S 0.2.5 collector/Moto datasets.

## Safety boundary
- Historical Moto/tablet collector datasets are protected; no reset, cleanup, overwrite or destructive migration.
- Monitoring, commercial use, marketplace sharing, compensated opportunities and marketing are independent authorization domains.
- Production fails closed; demo fixtures cannot become production authorization.

## Collector contract
`/v1/metadata-batches` remains unchanged. It accepts only minimized metadata fields and requires device authentication plus an active consent belonging to the same subject with an exact matching purpose. Replay and payload/unknown-field rejection remain protected regression behavior.

Current fields: eventId, occurredAt, sourceApp, attribution, destinationHost, protocol, bytesBucket, classification, consentId, consentPurpose. Raw payloads, query strings, arbitrary headers, passwords, account numbers and message content are excluded by the strict schema.

Retention/deletion/storage declarations remain pending M2 identity deletion semantics and M5 production persistence.

## Authorization remediation completed on this branch
- `PermissionsEngine` production/default users no longer receive seeded app or buyer permissions.
- Unseen app metadata categories initialize blocked.
- Legacy demo permission fixtures require explicit demo/test mode.
- `IntelligenceEngine` default and missing gates are blocked.
- Intelligence estimated commercial value counts only explicitly allowed metadata.
- `conditional` is not marketplace authorization.
- Marketplace matching counts only explicitly allowed metadata gates and actual eligible events.
- Synthetic fallback event counts are no longer used to create marketplace eligibility.
- Collector monitoring consent remains independent of commercial/marketplace permission state.
- Focused tests cover fail-closed defaults, authorization separation, marketplace gating and protected exact-purpose collector ingestion.

## Remaining findings / dependencies
- M4-F03 HIGH: `SYSTEM_ALERT_WINDOW` declared; no direct source use located. Verify merged release manifest and remove if unnecessary.
- M4-F04 MEDIUM: legacy READ/WRITE_EXTERNAL_STORAGE (maxSdk 32) have no located direct source use. Verify merged manifest/runtime requirement.
- M4-F05 RELEASE BLOCKER: VPN disclosure must match signed release behavior. Current checked-in service establishes no TUN and stops; disclosure cannot claim active monitoring unless the release artifact actually does it with explicit authorization.
- M4-F08 HIGH: marketplace catalog contains an offer with `consent_required:false`. Subject-level authorization now gates matching, but catalog semantics should be normalized before production.
- M4-F09 DEPENDENCY: checked-in release configuration is not yet the final 0.2.6 production artifact; versioning/signing/config belong to M5/M6.

## Android permission inventory
| Permission/capability | Current disposition |
|---|---|
| INTERNET | expected for API/network communication |
| FOREGROUND_SERVICE | expected only if release collector foreground service is active |
| FOREGROUND_SERVICE_SPECIAL_USE | requires Play declaration/review |
| POST_NOTIFICATIONS | foreground notification; denial behavior needs device test |
| READ_EXTERNAL_STORAGE maxSdk32 | candidate removal pending merged manifest |
| WRITE_EXTERNAL_STORAGE maxSdk32 | candidate removal pending merged manifest |
| SYSTEM_ALERT_WINDOW | high-priority candidate removal pending merged manifest |
| VIBRATE | review necessity |
| BIND_VPN_SERVICE | expected on non-exported VPN service |

## Acceptance progress
- [x] Inventory minimized collector fields/categories
- [~] Field source/purpose/authorization/sharing mapped; retention/deletion pending M2/M5
- [x] Production/default permission and intelligence state changed to fail closed
- [x] Monitoring consent kept separate from commercial/marketplace authorization in regression coverage
- [x] Conditional/default metadata no longer creates marketplace eligibility
- [ ] Validate complete test suite/CI for remediation commits
- [ ] Verify revocation stops corresponding activity
- [ ] Generate/review merged release Android manifest
- [ ] Remove unnecessary Android permissions after merged-manifest proof
- [~] Validate VPN source behavior/disclosure; signed-device validation pending
- [ ] Final Play Data Safety/VPN/special-permission declarations against M6 signed artifact
- [ ] Privacy policy/account-deletion disclosures reconciled with M2/M5

## Next actions
1. Validate API typecheck/tests in GitHub Actions and repair any regression before advancing.
2. Add explicit revocation regression for marketplace/commercial authorization.
3. Inspect merged release manifest/build dependencies before permission removal.
4. Normalize offer-level consent semantics so catalog configuration cannot imply consent bypass.
5. Reconcile retention/deletion with M2 and persistence with M5.
6. Finalize Play disclosures against the exact signed M6 artifact.
