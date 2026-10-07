# Swift Interop Resolution Plan — expo-modules-jsi

**Scope:** RC1 compatibility remediation only  
**Package currently resolved:** `expo-modules-jsi@57.1.0`

## Guardrail

Do not add a fictitious dependency version such as:

```json
"expo-modules-jsi": "latest-compatible"
```

The package is transitive through `expo-modules-core`, and the current lockfile already resolves the SDK 57 line to `57.1.0`.

Do not assume setting `CLANG_CXX_LANGUAGE_STANDARD=gnu++20` resolves this specific failure; the observed error is a Swift import/attribute validity error, not a C++ language-standard error.

## Resolution order

### Option 1 — Prefer an upstream-fixed Expo package when available

Check for an Expo SDK 57-compatible release that removes or corrects the invalid `SWIFT_RETURNS_RETAINED` usage.

If one exists:

1. update the appropriate Expo dependency through the supported Expo/npm path;
2. regenerate the root lockfile;
3. run `npm ci`;
4. re-run typecheck/build/tests;
5. regenerate iOS with Expo prebuild;
6. install Pods;
7. re-run `ios-validation`.

This is the preferred long-term fix.

### Option 2 — Use an approved EAS build path

Upstream reproduction reports indicate EAS cloud builds can succeed even when local Swift 6.2+ source compilation fails.

Before using this as the RC1 gate:

- confirm EAS project configuration exists;
- confirm the build uses the same source commit and dependency lock;
- confirm the resulting iOS build is reproducible and evidence is attached;
- update the RC1 policy so the approved cloud build replaces, rather than silently bypasses, the local Simulator compile gate.

Do not claim EAS success until an actual KICK’S build passes.

### Option 3 — Deterministic temporary source patch

If release timing requires local Xcode 26.x validation before an upstream Expo fix is available, use a deterministic patch mechanism against exactly `expo-modules-jsi@57.1.0`.

The upstream-reported source-level workaround is to remove `SWIFT_RETURNS_RETAINED` from the two `RuntimeScheduler` constructors.

Requirements:

- patch must be committed/reproducible;
- patch must be version-scoped to `57.1.0`;
- CI must fail if the expected source no longer matches;
- patch rationale must link to the upstream incompatibility;
- remove the patch once an official fixed package is adopted.

Do not edit `node_modules` manually without a reproducible patch step.

## Clean rebuild sequence

After any dependency or patch change:

```bash
rm -rf apps/mobile/ios
rm -rf node_modules
npm ci
cd apps/mobile
npx expo prebuild --platform ios --clean --no-install
cd ios
pod install
```

Then re-run the iOS validation workflow.

## Acceptance

The blocker is resolved only when the exact candidate commit produces:

- Expo config PASS
- iOS prebuild PASS
- CocoaPods PASS
- unsigned Simulator compile PASS
- evidence artifact upload PASS

Only then may RC1 be promoted.
