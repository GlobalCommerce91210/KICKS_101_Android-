# CI Quality Gate Checklist — KICK’S Mobile 0.2.6

## Gate 1 — Node and lockfile

- [ ] Root `package-lock.json` exists.
- [ ] npm is the only active package manager.
- [ ] Node major version matches the supported project/CI policy.
- [ ] `actions/setup-node` completes with npm cache enabled.

## Gate 2 — Deterministic install

- [ ] `npm ci` completes successfully.
- [ ] Workspace manifests and lockfile are synchronized.
- [ ] No unresolved dependency or peer-dependency error blocks installation.

## Gate 3 — Typecheck

- [ ] Root `npm run typecheck` passes.
- [ ] `@kicks/mobile` typecheck passes.
- [ ] `@kicks/api` typecheck passes.
- [ ] No unresolved shared-module imports.

## Gate 4 — Existing tests

- [ ] Root `npm test` passes for all workspaces that expose a `test` script.
- [ ] Existing API tests remain green.
- [ ] No previously passing suite regresses.

## Gate 5 — Collector/Jest harness

- [ ] Mobile test runner is explicitly added before this gate is considered active.
- [ ] Jest/Expo configuration loads.
- [ ] Collector fixtures load.
- [ ] Schema/intake tests execute.
- [ ] Idempotency/replay tests execute.
- [ ] Reward/progression tests execute.
- [ ] UI state tests execute.

## Gate 6 — Android

- [ ] Gradle configuration resolves.
- [ ] Native Android build succeeds.
- [ ] `com.datastorm.kicks` package identity confirmed.
- [ ] `versionName 0.2.6` confirmed.
- [ ] `versionCode 9` confirmed.
- [ ] Instrumentation tests pass once introduced.
- [ ] In-place continuity upgrade is verified against the intended installed build.

## Gate 7 — Expo / iOS

- [ ] Expo configuration resolves.
- [ ] iOS prebuild/build process uses current supported Expo tooling.
- [ ] Bundle identifier and entitlements are validated.
- [ ] Simulator/device launch succeeds.
- [ ] Navigation, reward/progression, and collector-derived state are validated.

## Gate 8 — Vercel/API

- [ ] Vercel API deployment succeeds, or the failure is formally classified as non-blocking for the mobile release.
- [ ] Required environment variables are present.
- [ ] API health endpoint is green when applicable.

## Gate 9 — Artifacts and evidence

- [ ] CI run URL/ID recorded.
- [ ] Android artifact identity/hash recorded.
- [ ] iOS artifact/build reference recorded.
- [ ] Collector test evidence recorded.
- [ ] Regression checklist updated from evidence, not assumption.

## Gate 10 — Release control

- [ ] PR is moved out of draft only after required gates are green.
- [ ] Release tag is not created before merge validation.
- [ ] `v0.2.6-mobile` is created only after release criteria are satisfied.
