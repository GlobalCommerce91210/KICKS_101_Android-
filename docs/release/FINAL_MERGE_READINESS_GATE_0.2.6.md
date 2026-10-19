# KICK’S Mobile 0.2.6 — Final Merge-Readiness Gate

**PR:** #22  
**Target:** `main`  
**Release tag target:** `v0.2.6-mobile`

PR #22 is not merge-ready solely because RC1 is green. RC1 proves structural/build correctness. RC2 and distribution validation provide the runtime/release evidence required for final approval.

## A. RC1 — Structural

- [ ] latest quality workflow green
- [ ] latest iOS validation workflow green
- [ ] deterministic lockfile/install validated
- [ ] Node 24 validated
- [ ] Expo config validated
- [ ] CocoaPods validated
- [ ] unsigned iOS Simulator build validated
- [ ] quality workflow finalized
- [ ] iOS validation workflow finalized
- [ ] RC1 evidence recorded against the candidate commit

## B. RC2 — Runtime

- [ ] collector/runtime intake validated
- [ ] duplicate/replay protection validated
- [ ] reward behavior validated
- [ ] partner-action behavior validated
- [ ] ladder/progression validated
- [ ] engagement behavior validated where implemented
- [ ] offline/reconnect behavior validated
- [ ] Android/iOS parity validated for scoped shared behavior
- [ ] performance/load behavior validated
- [ ] stability validation completed
- [ ] collector regression checklist updated from evidence

## C. Build and distribution

The exact distribution gates depend on the release channels actually used for 0.2.6.

- [ ] Android release/internal artifact generated and identified
- [ ] iOS signed distribution build generated
- [ ] iOS archive/signing/entitlements validated
- [ ] TestFlight internal validation completed if TestFlight is a release gate
- [ ] external beta completed if explicitly required for 0.2.6
- [ ] Android internal testing completed
- [ ] Android external testing completed if explicitly required for 0.2.6
- [ ] artifact hashes/build identifiers recorded

EAS Build should be marked complete only if EAS is actually configured and used for that platform. Do not make EAS a paper requirement if the approved release path is native Gradle/Xcode.

## D. Merge and release

Before merge:

- [ ] PR description matches actual evidence
- [ ] no unresolved release-blocking issue
- [ ] branch is up to date with `main` or conflicts are resolved
- [ ] required approvals complete
- [ ] final release notes match shipped behavior

Then:

- [ ] merge PR #22 into `main`
- [ ] validate main-branch CI
- [ ] validate production API/Vercel state if in release scope
- [ ] create `v0.2.6-mobile` only after main validation
- [ ] record release tag SHA
- [ ] publish approved release notes

## Merge rule

> Merge only after the required RC1, RC2, and distribution gates for the approved 0.2.6 release channels have verifiable green evidence.

Do not equate documentation completion with release readiness.
