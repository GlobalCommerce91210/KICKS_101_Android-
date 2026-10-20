# iPad device connection and exclusive ownership

Source: canonical GlobalCommerce91210/KICKS_101_Android-, candidate c1b29e8,
isolated branch codex/device-connection-20261020. Main 6fed752 is an older source
line without the account-native enrollment implementation. The protected legacy
C:\KICKS checkout was inspected and not edited.

Connect this device now confirms the returned native device ID against the
current account's active iOS bindings before reporting success. Missing binding,
wrong account, revoked binding, server unavailability and session changes fail
without starting collection. The screen explains the next Set Up Collection
step and prevents overlapping enrollment/unlink actions during collection setup.

Memory storage rejects another active owner; PostgreSQL uses a unique partial
index on active device_id, including concurrent writers and native provisioning.
The bind route returns 409 device_already_linked without disclosing the owner.
Migration 004-single-device-owner.sql is additive and refuses existing duplicate
active owners; it does not revoke, delete, reset, or reassign records. Back up and
review existing duplicates before applying it. No live migration was run.

Validation: 68 mobile tests, 4 targeted API tests and both TypeScript checks pass.
The complete API suite reports 46 passed, 4 failed, 3 skipped. The same four
identity lifecycle/web-root failures reproduce with unchanged baseline API code.
PostgreSQL integration remains unverified; no isolated test database was supplied.
Demo: 10 tests pass, including exclusive ownership and revoke-before-reconnect.

Collector blocker: candidate KicksTunnelModule.swift status() unconditionally
returns unavailableReason and consentVerified=false. PacketTunnelProvider reports
transport configuration but not verified consent/ingestion. Activation explicitly
stops at this unsupported capability. Do not bypass it or label collection active.
Windows cannot compile/sign the iOS extension or control the user's TestFlight
installation. A functioning signed extension, gateway/backend validation and
installed-iPad acceptance remain required. The hr@legecii.com login/logout report
is user-observed evidence and was not independently reproduced here.

No signed binary was built or installed; no TestFlight upload, protected database,
collector credential, VPN profile, Cloudflare configuration or account was changed.
