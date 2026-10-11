# Backend and monitoring recovery — release held

Base: implementation/consumer-onboarding-20261010, 2fd54bcf86dd68ea65ca58acf789b2628f349c91.
Work branch: fix/monitoring-backend-verification-20261011.

## Implemented in this change

The API launcher wires a durable staging gateway enrollment service when explicitly enabled. It requires a separate authority secret, host, public key, port and complete reviewed purpose/policy. It returns the same non-secret monitoring policy through an account-authenticated endpoint consumed by both native controls and Permissions, removing missing baked-in build variables as a blocker. No policy ID or approved purpose is invented. Gateway enrollment rejects a different permission ID from the configured policy.

The launcher connects an injectable identity delivery worker over authenticated HTTPS, with no redirects, a bounded timeout and sanitized failures. The worker contract is a POST body containing subject_id, email, kind and token. It must deliver email verification, password reset and MFA challenge messages; it must not log credentials or tokens. Configuration alone is not proof of email receipt. Outside tests, registration and email/reset requests refuse to pretend delivery is available when no notifier is configured.

The native provider exposes device/permission/activation/expiry evidence for a still-valid server-issued lease. The app requests that evidence with a three-second timeout and validates it against native Keychain state. VPN startup waits for the OS to connect; it no longer treats startVPNTunnel as synchronous. Collection remains false: a lease, OS connection or handshake does not prove metadata ingestion. The extension still expires and stops after five minutes; continuous native lease renewal and metadata collection are unfinished.

The previously successful Windows-only signing/Go changes are incorporated into source: existing Apple team and EAS project/bundle identifiers, extension metadata, checksum-verified Go 1.19.13 bootstrap. No certificates, devices or project identities were replaced. Go checksums were checked against https://go.dev/dl/?mode=json&include=all. Xcode compilation of this new patch has not run.

## Host configuration required

Keep existing encrypted credentials and datastorm_kicks_staging on WORKSPACE-PERSO. Do not switch computers, reset PostgreSQL passwords, uninstall applications, change collector subjects, or clear device data.

- KICKS_ENVIRONMENT=staging, durable existing DATABASE_URL or KICKS_DATABASE_URL, correct HTTPS KICKS_PUBLIC_API_URL.
- KICKS_IOS_PROVISIONING_ENABLED=true.
- KICKS_IOS_GATEWAY_ENABLED=true.
- KICKS_IOS_GATEWAY_HOST, KICKS_IOS_GATEWAY_PORT, KICKS_IOS_GATEWAY_PUBLIC_KEY: values from the actual isolated gateway, not the API HTTPS host by assumption.
- KICKS_IOS_GATEWAY_AUTHORITY_SECRET: separate private credential, at least 32 characters. The actual gateway runner must use it and the staging internal peer endpoint.
- KICKS_MONITORING_PERMISSION_ID, KICKS_MONITORING_PURPOSE, KICKS_MONITORING_PURPOSE_VERSION, KICKS_MONITORING_POLICY_VERSION: exact reviewed existing permission and scope; keep compatible with existing grants.
- KICKS_IDENTITY_DELIVERY_URL, KICKS_IDENTITY_DELIVERY_SECRET: actual private HTTPS delivery worker and separate credential, at least 32 characters.

Apply the existing schema compatibility migrations only after verifying schema ownership, backups and duplicate consent preflight. Migration 001 changes audit actor UUID to text without changing the stored values. Migration 002 adds collector metadata infrastructure. Migration 003 refuses duplicate requests rather than deleting ledger history. Do not run schema.sql blindly on the protected public database. The existing deploy-staging-api.ps1 resets checkout state and does not establish that a Windows service points at the candidate; it is not a safe substitute for a compatible preserved service launcher.

## Evidence and unresolved dependencies

Read-only public checks in this Work session: /health HTTP 200, durability postgres; GET /core/identity/v1/account HTTP 404. Public deployment remains unfinished. This Linux execution environment has GitHub access but no connected shell to WORKSPACE-PERSO or the iPad. No service launcher or database migration was changed remotely.

The gateway directory explicitly contains undeployed preparatory infrastructure. Live host availability, peer reconciliation, firewall/IPv4/IPv6 forwarding and real handshake remain unverified. No approved monitoring-policy values or delivery-worker endpoint were supplied in this session.

## Required acceptance before another release

1. Apply compatible staging migrations with preserved consumer/device/consent/collector records; launch exact candidate under the existing service credentials and verify persistence after restart.
2. Run node scripts/verify-staging-readiness.mjs. This checks public routing and configuration, not full journey completion.
3. Verify a dedicated test account: registration, real email delivery/confirmation, login, token rotation, restored session, profile hydration, logout, reset and MFA where enabled. Confirm no secret tokens in responses/logs outside tests.
4. Verify device provisioning replay, account ownership, exact consent, gateway enrollment, authoritative peer reconciliation, revoke/regrant, five-minute expiry, authority outage and Linux watchdog cleanup.
5. Implement and test continuous native lease renewal and the approved metadata ingestion path; obtain durable backend evidence before changing collecting to true.
6. Compile the native candidate, install in place on the registered iPad, approve KICK’S VPN in the app, and verify OS profile, handshake, egress, stop/revoke, expiry and fresh accepted metadata. Preserve the existing app/device state.

Responsible domain: Technology implementation; Product acceptance; Onboarding account journey; Operations host coordination; Intelligence evidence review. These describe responsibilities, not verified running agents.

## Local validation

Workspace typecheck and Expo web export passed. Mobile: 59 passed, 0 failed. API: 52 passed, 0 failed, 3 PostgreSQL tests skipped (no test DB in this environment). Gateway: 28 mocked tests passed. Public readiness probe failed on missing routes/configuration; no deployment claimed. Swift/Xcode and installed-device validation remain open.

## Profile recovery

Signed-out Profile now renders a sign-in/create-account screen instead of returning null during navigation. Session restoration and unavailable backend states remain visible. A route error boundary provides Retry/Open account. Invalid mandatory account responses produce recoverable errors, and malformed device entries/display names cannot be rendered as React child objects. Live profile data remains dependent on the public staging route deployment. No iPad visual/runtime acceptance claimed.
