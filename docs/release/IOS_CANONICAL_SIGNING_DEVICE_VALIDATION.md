# iOS canonical source, signing and device validation
Updated 2026-10-06.

## Canonical source
Active cross-platform application: GlobalCommerce91210/KICKS_101_Android-/apps/mobile, package @kicks/mobile, version 0.2.6; delivery branch mobile/0.2.6-upgrade (PR #22). Root README explicitly routes all new mobile work here. Branch changes are not merged to main.
KICK_S_IOS is the historical 0.2.5 iOS workstream and reference source for native Packet Tunnel templates and existing Expo account settings. Keep its source intact. Its templates are not integrated targets in the canonical generated project.
Passing simulator baseline: commit 8cc0975189d0b524b20e5efda196060ac0748b08, Actions ios-validation #15, Xcode 26.6 on macos-26. Subsequent signing configuration changes require their own CI evidence.

## Signing configuration
Bundle ID com.datastorm.kicks; documented Expo account datastorm-inc, project ezekiel-ios, project ID 1d2a0901-41c9-4026-b835-139e785db502. Local project:info confirmed this owner, slug and project ID on 2026-10-06. Founder-provided EAS logs show successful Apple team authentication, a distribution certificate and an active ad hoc profile for the test iPad; signing was not independently inspected by this agent.
Use KICKS_BUILD_PLATFORM=ios for local EAS configuration commands; EAS_BUILD_PLATFORM=ios selects the same configuration on builders. Android metadata stays unchanged.
Profiles: ios-simulator (unsigned simulator), ios-device (internal ad hoc, EAS-managed credentials), ios-production (store). No developmentClient flag because expo-dev-client is not installed.
Do not enable Network Extension, App Group or shared Keychain entitlements for this visual beta: there is no integrated extension target. Collector signing is a separate gate.
No signing secrets belong in source control. Authenticate directly in Expo/Apple prompts. Verify the existing Expo project before building; do not create a duplicate project or revoke existing certificates.

## Secure operator sequence
From apps/mobile on the canonical branch:
1. Set KICKS_BUILD_PLATFORM=ios (PowerShell: $env:KICKS_BUILD_PLATFORM="ios"; bash: export KICKS_BUILD_PLATFORM=ios).
2. npx eas-cli@latest login
3. npx eas-cli@latest whoami
4. npx eas-cli@latest project:info — confirm the exact existing project ID and owner above.
5. npx eas-cli@latest device:create — register the intended test iPhone/iPad.
6. npx eas-cli@latest credentials --platform ios — select the authorized DataStorm Apple Developer team; inspect existing certificate/profile before creating missing credentials.
7. npx eas-cli@latest build --platform ios --profile ios-device — interactively confirm the selected team and inclusion of test-device UDIDs in provisioning.
8. Record EAS build ID, commit SHA, version/build number, toolchain, signing team, bundle identifier and certificate/profile validity without private key material.
9. Install through the authenticated EAS build page on the provisioned device; do not uninstall an existing app or clear its data. Resolve signing-team continuity before any upgrade.
Internal build URLs should require authorized Expo sign-in (disable unauthenticated access in project settings).
Production profile is configured only; this document does not authorize App Store submission.

## Device acceptance evidence
Record device model, OS, source/build ID, result, date and evidence link for each gate. Avoid publishing full UDIDs or consumer data.
- Valid signature/profile; exact app ID; included device; unexpired profile.
- Clean launch and relaunch; no crash; version/build number matches.
- Activity, Permissions, Opportunities and Wallet navigate and render on iPhone and iPad.
- Account/login/logout and network-error behavior checked against the staging account service.
- Consent grant/revoke and purpose-denied paths return real backend evidence where integrated; mark unsupported flows blocked rather than fabricating a pass.
- Demo observations and earnings remain labeled; monitoring is not represented as live.
- Background/foreground, offline recovery, secure storage and upgrade continuity verified.
- Collector remains unavailable until signed extension, real encrypted forwarding gateway, minimization, revocation and traffic-continuity tests pass on physical hardware.
Store screenshots/logs with synthetic identities and redact secrets.
## Physical iPad smoke test — 2026-10-06 (America/Los_Angeles)
- Device: iPad Pro (9.7-inch), iPadOS 16.7.16, from founder-supplied device screenshot.
- EAS internal build: https://expo.dev/accounts/datastorm-inc/projects/ezekiel-ios/builds/f20f0ec3-98d2-4cc1-bbe2-f99d6d0110b4
- Founder reported build completed and installed. EAS output initialized build number 1; exact source SHA and final build metadata require an EAS record check.
- Screenshot shows Activity rendered on the physical iPad.
- Founder reported all six sections opened (Activity, Engine, Permissions, Opportunities, Wallet, Settings), Simulate Event updated the feed, and the app relaunched after closing.
- Evidence establishes an initial smoke-test pass, not backend functionality. Account authentication, consent persistence/revocation, live collection, secure exchange, and payouts remain unverified.
- Retain this installed build as the upgrade baseline; do not uninstall or clear device data.

## Next integration gates
The inspected mobile permissions screen uses user_demo_01; permissions, intelligence and wallet clients previously resolved native requests to localhost:3000. No consumer sign-in/session flow was found among the inspected routes. The connection-error patch adds configurable HTTPS routing and visible permissions failures; it does not create an authenticated account integration.
Before setting EXPO_PUBLIC_API_URL for a real consumer environment, verify the Identity & Pseudonymization and Consent & Purpose Authorization contracts, authenticate requests using the established account service, derive identity from the authenticated session, and confirm server-side subject/purpose authorization. Never point the demonstration identity at production.
Test grant → restart → verify persisted decision → revoke → verify downstream denial, with authoritative backend audit evidence. A local toggle or screen navigation does not satisfy this gate.

Backend source findings at ff8b405: services/api/src/server.ts registers /v1/permissions/users/:user_id/* without authentication; services/api/src/permissions.ts uses in-memory Maps seeded with user_demo_01. The authenticated /v1/consent-events and /v1/metadata-batches routes instead use the separate Store.consents map, which defaults to memoryStore(). The mobile permission setters do not call /v1/consent-events. Therefore a demo permission decision is not evidence of collector consent enforcement or persistence across a service restart. Unify these paths under the authenticated subject and durable consent ledger before consumer validation.
