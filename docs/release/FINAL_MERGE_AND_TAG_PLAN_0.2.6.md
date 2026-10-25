# KICK’S Mobile 0.2.6 — Final Merge and Tag Plan

**PR:** #22  
**Branch:** `mobile/0.2.6-upgrade`  
**Target:** `main`  
**Release tag:** `v0.2.6-mobile`

## Pre-merge conditions

Do not merge until the approved release gates are green.

Required:
- [ ] RC1 quality green on final candidate
- [ ] RC1 iOS structural validation green on final candidate
- [ ] RC2 runtime evidence complete
- [ ] Android internal validation complete
- [ ] iOS/TestFlight internal validation complete if part of release path
- [ ] no open release-blocking defect
- [ ] release notes accurate
- [ ] PR description reflects actual evidence

External beta testing is required only if explicitly adopted as a 0.2.6 gate.

## 1. Synchronize with main

Preferred safest sequence:

1. Fetch latest `main`.
2. Compare branch against latest `main`.
3. Rebase or merge `main` according to repository convention.
4. Resolve conflicts without changing protected behavior.
5. Re-run required CI on the resulting candidate SHA.

Do not tag a pre-sync SHA.

## 2. Final candidate validation

Required on the exact merge candidate:
- [ ] quality green
- [ ] ios-validation green
- [ ] no unexpected changed files
- [ ] lockfile/manifests synchronized
- [ ] version remains 0.2.6
- [ ] Android versionCode remains 9
- [ ] release evidence references this SHA

## 3. Move PR out of draft

Only after final candidate validation:

- [ ] update PR description with RC1/RC2 evidence
- [ ] link runtime/build evidence
- [ ] mark PR ready for review
- [ ] obtain required review/approval

## 4. Merge PR #22

Use the repository’s approved merge strategy.

After merge:
- [ ] record main merge SHA
- [ ] confirm main CI starts
- [ ] wait for required main gates
- [ ] validate production API/Vercel state if in scope

## 5. Tag

Only after main validation:

```text
v0.2.6-mobile
```

The tag must point to the approved main release commit, not the feature branch.

Record:
- tag SHA
- source merge SHA
- release date
- release artifacts/build numbers

## 6. Production distribution

Use only configured/approved distribution paths.

Possible channels:
- Android native/EAS production build
- iOS EAS production build
- Xcode/TestFlight/App Store distribution

Do not state EAS is required unless configured and selected.

## 7. Publish release notes

Publish only verified claims.

Convert:

```text
docs/release/RELEASE_ANNOUNCEMENT_DRAFT_0.2.6.md
```

into the final public release announcement after release evidence exists.

## 8. Post-release monitoring

Monitor:
- collector/shared event flow
- reward state
- progression state
- partner-action outcomes
- crash/stability signals
- API health
- release-channel feedback

## Rollback/hotfix readiness

Before public rollout:
- identify last known-good release
- retain artifact identity/hash
- retain tag/commit mapping
- define hotfix branch convention
- avoid destructive device recovery procedures
