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
The base schema now creates devices before referencing it. Apply db/migrations/001-account-consent.sql after the base schema as schema owner: it adds the account-bound consent/device columns and permits opaque DataStorm audit actors without changing collector subject IDs. The opt-in postgres-account-consent.test.ts and PostgreSQL 16 CI service validate migration reapplication, account/binding/consent persistence after API restart, refresh rotation, revocation-denied ingestion, and logout. Apply 002-collector-metadata.sql next to provide the existing collector enrichment and baseline schema. The PostgreSQL integration test now exercises accepted synthetic Android collector metadata, duplicate replay rejection, registry evidence and baseline persistence after API restart, and revocation without adding more observations. Marketplace tables remain outside this migration and are not validated. CI results for this expanded test must pass before treating ingestion compatibility as verified. Review the target database schema and migration permissions before applying; no external database was changed.
Account consent recording now validates retry/scope, appends the decision, and appends its audit in one PostgreSQL transaction under a per-device database advisory lock. Legacy appendConsent writes share that lock. Account decisions use ordered database timestamps. Apply 003-consent-request-uniqueness.sql after read-only consent-preflight.sql: existing duplicate receipts cause the unique index migration to fail without deleting history. The expanded PostgreSQL test uses two Fastify instances and independent pools to check 12 simultaneous retries, changed-body conflict, competing purpose scopes, and rollback when auditing fails. Actual staging preflight has not been executed; database schema/privileges and existing duplicate counts remain unverified. Unlinking a device does not automatically revoke collector credentials or consent.
No credentials, accounts, deployments, or signing profiles are created by this candidate.

## Device upgrade gate
Keep the installed signed baseline and existing local data. SecureStore and Crypto require a fresh signed native build, not an OTA update.
After a durable staging API passes the above gates, upgrade the existing iPad installation and verify sign-in, restart restoration, grant/revoke, expired session, sign-out, and unavailable API behavior.
A saved consent decision does not prove live iOS collection or Network Extension enforcement.

## Separate OS evidence
Android: collector protocol is exercised using synthetic metadata against PostgreSQL; no physical Android device upgrade or dataset verification is claimed.
iOS: unsigned simulator CI and founder-reported installed visual baseline are separate evidence. Synthetic Android ingestion does not verify live iOS collection. The new account/consent build is not yet signed or installed on the iPad.
Combined reporting may aggregate these results only with the OS and evidence type retained.
