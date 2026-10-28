# KICK-011 — Consent Verification and Collector Safety Gates

Status: **OPEN — P0 RELEASE BLOCKER.** This document records the repository inspection and the implementation boundary. It does not claim the consent-verification system is complete.

## Repository inspection (default branch `main`)

- Application: Expo / React Native mobile client; TypeScript Fastify API in `services/api`; Android native VPN module in Kotlin.
- API test runner: Node test runner with `tsx`; API scripts include `typecheck` and `test`.
- Database dependency: `pg` is installed, but the inspected API consent implementation uses `memoryStore()` maps. The inspected consent path is not durable across process restarts.
- Queue: no durable stamping queue or stamp worker was found in the inspected consent implementation.
- Blockchain provider/verifier: no configured provider or independent finality verifier was found in the inspected consent implementation.
- Consent UI: `apps/mobile/app/permissions.tsx` contains app/metadata/buyer permission controls and a decision-history ledger. Its data path uses `permissionsApi`; it is not shown to be backed by a verified blockchain receipt.
- API consent route: `POST /v1/consent-events` in `services/api/src/server.ts` authenticates a device bearer token, then writes a consent projection into an in-memory map. A grant is represented as `granted`; both deny and revoke collapse to `revoked`. The request can supply a permission ID and client policy/purpose versions. No append-only decision history, server-side decision versioning, receipt, or transactional stamp job is present in this route.
- Metadata ingestion: `POST /v1/metadata-batches` checks device authentication, duplicate batch IDs in process memory, and consent subject/purpose/state. It does not require an independently verified stamp, an enrollment/OS-permission/policy gate, or a short-lived collector authorization. Its state is process-local.
- Native Android collector: `KicksVpnModule.kt` explicitly rejects startup when `BuildConfig.COLLECTOR_ENABLED` is false. The Gradle default is false. Preserve this fail-closed default until the complete authorization path is implemented and physically verified.
- Environment: API health explicitly reports `mode: staging` and `collector: metadata-only`. Keep this truthful until release evidence exists.

## Confirmed gaps / release blockers

1. **Durability:** consent, device records, batch replay protection, and observations use process memory in the inspected path. Restart loses state.
2. **Decision semantics:** GRANT / DENY / REVOKE are not preserved as separate append-only decisions; no monotonic decision version or stale-decision protection.
3. **Receipt and proof:** no canonical receipt commitment, protected signing-key reference, or durable receipt record found.
4. **Stamping:** no durable queue, idempotent provider submission, retry/dead-letter handling, or transaction reference lifecycle found.
5. **Independent verification:** no independent chain/transaction/proof/finality verification found. No real provider is evidenced.
6. **Authorization:** ingestion is gated by the in-memory consent projection only; no central collector authorization check is applied at start, during operation, and before every upload.
7. **Revocation:** current consent map changes state synchronously in one process, but does not invalidate durable or previously issued authorization, and is not authoritative across replicas/restarts.
8. **Authentication boundaries:** the wider API includes user-ID-scoped wallet, permissions, and intelligence routes; audit those routes separately before treating them as protected account APIs. The inspected consent task must not accidentally rely on client-supplied user IDs.
9. **UI truthfulness:** current Permissions screen does not expose the requested receipt/stamp/verification/authorization state machine.
10. **Tests:** existing tests exercise the in-memory consent and ingestion path. They do not establish database restart durability, real authorization middleware on every collector path, blockchain verification, finality/reorg behavior, or physical-device stop-on-revocation.

## Implementation plan

1. Introduce database migrations and durable append-only consent decisions, receipts, stamp jobs, verification evidence, and authorization records. Keep user/device identifiers and disclosure details off-chain.
2. Define a provider interface whose unavailable implementation returns `PENDING_PROVIDER`; never infer verification from submission success. Add an independent verifier with chain, transaction, commitment, success, finality, and reorg checks.
3. Make revocation a synchronous authoritative database transaction that invalidates all current authorizations before returning. Stamp processing must be asynchronous and cannot delay revocation.
4. Add idempotency keys, monotonic decision versions, authenticated actor derivation, device ownership and scope validation, server timestamps, and transactional decision+receipt+job creation.
5. Add one fail-closed authorization service and apply it to collector start/resume, periodic native checks, every upload/commit, offline buffer drain, scheduled jobs, retries, and ingestion. Authorization must be short-lived, scope-bound, and revocation-aware.
6. Keep Android collection disabled by default until real backend authorization, native permission checks, revocation stop behavior, and the upload gate are verified on a physical device. Offline capture must stop when authorization cannot be refreshed; buffered data must not upload after revocation.
7. Update Permissions / Consent Advisor to show truthful decision, receipt, stamp, verification, and authorization states. The in-app agent must have read-only sanitized status access and no consent mutation or signing capability.
8. Add unit, integration, security, restart, race/idempotency, provider-failure, finality/reorg, revocation, native-path, and end-to-end tests. Run typecheck/tests before marking any acceptance criteria passed.

## Acceptance rule

**Do not mark KICK-011 complete and do not enable the collector** until durable restart tests and all authorization-negative tests pass, every collection/upload path is covered, a real configured verifier supplies independent evidence, and physical-device revocation behavior is demonstrated. Mocked providers are test-only and never establish production verification.

## KICK-012 handoff

KICK-012 should consume the authoritative `CollectorAuthorization` contract, not reimplement consent logic. It must fail closed when authorization is missing, expired, revoked, stale, or unverifiable; check before capture and before each protected upload; stop on revocation/unavailable refresh; and never drain offline buffers under stale authorization. Require contract tests against the same API enforcement path.

## Follow-up implementation checkpoint

A new module, `services/api/src/durableConsent.ts`, has been added on the KICK-011 branch. It defines a PostgreSQL-backed decision transaction boundary, receipt commitment generation, idempotency fingerprint checking, durable stamping-job submission semantics, and an independent-verifier interface. Provider absence is represented as `PENDING_PROVIDER`; provider submission alone does not set `VERIFIED`.

**This module is a foundation, not an active production gate.** It is not yet wired into `buildServer()`, authentication/session identity is not yet bridged from the existing in-memory device enrollment, and existing `/v1/consent-events` and `/v1/metadata-batches` handlers have not yet been replaced by the durable service. The migration and service have not been applied or integration-tested against PostgreSQL. Do not deploy or enable collection based on this checkpoint.

Next integration work must:
- use a configured database pool and durable device enrollment before exposing these handlers;
- bind actor and user identity only from trusted authentication context;
- make the legacy metadata upload path deny by default until it uses the same authorization service;
- test transaction races and SQL behavior against PostgreSQL;
- add a real, independently operated chain verifier before any production status can be VERIFIED.
