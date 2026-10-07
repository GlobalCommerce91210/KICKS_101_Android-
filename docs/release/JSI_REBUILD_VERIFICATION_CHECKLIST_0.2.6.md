# KICK’S Mobile 0.2.6 — JSI Rebuild Verification Checklist

Use this after an upstream package fix or approved deterministic patch is applied.

## Clean JS/native state

From repository root:

- [ ] remove generated iOS project: `rm -rf apps/mobile/ios`
- [ ] remove installed JS dependencies: `rm -rf node_modules`
- [ ] reinstall exactly from lockfile: `npm ci`

## Regenerate iOS

From `apps/mobile`:

- [ ] run `npx expo prebuild --platform ios --clean --no-install`
- [ ] confirm `apps/mobile/ios/` is recreated successfully
- [ ] confirm no Expo config/prebuild errors

## CocoaPods

From `apps/mobile/ios`:

- [ ] run `pod install`
- [ ] no missing Expo/RN pods
- [ ] no dependency-resolution failure
- [ ] generated workspace exists

Warnings alone are not a release failure unless they identify an actual incompatibility.

## Local Xcode validation, if used

- [ ] open the generated `.xcworkspace`
- [ ] build the same scheme/configuration used by CI for iOS Simulator
- [ ] no Swift/C++ interop errors
- [ ] no `RuntimeScheduler.h` failure
- [ ] no new ExpoModulesJSI compile blocker

A local simulator launch is a separate runtime test; RC1 CI currently proves compilation, not interactive launch.

## GitHub ios-validation

- [ ] `npm ci` PASS
- [ ] mobile typecheck PASS
- [ ] Xcode 26.2 / Swift 6.2 selected
- [ ] Expo config validation PASS
- [ ] iOS prebuild PASS
- [ ] CocoaPods install PASS
- [ ] unsigned Xcode Simulator build PASS
- [ ] generated iOS evidence metadata step PASS
- [ ] evidence artifact upload PASS

## Lockfile and version evidence

- [ ] resolved `expo-modules-jsi` version recorded
- [ ] resolved `expo-modules-core` version recorded
- [ ] Expo SDK line recorded
- [ ] React Native version recorded
- [ ] candidate commit SHA recorded
- [ ] any temporary patch version/scope recorded

## Verification rule

Treat the JSI rebuild as verified only when the exact RC1 candidate commit completes the approved iOS structural build path with green evidence.
