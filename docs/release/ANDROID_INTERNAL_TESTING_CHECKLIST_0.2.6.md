# KICK’S Mobile 0.2.6 — Android Internal Testing Checklist

**Package:** `com.datastorm.kicks`  
**Version:** `0.2.6`  
**versionCode:** `9`

## Build and artifact

- [ ] approved internal APK/AAB generated
- [ ] source commit SHA recorded
- [ ] package identity verified
- [ ] versionName verified
- [ ] versionCode verified
- [ ] signing certificate verified
- [ ] SHA-256 recorded

If EAS is configured and approved:

```bash
eas build --platform android --profile internal
```

Otherwise use the existing native Gradle/internal path. Do not invent an EAS profile merely to satisfy documentation.

## Install / continuity

- [ ] approved test device connected
- [ ] installed package identity recorded
- [ ] installed versionCode recorded
- [ ] installed signing identity recorded
- [ ] candidate versionCode > installed versionCode where continuity applies
- [ ] signer compatible
- [ ] in-place upgrade succeeds

Continuity path where appropriate:

```bash
adb install -r <approved-0.2.6-apk>
```

Do not uninstall, clear app data, rewrite collector identity/subject, or erase protected device data to force an install.

## Core flows

- [ ] launch/session persistence
- [ ] activity/feed stability
- [ ] progression/ladder behavior
- [ ] rewards accuracy
- [ ] partner-action behavior
- [ ] profile/identity persistence

## Collector/runtime

- [ ] supported events processed
- [ ] no dropped accepted events
- [ ] no duplicate dispatch
- [ ] consent/policy behavior correct
- [ ] reward output correct
- [ ] progression output correct
- [ ] replay/idempotency correct

## Offline/reconnect

- [ ] supported offline state queues
- [ ] reconnect flush succeeds
- [ ] no double processing
- [ ] final state reconciles correctly

## Performance

Target scenario:

```text
100 representative events / 10 seconds
```

- [ ] no crash/ANR
- [ ] UI remains usable
- [ ] no severe memory spike
- [ ] queue/backpressure behavior acceptable
- [ ] no event duplication caused by load

## Cross-platform parity

- [ ] reward state agrees with iOS
- [ ] progression state agrees with iOS
- [ ] partner outcome agrees with iOS
- [ ] navigation outcome equivalent
- [ ] shared UI states equivalent within platform conventions

## Exit

- [ ] no Android release blocker
- [ ] continuity evidence complete where required
- [ ] runtime evidence attached/recorded
- [ ] regression checklist updated
