# KICK-011C — Verified Collector Authorization

## Release status

**BLOCKED — do not enable the native collector or deploy this branch to production.** This change introduces a fail-closed authorization interface and route guard, but the production evidence provider, independently operated blockchain verifier, revocation-aware database transaction/locking, and real Android OS-permission attestation are not wired. Missing dependencies intentionally deny requests.

## Authorization contract

`CollectorAuthorizationService.authorizeCollector` requires authenticated subject, enrolled device, exact consent scope and purpose, current policy/disclosure versions, current decision version, immutable receipt linkage, independent proof verification and finality on the required chain, server-verified OS permission evidence, passing safety policy, valid revocation epoch, and unexpired/non-superseded authorization. Unknown, missing, stale, timed-out, or thrown evidence denies access.

Issued capabilities are opaque, short-lived, and bound to subject, device, scope, purpose, operation, consent decision version, and expiry. Every protected operation must re-read authoritative evidence. TTL is not a substitute for revocation checks.

## Required production adapter (blocking)

Implement and review a provider backed by the authoritative PostgreSQL records and an independently operated verifier. It must not accept client-supplied verification state. Read current consent, receipt, proof, device, policy, permissions, and revocation epoch in a transaction consistent with ingestion. Authorization validation and the final ingestion commit must share a database transaction/locking protocol with consent revocation so revocation cannot race an upload commit.

Do not map the in-memory consent store to production verification evidence. The current test adapter is isolated to automated tests and is not a production verifier.

## Ingestion paths

- `POST /v1/metadata-batches`: service-level authorization gate and a transaction callback before persistent writes. Production repository wiring must implement the callback using the same transaction/lock domain as the batch write. If no authorization service is injected, the route returns service unavailable.
- `POST /v1/intelligence/events`: development-fixture path is denied unless explicitly enabled in a non-production test configuration; always denied in production.
- Native Android collector, offline buffer synchronization, background queues/retries, and partner export/processing: **not enabled by this change**. Before launch, each must call the shared authorization boundary immediately before processing or persistence and recheck revocation at commit time.
- No native monitoring is enabled by this change. Android eligibility is informational only and never authorizes client-side collection.

## Eligibility states

`BLOCKED_NO_CONSENT`, `BLOCKED_STAMP_PENDING`, `BLOCKED_VERIFICATION_FAILED`, `BLOCKED_DEVICE_NOT_ENROLLED`, `BLOCKED_OS_PERMISSION`, `BLOCKED_REVOKED`, `BLOCKED_POLICY`, `BLOCKED_SERVICE_UNAVAILABLE`, and `ELIGIBLE`.

## Revocation and new grants

Revocation must increment the authoritative revocation epoch and invalidate server-side capabilities in the same consistency domain as protected ingestion. Stop notifications are best-effort assistance, not the security control. Queued and offline data must be reauthorized when drained; data captured before revocation does not bypass current policy. A new grant must have its own receipt and independently verified proof.

## Dependency assessment: KICK-011A / KICK-011B

- **KICK-011A:** related consent/device persistence work exists in an open draft PR, but merge, migration application, database restart recovery, and integration tests have not been verified. Treat as **not release-validated**.
- **KICK-011B:** no verified implementation of independently verified blockchain receipts/finality was found during this branch review. Treat as **missing/blocking** until an actual verifier and durable proof records are implemented and tested.
- This branch deliberately fails closed when those providers are unavailable.

## Test and deployment gates

Required before release: typecheck/build; unit tests for every gate; API integration tests against PostgreSQL; real migration and restart tests; transaction/concurrency tests proving revocation wins against ingestion; route tests for metadata and intelligence events; queue/retry/offline/partner-path tests; independent verifier failure/finality tests; Android OS permission lifecycle tests; staging physical-device acceptance; and a reviewed rollback plan.

No production deployment or collector enablement is authorized by this documentation. Migration changes must be backward-compatible or shipped behind a disabled feature flag. Rollback must disable collector ingress, preserve audit records, and avoid restoring stale grants or proof status.
