#!/usr/bin/env bash
# Source tooling only. Run with an explicitly reviewed pg_service.conf, age public
# recipient and preconfigured off-host remote. No database password in arguments.
set -euo pipefail
umask 077
: "${PGSERVICE:?Reviewed database service required}"
: "${KICKS_BACKUP_DIRECTORY:?Existing private backup directory required}"
: "${KICKS_BACKUP_REMOTE:?Existing off-host rclone destination required}"
: "${KICKS_BACKUP_AGE_RECIPIENT:?Reviewed age public recipient required}"
: "${KICKS_BACKUP_ROLE:?Use primary or revocation-authority}"
[[ "$PGSERVICE" =~ ^[A-Za-z0-9_.-]+$ ]] || exit 2
[[ "$KICKS_BACKUP_ROLE" == primary || "$KICKS_BACKUP_ROLE" == revocation-authority ]] || exit 2
[[ -d "$KICKS_BACKUP_DIRECTORY" && ! -L "$KICKS_BACKUP_DIRECTORY" ]] || exit 2
[[ "$KICKS_BACKUP_REMOTE" == *:* && "$KICKS_BACKUP_REMOTE" != :* ]] || exit 2
for command in pg_dump age rclone sha256sum; do command -v "$command" >/dev/null; done
directory="$(cd "$KICKS_BACKUP_DIRECTORY" && pwd -P)"
name="collector-${KICKS_BACKUP_ROLE}-$(date -u +%Y%m%dT%H%M%SZ)-${RANDOM}.dump.age"
partial="$directory/$name.partial"
artifact="$directory/$name"
[[ ! -e "$partial" && ! -e "$artifact" ]] || exit 2
# Pipeline failure preserves the partial encrypted artifact for investigation.
# Neither plaintext dump nor decryption key is written by this script.
pg_dump --format=custom --no-password | age --encrypt --recipient "$KICKS_BACKUP_AGE_RECIPIENT" > "$partial"
mv -- "$partial" "$artifact"
sha256sum "$artifact" > "$artifact.sha256"
rclone copyto "$artifact" "${KICKS_BACKUP_REMOTE%/}/$name"
rclone copyto "$artifact.sha256" "${KICKS_BACKUP_REMOTE%/}/$name.sha256"
# Check by downloading the ciphertext; works even when the remote has no hashes.
rclone check "$directory" "${KICKS_BACKUP_REMOTE%/}" --include "$name" --one-way --download
printf 'Encrypted off-host backup verified: %s\n' "$name"
