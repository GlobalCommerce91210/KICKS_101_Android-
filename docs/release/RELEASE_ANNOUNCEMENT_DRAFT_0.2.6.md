# KICK’S Mobile 0.2.6 — Release Announcement Draft

> **DRAFT — DO NOT PUBLISH UNTIL 0.2.6 IS RELEASED**
>
> Replace all future-tense/placeholder release details with verified production facts before publication.

## KICK’S Mobile 0.2.6

KICK’S Mobile 0.2.6 brings the Android and iOS experience further into the One Spec mobile architecture, with a stronger release pipeline and cross-platform validation model.

### Planned release highlights

#### Unified mobile architecture

- canonical KICK’S mobile development centered in `KICKS_101_Android-/apps/mobile`
- Android native + Expo/React Native aligned under the One Spec model
- shared product contracts and cross-platform UX expectations

#### Collector and runtime validation

The 0.2.6 release process is designed to verify:

- supported verified-event intake behavior
- reward/progression consistency
- partner-action behavior
- reconnect/replay behavior
- Android/iOS shared-state parity

Only claims proven by RC2 evidence should remain in the published announcement.

#### iOS validation pipeline

0.2.6 introduces an explicit iOS validation workflow covering:

- Expo configuration
- iOS prebuild
- CocoaPods integration
- Xcode Simulator compilation
- release-evidence collection

Signed distribution/TestFlight claims should be added only after those stages complete successfully.

#### Android release validation

The release process includes:

- Android version continuity
- in-place upgrade validation where required
- runtime/regression testing
- artifact identity/signing verification
- cross-platform parity checks

#### Developer and release engineering

- Node 24 CI
- reconciled root npm lockfile
- deterministic `npm ci`
- build-before-test quality sequencing
- dedicated iOS validation workflow
- RC1 structural and RC2 runtime release gates
- formal build-lock and evidence process

## Distribution

Before publication, replace this section with the distribution channels actually used for the release, such as:

- Android internal/production track
- TestFlight / App Store
- EAS Build, if used
- production API/Vercel deployment, if in scope

Do not state a distribution channel shipped unless verified.

## Final publication checklist

- [ ] PR #22 merged
- [ ] main CI green
- [ ] release tag created
- [ ] Android release artifact verified
- [ ] iOS release artifact verified
- [ ] published claims match RC2 evidence
- [ ] distribution claims match actual channels
- [ ] release date inserted
- [ ] download/store links inserted if applicable

## Publication version

After every gate above is satisfied, this draft may be converted into a public announcement beginning with:

> **KICK’S Mobile 0.2.6 is now live.**

That sentence must not be published before release evidence exists.
