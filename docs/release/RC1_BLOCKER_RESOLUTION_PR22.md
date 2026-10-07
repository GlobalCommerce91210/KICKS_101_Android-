# RC1 Blocker Resolution — iOS Validation

**Status:** RC1 remains incomplete.

## Blocker

The KICK’S iOS structural build fails inside `expo-modules-jsi@57.1.0` during the `ExpoModulesJSI` xcframework build.

The failing source is `RuntimeScheduler.h`, where Swift 6.2+ rejects `SWIFT_RETURNS_RETAINED` on two constructors.

## Verified boundary

Passing before the failure:

- dependency install
- mobile TypeScript validation
- Xcode 26.2 / Swift 6.2 selection
- Expo configuration
- iOS prebuild
- CocoaPods installation

Failing:

- unsigned Xcode Simulator compilation

## Interpretation

This failure is consistent with an upstream Expo SDK 57 / Swift 6.2+ interop issue. The current lockfile resolves `expo-modules-jsi@57.1.0`; this is not caused by missing KICK’S application code or an uninstalled direct JSI dependency.

## Resolution path

1. Prefer an official Expo SDK 57-compatible fix if published.
2. Otherwise evaluate an approved EAS cloud-build gate if the project is configured for EAS and produces reproducible evidence.
3. If local Xcode 26.x compilation is mandatory before an upstream release, use a deterministic, version-scoped patch for `expo-modules-jsi@57.1.0` rather than an ad-hoc edit.
4. Re-run the complete iOS structural workflow on the exact candidate SHA.

## Promotion rule

RC2 begins only after the approved iOS structural build gate is green and evidence is attached to PR #22.

Until then:

- PR #22 remains draft
- RC1 remains blocked
- no merge
- no release tag
- no TestFlight promotion
