# Shared beta candidate — 2026-10-09

Branch: release/0.2.6-shared-beta-20261009
Parent: 17e86436e849d34361d6f460d2bf164b37f5cc95.
Verified ancestry: operational beta 7bab06ee7343b1f4761e88a7099f9c5557e5a945 is the merge base; hydration is eight commits ahead, zero behind. No merge or cherry-pick is required.

Fix: allowImportingTsExtensions in mobile TypeScript configuration. The mobile typecheck uses tsc --noEmit; Metro handles application bundling and Node 24 tests import TypeScript source explicitly. Preserve both execution paths.
Required exact-head checks: quality, ios-validation, ios-operational-validation. Release-branch push triggers avoid confusing synthetic PR merge validation with head validation. Passing simulator CI does not prove physical-device signing or native Android compilation.

## Frozen scope
Existing account/profile hydration, restoration/logout/expiry, consent and revocation, core screens, accurate unavailable monitoring/wallet states, and continuity. No government accounts, broad analytics, new monetization or infrastructure. No production deployment, secret rotation, protected merge, app uninstall, clear-data, collector identity rewrite, or protected dataset changes.

## Blockers and next actions
Owners below are responsible roles; running agent assignments have not been verified.

| Gate | Evidence/status | Responsible role | Next action |
|---|---|---|---|
| Exact-head CI | Pending this commit | Technology / implementing developer | Record head SHA and run links; investigate first causal failure |
| Android native compile | Not verified on this candidate; current quality workflow is JS/TS only | Technology / Android build operator | Use existing native build path; retain manifest/artifact/checksum |
| Android signing access | Historical PR #20 reports signer fingerprint fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c; current keystore access and device match UNVERIFIED | Founder / authorized signing operator, Technology | Inspect existing keystore securely, compare certificate with installed app and candidate; verify versionCode increases |
| iOS signing access | EAS project configured; authenticated access/team/certificate/iPad provisioning UNVERIFIED | Founder / authorized Apple/Expo operator, Technology | Verify existing project and credentials; confirm intended iPad provisioning and upgrade signing continuity |
| Live staging account/resource routes | UNVERIFIED; shell and browser execution blocked by sandbox initialization failures | Technology / staging API operator, Onboarding | Run authenticated reads with synthetic test account; verify identity match, expired-session rejection, unavailable-source behavior; classify 404/5xx/authorization failures without logging tokens |
| Signed device continuity | UNVERIFIED | Technology / device operator, Product acceptance | Install only after preservation evidence and signature checks; retain relaunch/session/consent evidence |

Existing profile/session tests cover synthetic identity mismatch, unavailable optional sources, 401 session clearing, restore/refresh rotation and secure-storage failures. These are code-level tests, not live staging evidence.
