# KICK’S Mobile 0.2.6 — RC2 Runtime Validation

**Branch:** `mobile/0.2.6-upgrade`  
**PR:** #22  
**Phase:** RC2  
**Purpose:** Prove runtime correctness after RC1 structural/build validation.

## Preconditions

RC2 begins only after the required RC1 structural gates are green or formally dispositioned.

Required RC1 evidence includes:

- deterministic `npm ci`
- workspace typecheck
- web/application build
- existing automated tests
- iOS prebuild
- CocoaPods install
- iOS Simulator compile validation
- reconciled lockfile
- approved RC1 build baseline

## 1. Initialize runtime test session

Prepare:

- Android emulator or approved physical Android test device
- iOS Simulator or approved iOS test device/build
- DataStorm-compatible verified-event test source
- verbose, non-sensitive collector/application logs
- clean test user/session state where appropriate

Do not erase protected production/device datasets to create a clean state.

## 2. Verified Action event set

Exercise representative event classes supported by the implemented contract.

Suggested coverage:

```text
partner-action: view
partner-action: click
partner-action: purchase
system-action: login
system-action: profile-update
value-action: representative low/medium/high value cases
```

Only use event types and fields that exist in the actual implemented schema. Do not add production behavior solely to make a draft fixture pass.

Validate:

- no dropped accepted events
- no duplicate downstream processing
- idempotent retry/replay behavior
- correct reward result
- correct progression result
- correct partner-state result
- correct engagement result where applicable

## 3. Cross-platform UI parity sweep

Validate the active One Spec surfaces represented in the shipped navigation model.

Target product concepts:

- activity/feed
- ladder/progression
- rewards
- partner actions
- profile/identity

Validate:

- Night/Light theme behavior where implemented
- token/radius consistency
- animation occurs once per real transition
- state is derived from canonical shared processing
- no platform-specific double-award behavior
- route outcomes are equivalent across Android and iOS

## 4. Offline/reconnect test

Procedure:

1. Establish a valid authenticated/consented test session.
2. Disconnect networking.
3. Exercise a bounded set of events eligible for offline retention.
4. Restore networking.
5. Observe queue/retry behavior.

Pass criteria:

- eligible events are queued according to the implemented contract
- reconnect flush is deterministic
- acknowledged events are not replayed as new rewards
- no duplicate ladder/progression increment
- no silent data loss inside the supported queue boundary

## 5. Load/performance test

Target scenario:

```text
100 representative events over 10 seconds
```

Measure where practical:

- event acceptance/processing count
- duplicate count
- UI responsiveness
- frame stability
- memory trend
- queue/backpressure behavior

The release gate is behavioral stability, not an arbitrary FPS number unless a concrete performance budget is defined elsewhere.

## 6. Regression sign-off

Update:

```text
docs/collector/COLLECTOR_REGRESSION_CHECKLIST_0.2.6.md
```

Mark an item complete only when evidence exists.

Record:

- commit SHA
- platform/build identity
- test date
- event fixture/set
- expected vs actual result
- logs/artifact reference
- deviations/waivers

## RC2 exit criteria

- [ ] collector/runtime intake proven
- [ ] retry/replay idempotency proven
- [ ] reward behavior proven
- [ ] progression behavior proven
- [ ] partner-action behavior proven
- [ ] offline/reconnect behavior proven
- [ ] Android/iOS parity proven for scoped flows
- [ ] performance/stability evidence recorded
- [ ] regression checklist updated from evidence
