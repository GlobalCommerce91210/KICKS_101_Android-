# PR #22 — RC2 Promotion Block

**Branch:** `mobile/0.2.6-upgrade`  
**PR:** #22  
**Current phase:** RC1 structural validation  
**Next milestone:** RC2 runtime validation

## Current CI evidence

At the time this document was updated on the current branch head:

- `quality #94`: **PASS**
- `ios-validation #5`: **IN PROGRESS**

The promotion decision must use the latest completed workflows on the final RC1 candidate commit, not historical run numbers.

## RC1 structural gates

- [x] root `package-lock.json` reconciled
- [x] Node 24 CI environment
- [x] `npm ci` passes
- [x] workspace typecheck passes
- [x] `npm run build` passes
- [x] existing API/workspace tests pass
- [x] `quality.yml` updated
- [x] `ios-validation.yml` added/updated
- [x] Expo config validation reached successfully in iOS workflow history
- [x] iOS prebuild reached successfully in iOS workflow history
- [x] CocoaPods install reached successfully in iOS workflow history
- [ ] latest iOS unsigned Simulator build passes
- [ ] final RC1 evidence bundle recorded against the candidate commit

## RC2 promotion rule

Promote PR #22 from RC1 to RC2 only when:

> The latest candidate commit has a green `quality` workflow and a green `ios-validation` workflow, with no unresolved structural blocker.

## RC2 scope

After promotion, RC2 focuses on runtime evidence:

- Android runtime validation
- iOS runtime validation
- collector/shared-state behavior
- reward tuning
- partner-action flows
- offline/reconnect behavior
- Android/iOS UI parity
- performance/stability
- regression sign-off

## Promotion record

When RC1 completes, record:

- promoted commit SHA
- quality run number/URL
- ios-validation run number/URL
- promotion date
- unresolved non-blocking warnings, if any
- approving release decision
