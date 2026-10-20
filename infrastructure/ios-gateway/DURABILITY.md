# Collector durability and recovery

The implementation remains staging transport only. `collecting` stays false.
No migration, recovery database, backup schedule, gateway, signed build, or live
device has been changed by preparing this source.

## Authorization and restore boundary

Apply primary migrations 005 and 006 through reviewed deployment. Migration 005
fails on ambiguous ownership history; investigate it without deleting history.
An unlinked device cannot be rebound or moved to another account through ordinary
enrollment. A future transfer procedure needs explicit owner verification and a
new device identity; there is no administrative bypass endpoint.

Provision `collector-recovery-authority.sql` in a separate database with independent
backup and restore administration. Configure `KICKS_COLLECTOR_REVOCATION_DATABASE_URL`
and an explicit UUID `KICKS_COLLECTOR_RECOVERY_EPOCH`. Runtime rejects using the same
host/port/database as primary. DNS aliases do not establish independence: verify the
actual infrastructure recovery boundary. The runtime role needs SELECT on the
checkpoint and SELECT/INSERT on tombstones, with no ownership or mutation rights.

The checkpoint starts absent/held. An authorized operator establishes an epoch and
clears its hold only after reconciling primary state with retained revocations.
Never restore both databases to an older point and then clear the hold on faith.
After any primary rollback, hold the authority, rotate the configured/checkpoint
epoch together, reconcile historical ownership and consent, clear old host peers,
and require fresh enrollment leases and gateway acknowledgments. If the authority
cannot be proven current, keep the hold and require reviewed reauthorization.

Revocation tombstones commit before primary consent withdrawal/unlink. A primary
failure can deny access, but cannot roll back that external tombstone. All current
gateway authorization and ingestion consult it. Authority failure, missing schema,
missing checkpoint, held checkpoint, or epoch mismatch denies authorization.
The two databases are not a distributed transaction: requests already committing
before withdrawal may complete; no instantaneous cross-system revocation is claimed.

## Gateway and native renewal

Every lease gets a new revision and clears its applied acknowledgment. The host
acknowledges only after replacing the peer set. A changed snapshot or failed ack
clears peers. Readiness requires an acknowledgment no older than ten seconds.
Native enrollment polls for matching revision, activation, epoch and expiration
before saving the lease. A running extension renews only the same activation,
epoch, key and routing configuration. Foreground checks renew inside the final
60 seconds; background without renewal expires within the five-minute lease.
Host watchdog cleanup retains its thirty-second safety margin.

## Delivery and local storage

Batch receipts, raw canonical payload SHA-256 and observations commit together.
Identical authenticated retries return the persisted receipt; changed payload,
foreign device or unprovable legacy receipt conflicts. PostgreSQL serializes
ingestion with consent withdrawal and rechecks active purpose consent in the
transaction. A revoked batch cannot be newly ingested through a retry.

`EncryptedObservationOutbox.swift` is a producer integration primitive, not an
enabled producer. Its caller must supply a device-only Keychain AES-256 key and a
dedicated app-group path. It stores AES-GCM authenticated ciphertext scoped to
device, activation and recovery epoch, caps at 128 batches/1 MiB, refuses overflow
without eviction, refuses uploads after 24 hours or clock rollback, and removes a
batch only after receipt ID, digest and accepted count match. Corrupt data is
preserved and rejected. The caller must canonicalize exactly the transmitted JSON
and revalidate live consent before upload. No iOS observations or collecting claim
are synthesized. Keychain provisioning and the real observation producer remain
integration/release gates.

## Backups and drills

`backup-collector.sh` streams a custom PostgreSQL dump directly into age encryption,
uploads only ciphertext to a preconfigured off-host rclone destination and verifies
the ciphertext by download. Run primary and revocation-authority jobs under separate
service credentials, recipients/retention policies and recovery administration.
Use protected local pg_service/pgpass and age identity files; never put credentials
in shell history, reports or source. Backup failures must alert an operator.

`restore-collector-drill.sh` accepts only an empty database named `kicks_restore_*`,
uses one transaction, and never cleans or overwrites existing tables. Verify the
ciphertext against an independently retained manifest before decrypting; a checksum
beside a backup is not protection against malicious replacement. The drill restores
to an isolated environment; it must not share live device or gateway credentials.

Logical dumps provide snapshots, not point-in-time recovery. Enable WAL archiving
and retention through the actual database provider after identifying it, then test
recovery to a time immediately before and after a consent withdrawal. Record backup
age, WAL gap, restore duration, last committed batch receipt, ownership history and
revocation reconciliation. Do not claim RPO/RTO or PITR until that drill passes.
The restore script now requires `KICKS_RESTORE_EXPECTED_SHA256` from an independently
retained manifest and verifies ciphertext before contacting the target database.
It rejects a missing/mismatched digest and symlink input. This is an integrity
preflight; it does not establish who signed or retained the manifest.

Outbox reads and mutations now take an exclusive nonblocking filesystem lock,
including across separate actor instances/processes. Busy storage rejects the
operation for retry rather than overwriting another writer's state. Authenticated
archives also validate entry digests and unique batch identities. Local diagnostics
report only queue state/count: pending, empty, expired/clock-skew retained,
storage busy, or unreadable retained. A retained file is never treated as empty.
Storage diagnostics do not authorize an upload or enable collection.

The authenticated device gateway status reports a bounded reason, check time,
acknowledgment age when available and request ID. Reasons distinguish pending/stale
gateway acknowledgment, clock skew, inactive authorization, recovery hold/epoch
mismatch, and unavailable dependencies. Unexpected exceptions become generic
unavailable states; their messages are not returned. Not-ready checks emit a
structured reason event. The native setup uses fixed messages for recovery holds,
inactive permission and service outages. These are point-in-time diagnostics,
not historical metrics, alerts or physical-device collection evidence.

Off-host configuration, scheduling, retention lock, provider WAL/PITR and a real
restore drill remain operational setup requirements.
