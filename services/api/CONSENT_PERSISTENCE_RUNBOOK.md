# KICK-011A Consent Persistence Runbook

## Before enabling the API

1. Take a database backup and confirm the target environment.
2. For a new database, apply `db/schema.sql` first. For an existing database, run `npm run migrate --workspace @kicks/api` with `DATABASE_URL` explicitly set to the intended non-production database first. This uses a transaction and a PostgreSQL advisory lock to apply `db/migrations/20261025_consent_purpose.sql`. The migration adds purpose, per-permission event ordering, a durable stream-head table for expected sequences, and idempotency fields. Existing consent events are marked `legacy-unavailable` when purpose was not recorded; those rows must not authorize purpose-specific ingestion. A rerun preserves already-assigned event sequences. The migration command does not run automatically at API startup.
3. Configure `DATABASE_URL` as a secret in the API runtime. The API refuses to start without it.
4. Restart the API and verify `/health`, device enrollment, consent grant, consent history, and revoke behavior using a non-production test subject.

## Required verification before release

- Grant a permission and confirm the event exists in PostgreSQL.
- Submit the same request ID and identical payload again; it must return the original event rather than create another event.
- Reuse a request ID with different payload content; it must be rejected.
- Submit a decision with an old `expectedEventSequence`; it must be rejected as stale.
- Revoke a permission, then submit protected metadata; ingestion must be denied.
- Restart the API and confirm the device can authenticate and the consent history/current decision remain available.
- Simulate a database outage. Consent writes must not report success and protected ingestion must fail closed.
- Verify the migration was applied to the intended database; repository changes alone do not apply database migrations.

## Operational safety

Retries must be bounded and use the same request ID for the same logical decision. A retry must not mint a new permission decision. Do not fall back to in-memory consent or device identity in the deployed API. Diagnostics must exclude bearer tokens and sensitive metadata.

Automated typecheck, unit tests, and database-backed integration/restart tests are release gates. Do not mark KICK-011A complete until those checks have passing results.

## KICK-011A.3 — Pause, retry, and recovery policy

- **Pause:** On HTTP 503 or a persistence/verification outage, do not treat the decision as saved. Stop protected ingestion and surface a retryable state. The API returns `Retry-After: 1` as the minimum pause before a retry attempt.
- **Retry:** Retry the exact same logical decision with the exact same `requestId` and payload. Use bounded exponential backoff with jitter in the caller; stop after the caller's retry budget and leave the decision pending for explicit recovery.
- **Hard retry / recovery:** After service health returns, retry the same request ID again. PostgreSQL idempotency must return the original event if the first attempt committed, or create one event if it did not. Never generate a new request ID just because the response timed out.
- **Do not retry:** HTTP 400 (invalid request), 401 (authentication), 403 (consent/permission denial), and 409 (stale decision or idempotency conflict) require correction or a fresh user decision; automatic retries must not bypass these outcomes.
- A retry response must not imply success until the authoritative persisted event has been returned. Do not fall back to in-memory state when PostgreSQL is configured.
