# M5 — Production Backup, Restore, and Recovery

Baseline: locked RC72 `89bfe4de8f358ff69f101040528116e68d9ff198`.

## Safety boundary

- Protected `C:\KICKS` collector data and existing Moto/tablet datasets are not database migration targets for this procedure.
- Never use restore operations to overwrite, truncate, re-key, or rewrite protected collector/Moto source data.
- Restore targets must be a new/empty recovery database or an explicitly approved staging database until validation is complete.
- Production must not fall back to in-memory stores when durable PostgreSQL configuration is missing.

## Backup scope

The PostgreSQL backup must include all durable KICK'S/DataStorm API state represented in the production database, including collector/device metadata, consent/audit records, identity lifecycle state, device bindings, idempotency records, and any durable consumer/backend state implemented in PostgreSQL.

Use a consistent logical backup with PostgreSQL `pg_dump` custom format:

```bash
pg_dump --format=custom --no-owner --no-acl --file=kicks-production.dump "$DATABASE_URL"
```

Generate a SHA-256 digest immediately after backup and store the dump plus checksum in the approved protected backup location. Never commit database dumps or credentials to Git.

## Restore drill

Restore only into a fresh recovery database:

```bash
createdb kicks_recovery
pg_restore --clean --if-exists --no-owner --no-acl --dbname="$RECOVERY_DATABASE_URL" kicks-production.dump
```

A recovery drill passes only when:

1. schema objects restore without unexpected errors;
2. service starts with `KICKS_ENVIRONMENT=staging` against the recovery database;
3. `/health` reports PostgreSQL durability;
4. representative identity, consent, binding, collection, and audit records remain queryable;
5. record counts and selected immutable identifiers match the backup evidence;
6. no protected `C:\KICKS` or Moto/tablet source data was modified;
7. the recovery database can be closed and reopened without losing durable state.

## Database close/restart validation

The API `onClose` hook closes the collector store, identity store, and device-binding store. A restart validation should:

1. start the API on PostgreSQL;
2. create or locate controlled staging records;
3. shut the API down cleanly;
4. start a new process against the same database;
5. verify those same records remain present and usable;
6. confirm new writes succeed after restart.

Memory-store results do not satisfy this test.

## Recovery failure rules

Treat any of the following as release blocking:

- backup cannot be restored to a clean database;
- a restart loses durable identity, consent, binding, collector, wallet/compliance, or idempotency state that is expected to be persisted;
- restore requires destructive changes to protected collector/Moto data;
- production can boot without durable PostgreSQL configuration;
- secrets appear in logs, backup filenames, repository content, or CI artifacts.

## Evidence package

For M5 acceptance retain:

- source commit SHA;
- database schema/migration version or bootstrap evidence;
- backup timestamp and checksum (never the secret URL);
- restore target identifier/environment;
- before/after representative record counts;
- restart validation results;
- `/health` durability result;
- CI run proving automated regression tests;
- any failure and remediation notes.

Store release evidence in OneDrive under the KICK'S 0.2.6 archive structure. Database dumps themselves belong only in an approved protected-data backup location, not in the general release-evidence folder unless explicitly secured for sensitive data.
