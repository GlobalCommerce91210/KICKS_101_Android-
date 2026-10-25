# KICK’S Mobile 0.2.6 — Podfile Patch Assessment

**PR:** #22  
**RC1 status:** BLOCKED on iOS native compile

## Proposed block

A generic Podfile `post_install` block that forces:

- `CLANG_CXX_LANGUAGE_STANDARD = gnu++20`
- `CLANG_CXX_LIBRARY = libc++`
- `CLANG_ENABLE_MODULES = YES`
- `CLANG_ENABLE_OBJC_ARC = YES`

was evaluated as a possible mitigation.

## Decision

**Do not adopt this block as the RC1 fix for the current `RuntimeScheduler.h` failure.**

The observed error is not a missing C++ language-standard configuration. The compiler rejects `SWIFT_RETURNS_RETAINED` on two `RuntimeScheduler` constructors inside `expo-modules-jsi`.

The current failure occurs after:

- Xcode toolchain selection
- Expo prebuild
- CocoaPods installation

and during compilation of `ExpoModulesJSI`.

## Current dependency evidence

The current root lockfile resolves:

- `expo-modules-core@57.0.18`
- `expo-modules-jsi@57.1.0`

with `expo-modules-core` depending on `expo-modules-jsi~57.1.0`.

## Approved remediation order

1. Prefer an official SDK 57-compatible Expo package fix when available.
2. If release policy permits, evaluate a reproducible EAS iOS build as an approved alternate structural gate.
3. If local Xcode 26.x compilation is mandatory before an upstream fix exists, use a deterministic version-scoped patch that removes the invalid `SWIFT_RETURNS_RETAINED` annotations from the affected constructors.
4. Re-run the complete iOS structural workflow on the exact candidate SHA.

## Guardrails

- Do not modify `node_modules` by hand without a committed/reproducible patch mechanism.
- Do not mark RC1 green because CocoaPods succeeds.
- Do not add unrelated compiler flags and call the issue resolved without a green simulator build.
- Do not promote to RC2 until the approved iOS structural gate is green.
