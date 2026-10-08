# DataStorm Consumer Account and KICK’S Profile — staging implementation

Status: source implementation with fixture validation. Live Cloudflare identity integration, hosted domain routing, native device testing, and consumer beta acceptance remain unverified. Do not mark the journey beta-complete from this change.

Base: `implementation/ios-operational-beta` at `7aa002403860adcc57c12830da5c39afc35a6d91` in `GlobalCommerce91210/KICKS_101_Android-`.

## Experience

`/account` is web-accessible through the existing Expo web export and contains Log In, Create Account, Recovery, Privacy, Terms, and the path into KICK’S. No new account domain or DNS change is included. `/profile` is an authenticated first-class destination. Navigation is Home, Opportunities, Permissions, Wallet, Profile; Engine and Settings remain reachable as secondary routes. Settings links to Profile for identity/data-rights controls.

Native session material uses Expo SecureStore. Web session material uses a Secure, HttpOnly, SameSite=Strict host cookie, never localStorage. The app restores the canonical session on launch and foreground, rechecks expiry, removes authenticated routes on expiry, and retains an internal return destination during reauthentication. Logout requests canonical revocation and removes native session material even on failure; an unconfirmed remote logout is shown as an error. Returning to the app during a provider outage shows an unavailable state rather than exposing stale account screens.

The identity spine is `account_id -> consumer_id -> product profile/state`. There is no KICK’S account/password database. Collector enrollment tokens and WireGuard/device records cannot satisfy account authentication. The account provider owns account verification, recovery, session issuance/revocation, and device-to-consumer ownership. It must verify those relationships independently of client input.

## Canonical provider connection

The API uses `DataStormAccountProvider` in `services/api/src/account.ts`. `accountProvider.ts` supplies a server-to-server HTTP adapter for a canonical service hosted on Cloudflare or another HTTPS host. **This contract is proposed by this implementation; it is not evidence that an existing Cloudflare Worker implements it.** Configure only a distinct canonical staging origin, never the same KICK’S API or a production service.

- `DATASTORM_ACCOUNT_ENV=staging`
- `DATASTORM_ACCOUNT_PROVIDER_ORIGIN=https://<verified-canonical-staging-origin>`
- `DATASTORM_ACCOUNT_PROVIDER_CONTRACT=consumer-account-v1` only after verifying this contract
- `DATASTORM_ACCOUNT_WEB_ORIGIN=https://<KICKS-staging-web-origin>` for browser mutation checks
- `EXPO_PUBLIC_API_URL` for Android and `EXPO_PUBLIC_IOS_API_URL` for iOS must be remote HTTPS KICK’S API origins.
- `EXPO_PUBLIC_PRIVACY_URL` and `EXPO_PUBLIC_TERMS_URL` must point to approved HTTPS publications.

Blank provider configuration returns `503 datastorm_account_provider_required`. No device token, demo identity, inferred email mapping, or Cloudflare Access header is used as a substitute. Cloudflare as a hosting provider does not identify the consumer authentication provider or prove an account/session contract. If the canonical provider uses hosted OAuth/OIDC rather than delegated password authentication, replace the authentication adapter/entry flow with that verified provider’s flow before enabling it; do not implement a second credential store.

The staging provider must implement:

| Method/path | Response or behavior |
| --- | --- |
| POST `/core/identity/v1/session/login` or `/create` | Accept `{email,password}`; return canonical `{token,expires_at,account}`; password policy/MFA/verification belongs to DataStorm |
| POST `/core/identity/v1/session/recovery` | Accept `{email}`; uniform eligible/ineligible response; provider owns recovery delivery |
| GET `/core/identity/v1/account` | Authenticate Bearer token; return `{expires_at,account}`; expired/revoked token returns 401 |
| POST `/core/identity/v1/session/logout` | Revoke that canonical session; 204 |
| GET `/v1/me/consumer-state` | `{consumer_id,profile_status}` |
| GET `/core/consumer/v1/snapshot` | `{consumer_id,membership_status}` |
| GET `/core/consumer/v1/devices` | `{consumer_id,devices:[{device_id,label,status}]}` |
| GET `/v1/me/permissions` and `/v1/me/consent` | `{consumer_id,active_count,revoked_count}` |
| GET `/v1/me/monitoring` | `{consumer_id,status:'off'|'active'|'pending'|'unavailable'}` |
| GET `/v1/me/wallet` | `{consumer_id,currency,available_balance,pending_balance}`; amounts in the stated currency's major unit |
| GET `/core/identity/v1/controls` | `{consumer_id,controls:{security?,devices?,consent?,export?,close?,privacy?,terms?}}`; HTTPS canonical portal URLs |

Account fields: `account_id`, `consumer_id`, `display_name`, nullable `email`, `account_status` (`active`, `restricted`, `pending`, `closed`), `profile_status`. Session expiry is an ISO UTC datetime. Bearer material is never an arbitrary client-supplied consumer ID. Resource queries that try to supply identities are rejected; returned identities must match the restored session. Closed accounts are denied. Independent resource errors render unavailable sections, not fabricated zeros or empty devices.

Export, closure, security, device management, and consent changes open provider-owned controls; unavailable controls are disabled. Account closure is only a portal request entry, not automatic deletion. Revoking consent is separate from closing an account. Wallet mutations remain outside this milestone.

## Compatibility and limitations

Authenticated Home, Permissions, and Wallet use canonical session-scoped reads. Existing demo components and synthetic APIs are retained for history/compatibility and are not used to hydrate authenticated identity. Opportunities and Engine retain their existing demonstration behavior; they are not evidence of real offers, monitoring, or account lifecycle completion.

No Android/iOS bundle identifier, EAS project, collector token store, enrollment subject, signing configuration, production deployment, or protected merge is changed. Adding SecureStore changes native dependencies; both native targets require new builds and installed-device checks. The existing collector and release gates still apply.

The API’s per-IP account throttle is process-local. The canonical provider/Cloudflare edge must independently enforce distributed rate limits, abuse prevention, verification, and MFA. HTTPS proxy termination and the exact web Origin must be verified in staging. Cookies require HTTPS on actual staging hosts. Secrets and passwords must not enter URLs/logs, client storage, or public environment variables.

## Acceptance evidence still required

Verify the exact Cloudflare staging origin and provider contract; test real create/login/recovery, persistence/revocation after restarts, cross-account device isolation, token expiry, consent revocation without account closure, truthful monitoring, wallet authorization, policy publications, and signed Android/iOS session continuity. Test browser page rendering, secure cookie behavior and route return, and native SecureStore on real devices. Preserve exact commit and endpoint/configuration evidence. No live consumer records are used by fixture tests.
