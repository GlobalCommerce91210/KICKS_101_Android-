# Expo SDK 57 / JSI Compatibility Matrix — KICK’S 0.2.6

This matrix contains only compatibility claims supported by the current KICK’S build evidence or current upstream Expo issue evidence.

| Component / combination | Evidence status | KICK’S interpretation |
|---|---|---|
| Expo SDK 57 + React Native 0.86.x | In use | Current KICK’S dependency line |
| `expo-modules-core@57.0.18` | Resolved | Current lockfile |
| `expo-modules-jsi@57.1.0` | Resolved | Current lockfile; transitive dependency |
| Xcode 26.2 / Swift 6.2 + `expo-modules-jsi@57.1.0` | Failing | Reproduced by KICK’S and by upstream SDK 57 reports |
| Failure location | Confirmed | `RuntimeScheduler.h` constructors with `SWIFT_RETURNS_RETAINED` |
| Expo config / prebuild / Pods | Passing before failure | Not sufficient to mark RC1 green |
| Unsigned Xcode Simulator compile | Failing | Current RC1 blocker |
| EAS cloud build for same upstream issue | Reported successful upstream | Must be verified on KICK’S before use as a release gate |
| Generic Podfile C++20/ARC settings | Not verified as a fix | Do not treat as approved remediation |
| Deterministic source patch removing invalid annotations | Reported effective upstream | Acceptable temporary option only if version-scoped and reproducible |
| Older exact `expo-modules-jsi` pin | Reported effective in some upstream reproductions | Requires full dependency/runtime compatibility validation before adoption |

## Important non-claims

This document does **not** claim:

- Xcode 14 or 15 are fully compatible with the current KICK’S SDK 57 graph.
- every Xcode 16.x version exhibits the same behavior.
- `gnu++20` alone resolves this issue.
- an EAS build has already passed for KICK’S.
- downgrading `expo-modules-jsi` is safe without validating `expo-modules-core`, React Native, Expo modules, and runtime behavior.

## RC1 conclusion

The KICK’S branch remains structurally blocked until the approved iOS build path produces green evidence on the candidate SHA.
