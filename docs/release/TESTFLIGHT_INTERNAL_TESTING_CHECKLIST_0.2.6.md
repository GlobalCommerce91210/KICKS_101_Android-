# KICK’S Mobile 0.2.6 — TestFlight Internal Testing Checklist

**Channel:** TestFlight Internal  
**Phase:** post-RC1 / RC2 distribution validation

## Build and distribution

- [ ] signed iOS distribution build generated
- [ ] archive/build identity recorded
- [ ] bundle identifier verified
- [ ] signing team verified
- [ ] entitlements/capabilities verified
- [ ] App Store Connect app record confirmed
- [ ] build uploaded successfully
- [ ] internal tester group configured

## Core flows

- [ ] launch succeeds
- [ ] authentication/session persistence succeeds
- [ ] activity/feed loads without fatal state
- [ ] progression/ladder is visible and responsive
- [ ] rewards state is accurate
- [ ] partner actions function for supported flows
- [ ] profile/identity changes persist where implemented

## Shared-state / collector-facing behavior

Validate only behavior implemented on iOS.

- [ ] supported verified-event/shared-state results appear
- [ ] reward outputs match expected values
- [ ] progression deltas match expected values
- [ ] no duplicate business outcome
- [ ] partner result matches expected behavior

Do not claim Android-specific device collector capabilities are validated on iOS if they do not exist there.

## Offline/recovery

- [ ] temporary offline state is handled
- [ ] reconnect succeeds
- [ ] supported queued state reconciles
- [ ] no duplicate reward/progression
- [ ] no unintended data loss

## UX and stability

- [ ] navigation stable
- [ ] Night/Light behavior correct where implemented
- [ ] rounded/tokenized visual system consistent
- [ ] animations do not duplicate
- [ ] no blocking crash
- [ ] no repeatable launch failure
- [ ] no severe memory/stability issue in normal test session

## Feedback handling

For every issue record:
- build number
- device/iOS version
- steps to reproduce
- expected result
- actual result
- screenshot/video if useful
- severity
- release-blocking status

## Internal TestFlight exit

- [ ] no open release-blocking issue
- [ ] required RC2 iOS flows green
- [ ] build identity recorded
- [ ] release notes match tested behavior
