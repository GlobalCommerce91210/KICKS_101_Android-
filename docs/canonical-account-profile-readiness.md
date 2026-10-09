# Canonical account/profile candidate

Based on integration/mobile-account-consent at 14600d8c06bd5294985da0075c1036c60f93d102. This candidate uses the existing DataStorm identity store and SessionManager. It does not depend on PR #30's proposed consumer-account-v1 provider.

## Source contracts
- POST /core/identity/v1/account: existing account creation, published terms/privacy versions, idempotency-key; marketing_opt_in false.
- POST /core/identity/v1/session: password sign-in.
- POST /core/identity/v1/session/refresh: refresh rotation.
- DELETE /core/identity/v1/session: server logout.
- GET /core/identity/v1/account and /core/identity/v1/products/kicks: canonical account and entitlement verification.
- GET /core/consumer/v1/profile, /snapshot, /devices: authenticated profile sections. Returned subject IDs must match the current human session.
- Existing device/purpose consent screens remain distinct from human login.

Recovery requires EXPO_PUBLIC_DATASTORM_RECOVERY_URL pointing to the approved HTTPS portal. No recovery endpoint is invented. Creation is disabled until approved HTTPS privacy/terms URLs and their versions are configured.

## Hosting
The user selected Vercel project api for the mobile web app, with the API hosted through Cloudflare. Dashboard settings were saved and reopened: repository root, Other framework, npm ci --include=dev --workspaces, mobile build:web, apps/mobile/dist. A successful preview is still required.

Cloudflare tunnel datastorm-kicks-staging points staging-api.datastorminc.live to localhost:3000 on DESKTOP-N0PB2Q9. The editing environment ST-TMP-595 is a different host. Healthy tunnel status does not establish the origin's running source revision or identity route behavior.

## Local validation
Mobile tests: 20 pass. API tests: 26 pass, one PostgreSQL integration test skipped because its configured database is absent. Both TypeScript checks and Expo web export passed in the isolated validation harness. Exact-candidate remote CI and runtime validation remain required.

## Release gates still open
- Exact-candidate quality/Android and iOS simulator CI, PostgreSQL restart contract.
- Vercel preview deployment and browser behavior.
- Origin running SHA, staging PostgreSQL persistence, identity/session/consumer route checks through Cloudflare.
- Approved policy URLs/versions and working canonical recovery.
- Dependency exposure review: patched shell-quote and source-map-js; decode-uri-component, braces and node-forge remain unresolved. Do not force incompatible major upgrades.
- Signed Android/iOS continuity and physical-device consent/session/collector evidence.
- Production deployment approval and rollback evidence.

Status: NOT PRODUCTION READY. Local compilation and source changes do not close runtime or device gates.
