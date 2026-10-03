# KICK’S Mobile 0.2.6 — Android Internal Testing Plan

**Phase:** RC2 / release validation  
**Package:** `com.datastorm.kicks`  
**Functional version:** `0.2.6`  
**Android versionCode:** `9`

## Objective

Validate the Android implementation on emulator/approved physical devices while preserving the One Spec contracts and in-place upgrade continuity.

## 1. Build an internal Android artifact

Use the repository’s approved Android/Expo build path.

If EAS is configured with an internal Android profile:

```bash
eas build --platform android --profile internal
```

If EAS is not yet configured, use the existing native Gradle/internal build path rather than inventing credentials or profiles.

Record:

- source commit SHA
- package name
- versionName
- versionCode
- signing identity
- artifact SHA-256

## 2. Device coverage

Use a representative matrix based on devices actually available to the project.

At minimum, include:

- one current Android reference/emulator configuration
- one mid-tier physical device where available
- the continuity-upgrade target device where preservation matters

Do not uninstall, clear app data, rewrite collector identity/subject, or erase protected test datasets merely to get an install to pass.

## 3. In-place upgrade validation

For the approved continuity target:

- verify installed package is `com.datastorm.kicks`
- verify installed versionCode/signing identity
- confirm new artifact versionCode is greater than installed versionCode
- confirm signer compatibility
- perform the approved in-place upgrade path

Preferred continuity install when using ADB:

```bash
adb install -r <approved-0.2.6-apk>
```

If signing does not match, stop and investigate. Do not solve signature mismatch by uninstalling the app or clearing data.

## 4. Collector/runtime validation

Exercise implemented Verified Action/collector paths.

Validate:

- no dropped accepted events
- no duplicate dispatch
- consent/policy enforcement
- reconnect/retry behavior
- durable state where required
- reward/progression state remains idempotent

## 5. Partner-action reward validation

For implemented partner-action cases, verify:

- base reward rule
- partner multiplier
- optional value scaling
- final reward
- ladder/progression delta
- partner-state/UI result

Compare against the same canonical expected behavior used for iOS/shared-state validation.

## 6. UI parity

Validate the active equivalent surfaces for:

- activity/feed
- ladder/progression
- rewards
- partner actions
- profile

Check:

- Night/Light behavior where implemented
- rounded/tokenized visual system
- state synchronization
- one-time transition animations
- navigation outcomes
- no duplicate reward presentation

## 7. Offline/reconnect

- disconnect networking
- exercise supported offline event behavior
- restore networking
- verify bounded queue/retry
- confirm no duplicate business outcome

## 8. Performance/stability

Representative load target:

```text
100 events / 10 seconds
```

Observe:

- dropped/duplicate events
- UI responsiveness
- jank
- memory trend
- native crashes/ANRs
- queue/backpressure behavior

## 9. Regression sign-off

Update:

```text
docs/collector/COLLECTOR_REGRESSION_CHECKLIST_0.2.6.md
```

Record evidence for every completed item.

## Android internal-test exit criteria

- [ ] build artifact identity verified
- [ ] signing continuity verified
- [ ] in-place upgrade verified where required
- [ ] collector/runtime behavior verified
- [ ] reward/progression behavior verified
- [ ] partner-action behavior verified
- [ ] offline/reconnect behavior verified
- [ ] UI parity evidence recorded
- [ ] performance/stability evidence recorded
- [ ] no release-blocking Android defect remains
