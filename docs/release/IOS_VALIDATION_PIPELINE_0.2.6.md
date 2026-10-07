# iOS Merge/Test Pipeline — KICK’S Mobile 0.2.6

**Status:** RC validation pipeline foundation  
**Canonical workspace:** `apps/mobile`  
**Package:** `@kicks/mobile@0.2.6`

## Purpose

Validate that the canonical Expo/React Native workspace can generate an iOS native project and compile an unsigned iOS Simulator build without introducing a second iOS source of truth.

## Current tooling rule

Use current Expo tooling:

- Local/native validation: `npx expo prebuild --platform ios`, CocoaPods, and `xcodebuild` / `npx expo run:ios`.
- Cloud/distribution builds: EAS Build with `eas build --platform ios`.

Do not use the legacy `expo build:ios` command as the 0.2.6 release path.

## Phase 1 — GitHub Actions simulator validation

Workflow:

```text
.github/workflows/ios-validation.yml
```

The initial pipeline:

1. Checks out the PR.
2. Uses Node 24.
3. Runs deterministic root `npm ci`.
4. Typechecks `@kicks/mobile`.
5. Records Xcode version.
6. Validates public Expo config.
7. Generates `apps/mobile/ios` with Expo prebuild.
8. Runs CocoaPods.
9. Dynamically discovers the generated Xcode workspace/scheme.
10. Builds for the iOS Simulator with code signing disabled.
11. Uploads non-sensitive validation evidence.

This is a compile/merge validation gate, not a signed App Store build.

## Phase 2 — Runtime simulator validation

After Phase 1 is green, add runtime checks for:

- app launch,
- route hierarchy,
- Night/Light theme behavior,
- reward/progression presentation,
- collector-derived application state,
- offline/reconnect behavior where supported on iOS,
- crash/red-screen detection.

## Phase 3 — EAS cloud build

Before enabling cloud distribution builds, configure the Expo/EAS project identity and Apple signing/credentials.

Production command:

```bash
eas build --platform ios --profile production
```

Simulator/preview builds can use an EAS profile with `ios.simulator: true`.

Do not store Apple signing secrets in the repository.

## Release gates

- [ ] Expo config resolves.
- [ ] iOS prebuild succeeds.
- [ ] CocoaPods install succeeds.
- [ ] Unsigned Simulator build succeeds.
- [ ] Bundle identifier is explicitly verified before distribution.
- [ ] Runtime navigation validated.
- [ ] Reward/progression parity validated.
- [ ] Collector/shared-state behavior validated.
- [ ] EAS project configuration completed before signed cloud build.
- [ ] Apple signing/entitlements validated before TestFlight.
- [ ] Final EAS production build reference recorded.

## One Spec constraint

The generated `ios/` project is a build artifact of `apps/mobile`; it does not become an independent source of KICK’S product logic. Cross-platform UI/business behavior remains rooted in the canonical Expo workspace and shared contracts.
