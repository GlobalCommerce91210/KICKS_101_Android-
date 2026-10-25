# KICK'S zero-trust collector boundary

Status: mandatory architecture rule.

- Deny every device and write by default.
- Authenticate every request; private-network location is never identity.
- Store only hashes of device bearer credentials and support immediate revocation.
- Authorize each observation against the current subject, consent identifier, exact purpose, and consent state.
- Reject unknown fields so payloads, URLs, query strings, and unapproved identifiers cannot enter the metadata store.
- Reject batch replay and cap body and batch sizes.
- Keep staging and production identities, credentials, databases, encryption keys, and logs separate.
- Redact credentials from application logs and return `no-store` responses.
- Treat the Android client, device, network, forwarding gateway, API, operators, and partners as independently untrusted.

The service must continue to say `metadata-only` and `staging` until persistent storage, encrypted forwarding, revocation, deletion, monitoring, and a physical-device test pass end to end.


## KICK-011A.4 — Collector and OS permission gate

The Android app exposes an explicit collector status contract: `UNAVAILABLE`, `DISCONNECTED`, `CONNECTING`, `VERIFYING`, `VERIFIED`, and `VERIFICATION_FAILED`. A UI state is not proof of collection. `VERIFIED` is permitted only after native forwarding health and backend/device-bound verification both succeed.

The current 0.2.6 implementation intentionally returns `UNAVAILABLE` while `COLLECTOR_ENABLED=false`. The VPN service must not establish a TUN interface until a complete forwarding implementation exists; silently routing device traffic into an incomplete tunnel would break connectivity and create a privacy risk. This is a fail-closed release gate, not a claim that the collector is complete.

Before enabling collection, the implementation must:
- confirm the device token against the persistent backend and verify the latest purpose-specific consent event;
- require explicit monitoring activation, Android VPN authorization, and notification permission;
- establish a real native forwarding path and capture only minimized, approved metadata;
- report status transitions from native service health, not a UI toggle;
- stop collection on consent revocation, authentication loss, permission loss, service failure, or backend verification failure;
- never label demo observations as live network traffic.

The merged Android manifest should contain only permissions justified by active features. The 0.2.6 manifest removes broad external-storage read/write permissions and the system-overlay permission because the collector/UI does not need them. Re-add a permission only with a documented feature requirement and reviewed user-facing disclosure.


## KICK-011C — Verified collector authorization

`CollectorAuthorizationService` (`services/api/src/collector-authorization.ts`) is the single authoritative, fail-closed boundary for protected collection and ingestion. It is **deny-by-default**: with no `CollectorEvidenceProvider` configured every request is denied (`BLOCKED_SERVICE_UNAVAILABLE`).

### Mandatory checks (all must pass)
Valid subject → device owned by subject → active device enrollment → latest consent is GRANT → exact scope and purpose → current policy and disclosure versions → receipt linked to the current decision version → independently verified blockchain proof → required chain and finality → server-verified OS permission evidence → collector safety policy → not revoked, expired or superseded. Missing data, exceptions, timeouts, stale records and unknown statuses deny. Client-provided "verified" flags are never evidence (strict schemas reject them).

### Lifecycle
- Capabilities are short-lived (default 60 s), opaque, and bound to subject, device, scope, purpose, operation, decision version and revocation epoch.
- TTL never replaces revocation: every protected operation re-reads evidence (`validateAuthorization`, `runAuthorized`, `assertAuthorized`).
- `runAuthorized` runs the protected write inside the provider's ingestion transaction. `PostgresMetadataRepository.ingestBatch` re-validates inside the batch transaction after the permission advisory locks and before any insert, so concurrent revocation cannot commit data. In-memory ingestion re-checks synchronously immediately before commit.
- Any consent decision, consent revocation or device revocation immediately drops issued capabilities for the subject/device and invokes `onCollectorStop`. Blockchain revocation stamping is not awaited.
- A new grant needs its own independently verified receipt.

### Protected endpoint inventory
| Path | Protection |
|---|---|
| `POST /v1/metadata-batches` | device auth, strict schema, per-scope authorization, in-transaction recheck, whole-batch rejection, replay/idempotency kept, sanitized denial audit |
| `POST /v1/intelligence/events` | real events require device credentials plus `x-kicks-consent-id` + `x-kicks-consent-purpose` headers, `device_id` matching the credential, and authorization. Unauthenticated synthetic fixtures are accepted only when `allowSyntheticDevelopmentEvents` is set **and** `NODE_ENV!=='production'`; they are marked `x-kicks-event-origin: synthetic` and a request carrying credentials is never treated as synthetic |
| `POST /v1/collector/eligibility` | sanitized eligibility state; informational only for Android |
| Queues, offline sync, partner export | no such server paths exist yet; the `queue.process` and `partner.export` operations must call `runAuthorized` when added |

### Eligibility states
`BLOCKED_NO_CONSENT`, `BLOCKED_STAMP_PENDING`, `BLOCKED_VERIFICATION_FAILED`, `BLOCKED_DEVICE_NOT_ENROLLED`, `BLOCKED_OS_PERMISSION`, `BLOCKED_REVOKED`, `BLOCKED_POLICY`, `BLOCKED_SERVICE_UNAVAILABLE`, `ELIGIBLE`. Denials return `{eligible:false,state,error}` (403, or 503 + `retry-after` when evidence is transiently unavailable). The Android client treats this as informational; the backend stays authoritative.

### Evidence storage and provider (build step 1)
`db/migrations/20261026_collector_evidence.sql` adds `consent_receipts` (immutable), `chain_proofs` (stamper attempts, non-authorizing), `proof_verifications` (append-only, written only by the independent verifier), `device_enrollments`, `os_permission_attestations`, `safety_policies` and `revocation_epochs` (bumped by a trigger on every consent decision, inside the same transaction). `PostgresCollectorEvidenceProvider` maps these rows to evidence; absent rows deny. A proof counts as independently verified only if the verification is `VERIFIED`, on `KICKS_REQUIRED_CHAIN` (CAIP-2, unset => nothing verifies), finality reached, provider quorum >= 2, and the verifier identity differs from the stamper's.

### Still missing (blocking production enablement)
Nothing writes these tables yet: the receipt hashing/anchoring (stamper) worker, the independent verifier service with multi-provider quorum, Play Integrity attestation ingestion, and safety-policy administration. Until they run, every authorization is denied. A chain and finality policy must still be chosen. Simulated evidence lives only in `src/test-support.ts`.

### Migration / rollback
Run `npm run migrate` (applies all files in `db/migrations`, idempotent) and set `KICKS_REQUIRED_CHAIN`. Rollback = revert this change and drop the new evidence tables and the `consent_events_bump_epoch` trigger; the previous behaviour (consent-only checks) was less strict, so rollback is not recommended.
