# KICK’S Mobile 0.2.6 Release Candidate Plan

## Release objective

Move KICK’S Mobile from the 0.2.6 upgrade branch through reproducible build validation, feature validation, device continuity testing, and final release without breaking the One Spec architecture.

## RC1 — Structural / executable baseline

### Scope

- Root npm lockfile.
- Deterministic `npm ci`.
- CI workflow restored.
- Typecheck.
- Existing automated tests.
- Collector test-harness implementation where ready.
- Native Android build.
- Expo configuration validation.
- API/Vercel dependency/build validation.

### Exit criteria

- CI setup and dependency install are green.
- No unresolved workspace/lockfile mismatch.
- Typecheck and existing tests are green.
- Android build produces a verifiable 0.2.6 artifact.
- Any introduced collector harness runs deterministically.
- Major infrastructure blockers are identified and dispositioned.

## RC2 — Feature / behavioral validation

### Scope

- Partner-action reward tuning.
- Verified Action Preview, if retained in 0.2.6 scope.
- Ladder/progression behavior.
- Reward unlock consistency.
- Engagement recommendations.
- Offline/reconnect behavior.
- Duplicate/replay protection.
- Android/Expo parity.
- iOS runtime behavior.

### Exit criteria

- Same canonical event produces one business outcome.
- Reward/progression state is idempotent.
- Offline replay does not duplicate rewards.
- Required screens/navigation behave consistently.
- Android and iOS/Expo expose equivalent consumer-facing state for the tested flows.

## RC Final — Release readiness

### Scope

- Full regression pass.
- Performance/stability evidence.
- Android in-place continuity upgrade.
- iOS release build validation.
- Android internal-testing build.
- Final changelog/release notes.
- Main-branch validation.
- Release tag preparation.

### Exit criteria

- No open release-blocking defect.
- Required CI/build/runtime gates are green.
- Artifact identity and signing continuity are recorded.
- Release notes match actual shipped behavior.
- `v0.2.6-mobile` points to the approved release commit.

## Non-goals

- No new repository.
- No migration away from `KICKS_101_Android-/apps/mobile`.
- No breaking shared agent/event contract changes.
- No feature expansion that bypasses collector/consent/reward invariants.
- No tag based only on documentation completion.

## Evidence bundle

For each RC, record:

- Git commit SHA.
- CI run ID/URL.
- Build artifact reference/hash.
- Android versionName/versionCode.
- Signing identity evidence where continuity matters.
- Test summary.
- Known deviations/waivers.
- Release decision.
