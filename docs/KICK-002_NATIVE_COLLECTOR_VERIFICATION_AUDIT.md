# KICK-002 — Native Collector Verification Audit

**Status: BLOCKED — audit evidence only; verification flow not implemented.**  
**Safety: Monitoring must remain OFF. Do not publish a release.**

## Findings from the repository at audit time

Repository: `GlobalCommerce91210/KICKS_101_Android-`  
Audited default-branch commit: `6fed752e61ae72f1ad4a2cf8ac57537e8e6ba419`

### Confirmed evidence

- The repository tree contains Android native VPN files:
  - `apps/mobile/android/app/src/main/java/com/datastorm/kicks/vpn/KicksVpnService.kt`
  - `apps/mobile/android/app/src/main/java/com/datastorm/kicks/vpn/KicksVpnModule.kt`
  - `apps/mobile/android/app/src/main/java/com/datastorm/kicks/vpn/KicksVpnPackage.kt`
- The UI in `apps/mobile/app/engine.tsx` explicitly describes the engine as **DEMO MODE** and identifies Android `VpnService` as the production path.
- `docs/ARCHITECTURE.md` describes the local `VpnService` collector as future work.
- `README.md` says the current UI uses demo observations until the native collector is implemented and reviewed.
- The complete default-branch tree (71 entries) contains no iOS project, Packet Tunnel extension, iOS collector implementation, collector-verification module, or collector-specific automated test file. The only matching test path in the tree is `services/api/src/server.test.ts`.

### Root cause

The app cannot truthfully report native collector verification for iOS because this repository snapshot does not contain an iOS native collector or Packet Tunnel extension to identify and verify. A UI reference or authenticated app session is not proof that the native capability exists. Android VPN service files do not satisfy the iOS requirement, and the current demo UI is not authoritative verification evidence.

This is a confirmed repository-level gap, not proof that no implementation exists in another repository or untracked workspace.

## Required dependencies before implementation can pass

1. **iOS native target:** an Expo config plugin / native iOS project integration and a Network Extension Packet Tunnel target with the required Apple capability and provisioning entitlements. Confirm the extension is embedded and signed in the exact supported build.
2. **Native identity contract:** define how the extension produces a versioned collector identity and binds it to the installed app/build. Do not use device USB connectivity or app login as a substitute.
3. **Authoritative verifier:** document the approved backend endpoint or native verification contract, including authenticated request, schema/version, collector ID, build compatibility, issued-at/expiry, nonce or challenge, and explicit success/failure response semantics.
4. **Trust and lifecycle:** reject missing/malformed identity, incompatible versions, expired or stale results, auth failures, timeouts, and results from a prior connection attempt. Invalidate verification immediately on disconnect, identity change, app/session change, or verification timeout.
5. **Feature gating:** make the shared monitoring eligibility policy fail closed. Verification success must never enable monitoring by itself; monitoring remains OFF unless every independent consent, permission, enrollment, compatibility, and explicit-activation gate passes.
6. **Privacy-safe diagnostics:** emit event name, coarse result category, platform/build, and correlation ID only. Never log tokens, raw identity secrets, traffic payloads, or personal data.

## Required state contract

- `UNAVAILABLE`: native integration missing, unsupported, or incompatible in this build.
- `DISCONNECTED`: supported integration exists but no active collector connection is present.
- `CONNECTING`: native connection attempt is in progress.
- `VERIFYING`: connection exists and the current identity challenge is being checked.
- `VERIFIED`: only after authoritative, current, authenticated, schema-valid success.
- `VERIFICATION_FAILED`: a supported integration attempted verification and it failed.

Enrollment is a separate backend device-record state and must not be inferred from any collector state. Initial state, navigation restore, logout, disconnect, and stale-response handling must not restore `VERIFIED` without fresh authoritative evidence.

## Required automated test matrix

| Scenario | Expected result |
|---|---|
| Valid, current verifier response for matching collector/build | `VERIFIED` |
| Native module or Packet Tunnel absent | `UNAVAILABLE`; monitoring blocked |
| Invalid or mismatched collector identity | `VERIFICATION_FAILED`; monitoring blocked |
| Missing/expired authentication | `VERIFICATION_FAILED`; clear verification |
| Backend timeout | `VERIFICATION_FAILED` or explicit retryable failure; never verified |
| Disconnect while verifying | Immediately leave `VERIFYING`; discard late success |
| Response from an older attempt / expired result | Ignore and remain blocked |
| Reconnect after disconnect | Return to `CONNECTING`/`VERIFYING`; require fresh verification |
| Navigate away and back | Render state from current source of truth; never trust stale UI cache |
| Monitoring gate | Remains OFF in every test unless separately authorized; this task must not activate it |

## Verification evidence and limitations

- **Repository tree inspection:** completed at the audited commit; no iOS Packet Tunnel/native collector or collector verification implementation was found.
- **Build/tests/device verification:** not run. No code implementation is included in this audit-only change.
- **KICK-001 prerequisite:** its implementation and device verification could not be established from this repository tree alone. Treat it as an unresolved prerequisite until its commit/test/device evidence is supplied.
- **Next action:** add the iOS native target and identity/verifier contract (or identify the canonical repository/branch containing them), then implement the state machine and tests against those concrete contracts.

This document intentionally does not claim the KICK-002 acceptance criteria are met.
