# KICK-011A Consent Persistence Runbook

## Before enabling the API

1. Take a database backup and confirm the target environment.
2. Apply `db/schema.sql` for a new database, or apply `db/migrations/20261025_consent_purpose.sql` to an existing database. The migration adds the purpose, event ordering, and idempotency fields. Existing consent events are marked `legacy-unavailable` when purpose was not recorded; those rows must not authorize purpose-specific ingestion.
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