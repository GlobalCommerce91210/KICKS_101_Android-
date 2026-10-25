# Architecture and ownership

The Android client is interchangeable. The KICK'S-owned API is authoritative for identity references, consent, permissions, opportunities, rewards, audit evidence, and monitoring metadata.

```text
Android app
  |-- activity explanations
  |-- consent decisions
  |-- opportunities and wallet
  `-- future local VpnService collector
          |
          v
KICK'S API -> PostgreSQL
  |-- append-only consent events
  |-- permission projection
  |-- opportunity eligibility
  |-- double-entry rewards ledger
  `-- immutable audit-event sink
```

The collector must observe metadata locally, minimize before upload, never capture payload bodies, and require clear device-level disclosure. The API accepts normalized observations only after authentication, device registration, rate limiting, and schema validation.

## Environments

Development, staging, and production use separate credentials, databases, identity tenants, KYC projects, payout accounts, telemetry destinations, and signing keys. Production data must never be copied into lower environments.

## Launch evidence

A release is blocked until the lifecycle succeeds end to end: real MFA, KYC, consent grant, one opportunity, versioned agreement, minimized data result, immutable reward entry, sandbox payout, revocation enforcement, audit export, backup restore, and negative authorization tests.


## KICK-011C — collector authorization release gate

All collector-derived data must pass the shared backend `CollectorAuthorizationService` boundary using authoritative current consent, immutable receipt linkage, independently verified blockchain proof and finality, enrolled device, server-verified OS permissions, current policy/disclosure, and revocation state. Client eligibility is informational only. Metadata ingestion must reauthorize inside the same database transaction/locking domain as the commit. The verifier/database adapter is not wired in this branch; absence is a hard deny. Native collection remains disabled, and no production deployment is approved until KICK-011A/B dependencies and concurrency/restart tests pass.
