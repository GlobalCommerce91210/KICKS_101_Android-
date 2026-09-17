# M2 — DataStorm Consumer Identity Lifecycle

Baseline: KICK'S 0.2.6 release head `5068e7a67f9a6404d0f5f2de1bdc6d83411a1c26`.

## Ownership boundary

DataStorm owns the master consumer identity. KICK'S remains a product entitlement/profile attached to the stable DataStorm `subject_id`.

Creating an identity does **not** grant:

- monitoring consent
- commercial-data authorization
- marketplace/buyer authorization
- compensated-opportunity authorization
- marketing consent

`marketing_opt_in` remains a separate identity field.

## Account creation and idempotency

Account creation requires an `Idempotency-Key`.

For production PostgreSQL, the raw key is SHA-256 hashed before persistence. The durable record stores only:

- hashed idempotency key
- request fingerprint
- resulting `subject_id`

A replay with the same key and fingerprint reconstructs the prior account/entitlement/profile result. Reuse of the same key with a different request fingerprint is rejected.

The production record survives API process restarts because it is stored in PostgreSQL. Memory mode remains a staging/test fallback only.

## Email verification

New account creation issues a one-use, expiring `email_verification` token. Requesting a new token revokes an outstanding token of the same kind. Confirmation consumes the token and activates the account. Replays, expired tokens, revoked tokens, and tokens belonging to closed accounts fail closed.

Raw lifecycle tokens are never stored; only SHA-256 hashes are persisted.

## Sessions

Successful authentication creates:

- short-lived access token
- refresh token
- hashed token records in the identity store

Refresh rotates the session by revoking the previous session before issuing the replacement. Suspended and closed accounts cannot authenticate, use an access token, or refresh a session. Logout revokes the current access session.

Password reset revokes all active sessions.

## Password recovery/reset

Password-reset requests return a generic accepted response so account existence is not disclosed. A valid account receives a one-use, expiring password-reset token through the configured token-delivery hook. Confirmation consumes the token, replaces the password hash, and revokes active sessions.

## Beta MFA strategy

Beta MFA uses a one-time email challenge.

When MFA is enabled:

1. Primary email/password authentication is checked.
2. The preliminary session is immediately revoked and never returned to the client.
3. A one-use, expiring `mfa_challenge` token is issued through the token-delivery hook.
4. A valid challenge creates the real authenticated session.
5. Challenge replay fails.

A production email provider is an external delivery dependency; the API exposes a notifier hook so provider credentials do not become part of identity logic. Test-only token exposure is enabled only when `NODE_ENV=test`.

## Account closure / consumer deletion flow

Authenticated `DELETE /core/identity/v1/account` closes the DataStorm identity and performs the following identity-layer actions:

- account status -> `closed`
- email -> deterministic non-routable anonymized value
- password hash -> unusable deletion marker
- email verification -> false
- MFA -> disabled
- region -> removed
- marketing opt-in -> false
- free-form identity metadata -> cleared
- KICK'S entitlement -> revoked
- KICK'S profile -> suspended
- active sessions -> revoked
- outstanding identity lifecycle tokens -> revoked

## Collector-history consequence

Account closure does **not** delete, reset, re-key, or rewrite the collector subject identity or historical Moto/tablet observations.

This separation is deliberate. Collector-history retention/deletion is governed independently from identity closure so an identity action cannot accidentally destroy protected historical telemetry. M3 verifies continuity on the physical Moto/tablet path; M5 defines durable production retention, backup, restore, and authorized collector-deletion mechanics.

## Regression evidence required before M2 closure

- account creation and idempotency replay/conflict
- one-use verification + replay failure
- login/access/refresh/logout
- password reset + session revocation + replay failure
- MFA challenge + replay failure
- suspended account authentication/refresh denial
- closed account authentication/refresh denial
- zero implicit monitoring/commercial/marketplace authorization
- collector counts/history unchanged by identity closure
- full typecheck, web build, API regression suite, Android Kotlin compile and release artifact build green on the M2 head
