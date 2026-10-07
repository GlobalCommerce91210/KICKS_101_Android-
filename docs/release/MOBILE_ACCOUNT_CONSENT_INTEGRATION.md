# Combined mobile account and consent integration candidate

## Provenance
Canonical delivery branch: mobile/0.2.6-upgrade.
Mobile session/client snapshot: PR #27, 30ef54a18b8140ef712a87514d073c3a10dd064f (includes PR #25).
Existing consumer API and account-bound consent snapshot: PR #26, f1514693a762e4e251170686048698523c6ff2c3.
The existing backend modules are imported for compatibility, not evidence of live collection, payouts, or marketplace delivery.

## Validation
Local workspace typechecks and web build passed. All 38 tests pass: 15 mobile and 23 API.
The new mobile-account-consent.test.ts runs the real SessionManager against Fastify routes using app.inject: existing-account login, collector proof binding, grant, rotating refresh restoration, collector ingestion acceptance, revoke, denied ingestion, and logout/session revocation.
This is an in-process memory-store integration test; it does not validate native Keychain, PostgreSQL durability, network TLS, or a physical iPad.

## Staging gates
Do not deploy this snapshot to production. Configure an explicit HTTPS EXPO_PUBLIC_API_URL and the four monitoring permission/purpose settings documented in MOBILE_DATASTORM_SESSION_CONSENT.md.
Without DATABASE_URL (or KICKS_DATABASE_URL), API defaults to memory stores and loses account/binding/consent state on restart.
The inherited services/api/db/schema.sql is not a standalone migration: metadata_batches references devices before its declaration. Confirm the actual PostgreSQL initialization/migration path, schema compatibility, and restart durability before staging account validation.
Concurrent consent retry uniqueness still needs durable atomic enforcement. Unlinking a device does not automatically revoke collector credentials or consent.
No credentials, accounts, deployments, or signing profiles are created by this candidate.

## Device upgrade gate
Keep the installed signed baseline and existing local data. SecureStore and Crypto require a fresh signed native build, not an OTA update.
After a durable staging API passes the above gates, upgrade the existing iPad installation and verify sign-in, restart restoration, grant/revoke, expired session, sign-out, and unavailable API behavior.
A saved consent decision does not prove live iOS collection or Network Extension enforcement.
