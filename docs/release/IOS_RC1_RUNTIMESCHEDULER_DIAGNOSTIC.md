# iOS RC1 Blocker — RuntimeScheduler.h Diagnostic

**Branch:** `mobile/0.2.6-upgrade`  
**PR:** #22  
**Status:** RC1 BLOCKED  
**Affected gate:** `ios-validation`

## Observed KICK’S failure

The iOS validation workflow reaches:

- dependency install
- mobile typecheck
- Xcode toolchain selection
- Expo config validation
- Expo iOS prebuild
- CocoaPods installation

and then fails during the unsigned Xcode Simulator build inside:

```text
[CP-User] Build ExpoModulesJSI xcframework
```

The failing header is:

```text
node_modules/expo-modules-jsi/apple/Sources/ExpoModulesJSI-Cxx/include/RuntimeScheduler.h
```

Observed compiler errors reject `SWIFT_RETURNS_RETAINED` on the `RuntimeScheduler` constructors because the compiler does not treat the constructor result as an eligible `SWIFT_SHARED_REFERENCE` return type.

## Resolved dependency state

Current root lockfile resolves:

- `expo-modules-core@57.0.18`
- `expo-modules-jsi@57.1.0`
- `expo-modules-core` requires `expo-modules-jsi~57.1.0`

Therefore this is not a missing-direct-dependency problem and should not be fixed by adding a placeholder such as `"latest-compatible"`.

## Upstream correlation

Expo has an open SDK 57 issue reproducing the same `RuntimeScheduler.h` failure under Swift 6.2+ on a blank project with `expo-modules-jsi@57.1.0`.

This strongly indicates an upstream Expo/Swift C++ interop incompatibility rather than a KICK’S application-code defect.

## Impact

- quality workflow: structurally healthy
- Expo config: PASS
- iOS prebuild: PASS
- CocoaPods: PASS
- native iOS compile: FAIL
- RC1: BLOCKED
- RC2: NOT STARTED

## Release posture

Do not:
- mark RC1 complete
- promote PR #22 to RC2
- merge PR #22
- tag `v0.2.6-mobile`

until the iOS build gate has a verified resolution or an explicitly approved alternate distribution/build path.
