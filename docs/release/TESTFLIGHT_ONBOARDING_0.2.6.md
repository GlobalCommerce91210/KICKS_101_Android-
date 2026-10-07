# KICK’S Mobile 0.2.6 — TestFlight Onboarding

**Purpose:** Define the iOS handoff and TestFlight promotion process after RC1/RC2 validation.

## Important boundary

The canonical product source remains:

```text
KICKS_101_Android-/apps/mobile
```

The iOS native project is generated from the Expo workspace. It is not a second source of product logic.

For the current Expo prebuild, the generated workspace is expected under:

```text
apps/mobile/ios/*.xcworkspace
```

The current CI-generated workspace name observed during validation is `KICKS.xcworkspace`. Re-run Expo prebuild before assuming a local generated path/name.

## 1. Prepare iOS release environment

Required:

- compatible macOS/Xcode version for the active Expo/RN dependency graph
- Apple Developer account/team access
- App Store Connect access
- final bundle identifier decision
- required capabilities/entitlements documented

Do not commit Apple signing certificates, private keys, or provisioning secrets to GitHub.

## 2. Generate/refresh native iOS project

From the canonical mobile workspace:

```bash
cd apps/mobile
npx expo prebuild --platform ios
cd ios
pod install
```

Open the generated workspace, for example:

```text
apps/mobile/ios/KICKS.xcworkspace
```

Use the actual generated workspace name if it differs.

## 3. Configure signing and capabilities

In Xcode:

- select the approved Apple Developer Team
- confirm the final bundle identifier
- confirm provisioning/signing mode
- enable only capabilities actually required by 0.2.6
- verify entitlements
- verify deployment target
- verify app icons/assets

Capabilities such as push notifications or background modes should be enabled only if the shipped implementation requires them.

## 4. Archive

Use an approved Release configuration and generic iOS device destination.

Then:

- Product → Archive
- validate the archive
- inspect signing identity and entitlements
- upload through Xcode Organizer or the approved EAS/App Store Connect path

## 5. App Store Connect

- create or confirm the KICK’S app record
- confirm bundle ID association
- attach the uploaded build
- complete required compliance/metadata fields
- add internal testing group(s)

## 6. Internal TestFlight

Internal testing should validate the scoped 0.2.6 behavior, including:

- launch/authentication path
- collector-derived state presented correctly
- rewards/progression
- partner-action behavior
- navigation
- offline/reconnect where applicable
- crash/stability behavior

Do not claim collector behavior is validated on iOS if a device-level collector capability is Android-specific; validate the shared/cross-platform behavior actually implemented on iOS.

## 7. External TestFlight

After internal acceptance:

- submit the build for Beta App Review if required
- configure external tester groups
- provide concise tester instructions
- collect defects against the exact build number/version

Track:

- crash reports
- launch failures
- state-sync issues
- reward/progression discrepancies
- UI/navigation regressions

## Promotion gate

Do not promote a TestFlight build as the 0.2.6 release candidate until:

- [ ] RC1 structural gates are green
- [ ] RC2 runtime gates required for iOS are green
- [ ] signing and entitlements are verified
- [ ] bundle identity is final
- [ ] release notes match actual behavior
- [ ] build identity is recorded
