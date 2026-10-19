# KICK’S Mobile 0.2.6 — RC1 Green Criteria

**PR:** #22  
**Branch:** `mobile/0.2.6-upgrade`

RC1 is structural/build validation. RC2 runtime validation begins only after all required RC1 gates are green.

## Current workflow state at this document update

- `quality #99`: **PASS**
- `ios-validation #10`: **IN PROGRESS**

Always use the latest candidate-commit runs for promotion; do not rely on historical run numbers.

## A. CI structural gates

- [x] deterministic `npm ci`
- [x] workspace typecheck
- [x] `npm run build`
- [x] existing API/workspace tests
- [x] quality workflow green on current documented candidate
- [x] root `package-lock.json` reconciled
- [x] Node 24 CI environment
- [x] `quality.yml` updated

## B. iOS structural gates

- [x] macOS runner setup
- [x] compatible Xcode toolchain selected
- [x] Expo config validation
- [x] iOS prebuild
- [x] CocoaPods installation
- [ ] unsigned Xcode Simulator build
- [ ] no unresolved Swift/C++ interop blocker
- [ ] latest `ios-validation` workflow green
- [ ] iOS evidence artifacts uploaded/recorded

## C. Release-engineering gates

- [x] build lock documented
- [x] RC1 blocker documented
- [x] RC2 execution documents committed
- [ ] final RC1 candidate SHA recorded
- [ ] final quality run reference recorded
- [ ] final iOS validation run reference recorded
- [ ] deviations/waivers documented, if any

## RC1 promotion rule

> RC1 is green only when the exact promotion candidate commit has successful required `quality` and approved iOS structural-build evidence with no unresolved native build blocker.

Only then:
- promote PR #22 to RC2 runtime validation;
- begin Android/iOS runtime parity testing;
- begin distribution validation according to the approved release path.

RC1 green does not itself authorize merge or release.
