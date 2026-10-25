# Collector Regression Checklist — KICK’S Mobile 0.2.6

**Status:** Release-gate checklist  
**Branch:** `mobile/0.2.6-upgrade`  
**Canonical app:** `KICKS_101_Android-/apps/mobile`

## Schema & contracts

- [ ] Verified Action event contract is unchanged or only additively extended.
- [ ] No existing required field was removed.
- [ ] No incompatible field-type change was introduced.
- [ ] Existing agent/shared-processing interfaces remain compatible.
- [ ] New event types, if any, are additive.
- [ ] New reward rules, if any, are additive and idempotent.

## Collector behavior

- [ ] Valid events are accepted.
- [ ] Invalid schema is rejected before downstream processing.
- [ ] Timestamp drift follows the implemented policy.
- [ ] Duplicate event identity does not cause duplicate dispatch.
- [ ] Supported load does not silently drop events.
- [ ] Offline-eligible events queue correctly.
- [ ] Reconnect processing is idempotent.
- [ ] Process restart/rehydration does not duplicate state.
- [ ] Consent/policy gates remain deny-by-default where required.

## Shared processing / agent behavior

- [ ] Reward processing occurs once per eligible event.
- [ ] Progression updates the ladder correctly.
- [ ] Engagement recalculates only when appropriate.
- [ ] Partner-action processing respects eligibility and consent.
- [ ] Retry/replay behavior produces the same final state.
- [ ] Android and Expo do not each independently award the same event.

## UI behavior

- [ ] Activity/feed shows each accepted verified action once.
- [ ] Progression/ladder state is correct.
- [ ] Transition animation runs once per real progression transition.
- [ ] Reward state/unlocks appear once.
- [ ] Partner-action state renders correctly.
- [ ] Profile/user-level state reflects canonical shared state.
- [ ] Rehydration does not present stale events as new.
- [ ] No duplicate renders caused by duplicate event subscriptions.

## Cross-platform consistency

- [ ] Expo and Android native preserve the same canonical event identity.
- [ ] Shared processing produces equivalent business outcomes across platform paths.
- [ ] No divergence in reward balances.
- [ ] No divergence in progression state.
- [ ] Navigation behavior remains aligned with One Spec.
- [ ] Android-specific collection does not bypass shared policy/state rules.

## 0.2.6 versioning

- [x] `@kicks/mobile` package version = `0.2.6` on the upgrade branch.
- [x] Expo app version = `0.2.6` on the upgrade branch.
- [x] Android `versionName` = `0.2.6` on the upgrade branch.
- [x] Android `versionCode` = `9` on the upgrade branch.
- [ ] CI/typecheck/test gates green.
- [ ] Native Android build verified.
- [ ] Expo Android runtime verified.
- [ ] Expo/iOS runtime verified.
- [ ] In-place Android continuity upgrade verified.
- [ ] Release tag `v0.2.6-mobile` created only after gates pass.

## Repository alignment

- [x] `KICKS_101_Android-/apps/mobile` remains canonical.
- [x] `KICK_S_App/apps/mobile` remains legacy/no-new-work.
- [ ] No 0.2.6 implementation work is routed to a new repository.

## Evidence required before release

- [ ] CI run URL/ID recorded.
- [ ] Android build artifact identity recorded.
- [ ] Package ID confirmed as `com.datastorm.kicks`.
- [ ] VersionName/versionCode confirmed from built artifact.
- [ ] Signer continuity confirmed for in-place upgrade target.
- [ ] Collector/event-path test evidence recorded.
- [ ] Reward/progression evidence recorded.
- [ ] Offline/reconnect evidence recorded.
- [ ] UI/navigation regression evidence recorded.

## Release decision

Do **not** merge/tag solely because this checklist exists. The unchecked items are explicit release gates and require build/runtime evidence.
