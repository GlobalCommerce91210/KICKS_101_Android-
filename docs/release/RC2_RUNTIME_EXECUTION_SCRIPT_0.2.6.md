# KICK’S Mobile 0.2.6 — RC2 Runtime Execution Script

**Status:** READY TO EXECUTE AFTER RC1 STRUCTURAL GREEN  
**Branch:** `mobile/0.2.6-upgrade`  
**PR:** #22

## Preconditions

Do not start RC2 sign-off until the latest candidate commit has:

- green `quality`
- green `ios-validation`
- no unresolved structural build blocker

At the time this document was added, quality was green but iOS structural validation still had an unresolved `expo-modules-jsi` / Swift interop build failure.

## 1. Environment setup

Android:
- start approved emulator or connect approved physical device
- enable verbose non-sensitive app/collector logs
- verify `com.datastorm.kicks`
- verify 0.2.6 / versionCode 9

iOS:
- use the validated iOS Simulator build from RC1
- enable non-sensitive application/runtime logs
- confirm the tested build commit matches the RC2 candidate

Backend/DataStorm:
- confirm staging/API health
- confirm consent/identity test prerequisites
- use a test event source consistent with the implemented event contract

## 2. Baseline session

On both platforms:

1. Launch KICK’S.
2. Authenticate with the intended test identity/session.
3. Confirm the initial activity/feed state.
4. Confirm rewards/progression baseline.
5. Record starting state before firing events.

Pass:
- no launch failure
- no fatal runtime error
- no unexpected duplicate state
- same logical starting state for the cross-platform test case

## 3. Verified event set

Exercise only event types supported by the current implementation.

Suggested coverage:

```text
partner-action: view
partner-action: click
partner-action: purchase
system-action: login
system-action: profile-update
value-action: representative low/medium/high values
```

For each event record:
- event id
- event type
- timestamp
- platform
- expected reward
- actual reward
- expected progression delta
- actual progression delta
- partner outcome
- duplicate/replay outcome

Validate:
- accepted event processed once
- no missing downstream state
- no duplicate reward/progression
- partner output consistent
- Android/iOS shared business state agrees

## 4. UI parity sweep

Compare equivalent implemented surfaces:

- activity/feed
- ladder/progression
- rewards
- partner actions
- profile/identity

Validate:
- Night/Light behavior where implemented
- token/radius consistency
- navigation outcome
- one-time transition animation
- collector/shared-state result rendered correctly
- no platform-only duplicate state

## 5. Offline/reconnect

1. Establish valid session.
2. Disable networking.
3. Exercise 10 supported offline-eligible events.
4. Restore networking.
5. Observe retry/reconnect.

Validate:
- supported events queue
- reconnect flushes correctly
- no replay double-award
- no duplicate progression increment
- no silent loss within supported queue limits

## 6. Performance burst

Target:

```text
100 representative events / 10 seconds
```

Capture:
- accepted count
- processed count
- duplicate count
- errors
- UI responsiveness
- memory trend
- crash/ANR result
- queue/backpressure behavior

## 7. Regression sign-off

Update:

```text
docs/collector/COLLECTOR_REGRESSION_CHECKLIST_0.2.6.md
```

Attach/record:
- Android runtime logs
- iOS runtime logs
- collector/shared-state logs
- tested commit SHA
- build identifiers
- deviations/waivers

## RC2 exit

- [ ] runtime intake proven
- [ ] reward behavior proven
- [ ] progression behavior proven
- [ ] partner behavior proven
- [ ] offline/reconnect proven
- [ ] Android/iOS parity proven
- [ ] load/stability evidence recorded
- [ ] regression checklist updated from evidence
