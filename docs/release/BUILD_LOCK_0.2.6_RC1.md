# KICK’S Mobile 0.2.6 — RC1 Build Lock

**Status:** LOCKED FOR RC1 VALIDATION  
**Branch:** `mobile/0.2.6-upgrade`  
**PR:** #22  
**Locked commit:** `6b3bde4174f6a4ffef07a37b0ff11f0e859458ac`  
**Functional version:** `0.2.6`  
**Android versionCode:** `9`

## Lock rule

No new product features, route changes, reward-model expansion, agent-contract changes, schema changes, or design-system expansion may enter this branch while RC1 validation is active.

Allowed changes are limited to:

- CI/build fixes required to make existing 0.2.6 behavior compile and validate.
- Test-harness fixes that do not alter production behavior.
- Documentation corrections that reflect verified repository state.
- Release-blocking compatibility fixes that preserve One Spec contracts.

## Locked architecture

- Canonical mobile source: `KICKS_101_Android-/apps/mobile`
- Package: `@kicks/mobile@0.2.6`
- Android native + Expo/React Native remain the One Spec mobile hub.
- `KICK_S_App/apps/mobile` remains legacy/no-new-work.
- Shared agent/event/navigation contracts remain non-breaking.
- Android and iOS must converge on the same consumer-facing state behavior.

## CI state at lock

- `quality #91`: PASS
- `ios-validation #2`: IN PROGRESS at lock time
- PR remains draft until remaining RC1 gates are green.

## Release rule

This lock is **not** a release tag and does not authorize merge.

Do not:
- merge PR #22,
- create `v0.2.6-mobile`,
- promote to TestFlight,
- or declare 0.2.6 released

until the remaining RC1 validation gates pass.

## Unlock conditions

The build may be unlocked only for:
1. a documented release-blocking defect,
2. a required compatibility fix,
3. or the formal transition from RC1 to the next approved release stage.

Any unlock must update this file with the reason and resulting commit SHA.
