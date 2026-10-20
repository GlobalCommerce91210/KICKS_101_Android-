#!/usr/bin/env bash
# Explicitly isolated target only. Never run against the protected staging DB.
set -euo pipefail
umask 077
: "${PGSERVICE:?Isolated restore database service required}"
: "${KICKS_RESTORE_CIPHERTEXT:?Downloaded encrypted backup path required}"
: "${KICKS_RESTORE_AGE_IDENTITY:?Protected local age identity file required}"
[[ "$PGSERVICE" =~ ^[A-Za-z0-9_.-]+$ ]] || exit 2
for command in psql pg_restore age; do command -v "$command" >/dev/null; done
database="$(psql --no-password -XAtqc 'SELECT current_database()')"
[[ "$database" =~ ^kicks_restore_[a-z0-9_]+$ ]] || { echo 'Dedicated kicks_restore_ database required.' >&2; exit 2; }
tables="$(psql --no-password -XAtqc "SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema')")"
[[ "$tables" == 0 ]] || { echo 'Restore target must be empty.' >&2; exit 2; }
# No --clean and no primary connection. Stop on first error, roll back the restore.
age --decrypt --identity "$KICKS_RESTORE_AGE_IDENTITY" "$KICKS_RESTORE_CIPHERTEXT" |
  pg_restore --dbname="service=$PGSERVICE" --no-password --no-owner --no-privileges --exit-on-error --single-transaction
psql --no-password -X -v ON_ERROR_STOP=1 -c 'SELECT current_database() AS isolated_restore_database;'
printf 'Isolated restore completed. Hold collectors until authority, epoch, revocations and receipts are reconciled.\n'
