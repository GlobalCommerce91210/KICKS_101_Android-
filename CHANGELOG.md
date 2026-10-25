# Changelog

## 0.2.6 — KICK’S Mobile Hub

Branch: `mobile/0.2.6-upgrade`  
Canonical app: `GlobalCommerce91210/KICKS_101_Android-/apps/mobile`  
Package: `@kicks/mobile`

### Implemented in this upgrade branch

- Advanced `@kicks/mobile` from `0.2.5` to `0.2.6`.
- Advanced Expo app metadata from `0.2.5` to `0.2.6`.
- Aligned Android `versionName` to `0.2.6`.
- Set Android `versionCode` to `9` for continuity-safe in-place upgrade behavior.
- Preserved `KICKS_101_Android-/apps/mobile` as the only active Expo/React Native mobile source of truth.
- Preserved the One Spec hybrid model: native Android + Expo/React Native + shared system logic.

### Architecture guardrails

0.2.6 must not introduce breaking changes to shared agent contracts, the verified-action/event contract, or the existing navigation contract. New event types and reward rules must be additive.

### 0.2.6 validation targets

The following remain release-gate checks and should not be treated as completed until verified by CI/build/runtime evidence:

- Night/Light contrast and design-token consistency.
- Rounded-corner styling consistency.
- Level-Up Ladder progression, animation, and reward mapping.
- Onboarding copy and verified-action explanation.
- Expo Router journey alignment for onboarding, feed, ladder, rewards, partners, and profile.
- DataStorm → KICK’S event flow.
- Reward/progression behavior.
- Native Android build.
- Android continuity upgrade using the existing application identity and signer.
- iOS/Expo runtime validation.

### Release gate

Do not merge to `main` or create `v0.2.6-mobile` until required CI/build/runtime checks are green.

### Repository alignment

`KICK_S_App/apps/mobile` is legacy and receives no new KICK’S mobile development. All active work remains in `KICKS_101_Android-/apps/mobile`.
