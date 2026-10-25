# KICK-iOS-001 reconciliation verification gate

This branch starts from KICK-011A durable consent and imports the existing iOS account-bound enrollment components without activating collection.

## Migration and ownership contract
- Apply the KICK-011A consent migrations and the iOS account/binding migrations in a reviewed, ordered deployment. Never reset existing devices or consent events.
- Before migration 004, inspect for duplicate active device ownership; abort and remediate manually rather than deleting or reassigning a device.
- Migration 005 preserves device-owner history; revoked device IDs must not be silently reassigned.
- The iOS provisioning transaction must atomically persist the device, account binding and replay record. The same request and proof may replay only while the original binding and device remain active.
- The authenticated account subject, collector subject and physical device ID are separate identifiers. Do not equate account authentication with collection authorization.

## Required integration tests (not yet verified)
1. Existing account/device binding and historical consent events survive the migrations and process restart.
2. Concurrent requests for the same device by different accounts: one wins, the other receives a non-disclosing conflict.
3. Reuse of request ID with changed device, token, account or public key fails.
4. Exact replay succeeds only when original active ownership and token proof remain valid.
5. Revoked binding/device cannot be revived by a retry or a different account.
6. Database unavailable during enrollment, consent write or recovery: no success response and no collector activation.
7. The iPad client fetches and verifies its active account-bound device after provisioning and after restart.
8. Consent grant/revoke remains durable, purpose-specific and append-only; enrollment alone cannot start collection.
9. Physical iPad signing, extension provisioning, VPN connectivity, stop/revoke and network recovery must pass independently.

## Release status
BLOCKED. Imported code is not a validated integration. No PostgreSQL integration test, signed iOS build, device installation or native collector acceptance was executed as part of this import. Keep monitoring disabled.
