# KICK-004 — Staging API reliability

Status: source fixes ready for review; authenticated staging and rendered device acceptance remain open.

Repository: GlobalCommerce91210/KICKS_101_Android-. Base: `codex/device-connection-20261020` at `0557bb5bac9cae86ddf8c39aad3417e5a93c5fb7` (PR #45). Isolated branch: `fix/kick-004-staging-api`. This stacks on the most recent consumer device-preservation work; it does not merge the other open release branches. No KICK-003 implementation branch/PR was found by task-name search; no claim is made that its independent acceptance gate has passed.

## Confirmed causes and repairs

| Area | Confirmed source behavior before | Implemented behavior |
|---|---|---|
| Transport/session | Timeout only at individual session fetch; legacy intelligence calls unbounded; no shared retry/deduplication/correlation | Shared transport, 20-second header deadline, bounded GET-only retries (maximum three attempts), credential-scoped in-flight deduplication, isolated bodies, JSON validation/deadline and request IDs |
| Error states | Optional source failures collapsed into a label; HTTP status and malformed response distinction lost | `IDLE`, `LOADING`, `SUCCESS`, `EMPTY`, `ERROR`, `UNAVAILABLE`, `UNAUTHORIZED` vocabulary; per-profile-source terminal states/messages; wallet idle/loading/failure state displayed |
| Profile/device list | Missing devices/items properties silently became empty lists; null records could reach rendering | Arrays and required record identity fields validated before success; valid empty arrays classified EMPTY; malformed records classified ERROR |
| Wallet | Account wallet filled missing balance fields with zero; web/Android legacy wallet showed hard-coded balances after failures | Require three finite numeric balances; real zeros remain valid; all consumer wallet routes use existing authenticated AccountWallet; no demo balance or simulation route substituted |
| Refresh/cache | Profile cleared valid data immediately; account wallet erased data on failure | Profile and wallet retain bounded, in-memory, identity-scoped display data for up to five minutes; stale indicators; profile monitoring status hidden while refresh is pending/failed; no stale data authorizes collection or a payment |
| Permissions | Malformed device list became empty; missing consent property could appear loaded | Validate list/consent envelope; do not show “no device” for an error; keyed session views and identity checks prevent old-account completion from populating current controls; all consumer permission routes use existing authenticated controls |
| Shopping/rewards | Failed loads logged silently while default dollar values/scores appeared; local click displayed ledger agreement success | Explicit loading/unavailable/retry UI; discard superseded loads; validate summary/gate/match envelopes; remove numeric placeholders; no agreement success without an acceptance API |
| Diagnostics | Raw legacy errors logged from shopping requests | Bounded in-memory ring of 50 entries containing only opaque request ID, status, attempt; no URL, query, subject, payload, token or exception text. `getRequestDiagnostics()` returns copies. No external telemetry is sent |

An HTML 403 or explicit Cloudflare managed challenge is UNAVAILABLE, distinct from a JSON API permission denial. 401 still clears the local session. 403 reports UNAUTHORIZED without treating every forbidden source as a globally expired session. 404 is UNAVAILABLE for these required resource endpoints, not an empty dataset. 429/500/502/503/504 GET retries use 250/500 ms backoff or a valid Retry-After up to two seconds. Longer/invalid Retry-After is surfaced without retrying early. Network failures, timeouts, non-retryable HTTP responses and all mutations have no automatic retry. There is no background retry loop. No endpoint contracts or production environment settings changed.

## Integration inventory

- Authentication/interceptors: `SessionProvider.tsx` configures the HTTPS origin and SecureStore-backed refresh storage; `sessionCore.ts` owns bearer injection, single-flight refresh, path allowlist, session generation and sign-out. It now delegates transport and JSON parsing to `requestState.mjs`.
- Consumer profile: account/product identity rechecked before optional source reads in `profileService.ts`; concurrent whole-profile hydration is shared for the exact current session only.
- Devices/enrollment: authenticated `/core/consumer/v1/devices`; native proof remains in `deviceService.mjs`/the native module. Enrollment still requires matching backend active binding; no enrollment mutation is retried automatically.
- Permissions/consent: authenticated effective permissions, consent history and per-device consent routes. AccountPermissions reads/writes do not activate the collector.
- Collector: reviewed monitoring policy, per-device consent and native runtime evidence remain separate in `monitoringPolicy.ts`, `IosCollectorControls.tsx` and `iosCollectorActivation.mjs`. Existing bounded status-poll overlap guard and stop-on-verification-failure remain unchanged. API display/cache does not satisfy authorization.
- Wallet: authenticated `/core/consumer/v1/wallet`. Legacy `walletApi.ts` and legacy demo UI functions remain in source but are no longer selected by the consumer Wallet route. No legacy payout/simulated-credit control is exposed by that route.
- Rewards/shopping: `intelligenceApi.ts` uses existing app-level intelligence, gate and marketplace contracts. Native origins now require configured remote HTTPS; web uses explicit public origin when configured, otherwise same origin. These endpoints do not establish consumer study acceptance or a real payout. No new bearer/financial contract is invented. Legacy `permissionsApi.ts` remains in source but is no longer selected by the consumer Permissions route.
- Caching: memory only; no new disk/database cache, no cached bearer, no cached authorization. Cached values are checked against exact account object and age, and ignored after replacement/logout. New source errors are never cached as empty/zero.

## Verification — 2026-10-22

- Mobile and API workspace TypeScript typechecks: PASS after the shared-module compatibility fix.
- Full mobile automated suite: **97 passed, 0 failed, 0 skipped**. Includes existing enrollment, account/session, monitoring policy and collector activation safeguards.
- New reliability tests cover populated/empty responses; zero balances; 401/403/404/429/500/503; Retry-After/backoff bounds; no mutation/auth-error retries; timeout/offline and restoration; malformed JSON/missing numeric fields; duplicate reads; credential isolation; stale-cache age/account isolation; private diagnostic boundaries. Profile tests also distinguish empty from malformed lists.
- Baseline and modified Expo web exports: PASS. These are build checks, not screenshots or installed-device tests.
- API suite after the web build: **53 passed, 3 failed, 4 database-dependent tests skipped**. The three failures are identity email verification, password reset and MFA lifecycle tests expecting debug tokens that are absent. Running the same lifecycle test file at the untouched base `0557bb5` reproduced all three failures (2 passed / 3 failed). They are confirmed pre-existing, not counted as acceptance passes. The initial static-index test failed before web assets existed and passed after the required web build.
- `git diff --check`: PASS.
- Read-only public staging probes: `/health` = 200; account, snapshot, devices, effective permissions and wallet = 401 without bearer. `/v1/me/consumer-state` = 403. No consumer account was created or modified by these probes. These results establish unauthenticated reachability/status only.

Hosted CI at `707369903439b84bf27a614356e5268c99839d76`: staging smoke [39853577617](https://github.com/GlobalCommerce91210/KICKS_101_Android-/actions/runs/39853577617) FAILED because health was 200 but the account route returned HTTP 403 with a Cloudflare HTML managed challenge from the hosted runner. Account/profile application checks were not reached. Other quality/PostgreSQL/iOS checks were still running when inspected. This differs from the local anonymous account probe (401), confirming caller-dependent edge behavior. A follow-up response-classification test distinguishes that challenge from a JSON 403 authorization denial.

## Open dependencies / acceptance limits

1. Authenticated staging happy paths and recovery must be verified with an authorized test account; no credentials or authenticated device session are available in this execution environment.
2. `/v1/me/consumer-state` returns 403 to an anonymous probe. Whether Cloudflare or application policy causes that response, and authenticated accessibility, remain unverified. The app now reports this source as unavailable/unauthorized rather than claiming valid empty data. No Access bypass was introduced.
3. Web cross-origin requests require the existing staging CORS policy to permit the configured origin, authorization and request-ID headers. Backend currently registers CORS with `origin: false`. This was not loosened; same-origin and native flows remain the intended existing contracts pending coordinated review.
4. Shopping summary/gate/match schemas receive boundary checks, but exhaustive nested buyer/metadata schema validation and authenticated consumer study-acceptance/payment contracts remain separate backend work. The local-only acceptance success is blocked.
5. Rendered before/after UI screenshots are **not captured**: Playwright has no installed browser; its Chromium download returned invalid/truncated archives. Source-level before/after evidence is in `evidence/kick-004/ui-before-after.md`. No mockup is presented as device evidence.
6. Signed iOS/Android builds, physical iPad/Android preservation tests and exact-commit hosted CI remain acceptance gates. No device reinstall, clear-data, provisioning, merge, release or production change was performed.

Monitoring remains separately authorized through the existing native/consent/lease checks; these changes do not turn it on. The separate KICK’S in Action TestFlight demo is untouched.

## Changed files
- `apps/mobile/app/my-devices.tsx`
- `apps/mobile/app/opportunities.tsx`
- `apps/mobile/app/permissions.tsx`
- `apps/mobile/app/profile.tsx`
- `apps/mobile/app/wallet.tsx`
- `apps/mobile/components/AccountPermissions.tsx`
- `apps/mobile/components/AccountWallet.tsx`
- `apps/mobile/package.json`
- `apps/mobile/services/intelligenceApi.ts`
- `apps/mobile/services/profileService.test.mjs`
- `apps/mobile/services/profileService.ts`
- `apps/mobile/services/requestState.test.mjs`
- `apps/mobile/services/requestState.d.mts`
- `apps/mobile/services/requestState.mjs`
- `apps/mobile/services/sessionCore.ts`
- `docs/KICK-004.md`
- `docs/evidence/kick-004/ui-before-after.md`

Shared helper uses `.mjs` plus `requestState.d.mts` declarations to remain compatible with both Expo and NodeNext API tests. Initial hosted quality/PostgreSQL checks exposed TS5097 from a `.ts` import; this source-level compatibility issue was repaired without changing backend configuration.
