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
