# KICK-011A/B/C audit and fail-closed foundation

## Status

This branch is a safety-first partial implementation, **not** a completed KICK-011 release. No collector may be enabled.

## Confirmed on main at audit

- Consent decisions were kept in an in-memory Map, overwriting previous state instead of an append-only durable ledger.
- POST /v1/metadata-batches accepted a grant without independently verified blockchain proof.
- POST /v1/intelligence/events accepted telemetry without device/consent authorization.
- No durable receipt, stamp job, or independent verifier implementation was present in the inspected repository tree.
- Native Android VPN source exists; no end-to-end release safety claim is made.

## Safety change on this branch

- POST /v1/metadata-batches returns HTTP 403 after authentication and schema validation, without persisting observations.
- POST /v1/intelligence/events returns HTTP 403 before processing events.
- Tests assert both routes fail closed.
- These routes must remain blocked until they call a single authoritative, transactional verified-consent service.

## Outstanding P0 work

1. **KICK-011A**: PostgreSQL append-only ConsentDecision, transactional per-scope decision ordering, authenticated identity/device binding, immediate revoke and invalidation; secure all user-ID routes.
2. **KICK-011B**: immutable ConsentReceipt with privacy-preserving commitment; transactional StampJob outbox; protected signer; independently verified chain/finality evidence; provider configuration and operational recovery.
3. **KICK-011C**: short-lived scope/device-bound collector authorization; OS permission and enrollment checks; current decision-version binding; transactional recheck during ingestion; revocation-safe race handling; secure offline/replay/background pathways.
4. **Tests**: execute full test and typecheck suite in coding environment; add negative and concurrency integration tests. Current branch tests were edited but not executed in this connector-only session.
5. **Release**: no deployment or native collector activation before all safety gates and device tests pass.

## Risk

Blocking ingestion intentionally changes API behavior and can break existing demo/intelligence flows. Review impact before merging. The branch is not production-ready.
