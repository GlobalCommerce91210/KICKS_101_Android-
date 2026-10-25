# KICK’S Mobile 0.2.6 — RuntimeScheduler.h Patch Analysis

## Goal

Understand what a build-settings or source patch would actually change, and why any patch remains a last-resort compatibility measure rather than the default fix.

## 1. What RuntimeScheduler.h is doing

The failing file is part of the Expo JSI integration layer used alongside the current React Native scheduling/runtime stack.

It exposes C++ types to Swift through Swift/C++ interoperability.

Under Swift 6.2 / Xcode 26.x, the compiler applies stricter import and ownership rules to the C++ surface.

## 2. Why the current build fails

KICK’S currently resolves:

- `expo-modules-core@57.0.18`
- `expo-modules-jsi@57.1.0`
- React Native `0.86.2`

The current iOS validation failure is raised in:

```text
expo-modules-jsi/apple/Sources/ExpoModulesJSI-Cxx/include/RuntimeScheduler.h
```

The compiler rejects `SWIFT_RETURNS_RETAINED` on two `RuntimeScheduler` constructors because those constructor results are not accepted as eligible `SWIFT_SHARED_REFERENCE` types under the active Swift toolchain.

The same failure pattern has been reported upstream on an SDK 57 blank project, which supports treating this primarily as an upstream compatibility issue rather than a KICK’S business-logic defect.

## 3. What a generic Podfile/build-settings patch would do

A build-settings block that forces:

```ruby
config.build_settings['CLANG_CXX_LANGUAGE_STANDARD'] = 'gnu++20'
config.build_settings['CLANG_CXX_LIBRARY'] = 'libc++'
config.build_settings['CLANG_ENABLE_MODULES'] = 'YES'
config.build_settings['CLANG_ENABLE_OBJC_ARC'] = 'YES'
```

would standardize several Clang/C++ build settings across CocoaPods targets.

That can help some native-module compatibility problems.

However, it does **not** change Swift 6.2 ownership/interoperability rules or remove the invalid `SWIFT_RETURNS_RETAINED` annotations that trigger the observed failure.

Therefore:

> The generic Podfile settings block is a possible broad native-build mitigation, but it is not a verified fix for this specific RuntimeScheduler.h error.

## 4. What a deterministic source patch would do

A version-scoped source patch would alter the exact upstream header that fails to compile.

For the currently observed failure, upstream reports indicate a patch can remove the `SWIFT_RETURNS_RETAINED` annotations from the affected `RuntimeScheduler` constructors.

A valid temporary patch must:

- target exactly the resolved package/version;
- be applied automatically and reproducibly after install;
- fail loudly if the expected source no longer matches;
- be documented as temporary upstream-compatibility remediation;
- be removed once Expo publishes an official compatible package.

Do not manually edit `node_modules` as an unreproducible release fix.

## 5. Resolution order

Use this order:

1. official Expo-compatible package fix;
2. approved/reproducible alternate build gate such as EAS, if configured and validated for KICK’S;
3. deterministic, version-scoped source patch if local Xcode 26.x compilation remains mandatory.

This keeps RuntimeScheduler.h in upstream territory while still giving the release a controlled fallback path.
