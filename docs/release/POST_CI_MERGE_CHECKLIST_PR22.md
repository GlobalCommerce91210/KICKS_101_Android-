# Post-CI Merge Checklist — PR #22

**PR:** #22 — KICK’S Mobile 0.2.6 upgrade  
**Branch:** `mobile/0.2.6-upgrade`  
**Base:** `main`

## Before declaring merge-ready

- [ ] Root npm lockfile committed.
- [ ] Latest `quality` workflow is green.
- [ ] `npm ci` completed.
- [ ] Typecheck completed successfully.
- [ ] Existing automated tests completed successfully.
- [ ] Collector harness, if implemented in PR #22, completed successfully.
- [ ] Native Android build completed.
- [ ] Expo Android runtime validated.
- [ ] Expo/iOS runtime validated.
- [ ] Android continuity upgrade validated.
- [ ] Reward/progression behavior validated.
- [ ] DataStorm → KICK’S event path validated.
- [ ] Night/Light and design-token checks completed.
- [ ] Navigation/route regression checks completed.
- [ ] Vercel/API status is green or explicitly dispositioned.
- [ ] Branch has no unexpected divergence from `main`.
- [ ] PR description reflects actual evidence.
- [ ] Collector regression checklist is updated with evidence.
- [ ] No unchecked release blocker is being waived silently.

## Merge action

Only after the required gates pass:

- [ ] Mark PR #22 ready for review.
- [ ] Complete required review/approval process.
- [ ] Merge `mobile/0.2.6-upgrade` into `main`.
- [ ] Confirm merge commit/strategy.
- [ ] Re-run main-branch CI.

## Tag action

After main validation:

- [ ] Confirm final mobile version remains `0.2.6`.
- [ ] Confirm Android remains `versionCode 9`.
- [ ] Create `v0.2.6-mobile`.
- [ ] Record tag SHA.
- [ ] Trigger release build workflow if configured.

## After merge

- [ ] Validate main-branch Android build.
- [ ] Validate main-branch Expo/iOS build.
- [ ] Validate API/Vercel production status.
- [ ] Record release artifacts.
- [ ] Begin RC/device validation according to the 0.2.6 release candidate plan.

## Current known blocker

At the time this checklist was created, GitHub Actions run #85 failed during `actions/setup-node` because no supported root lockfile was present. That blocker must be superseded by a later green run before merge.
