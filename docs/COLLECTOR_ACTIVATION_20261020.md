# Collector activation checks

The canonical iPad flow now supports a verified transport connection instead of
rejecting every build with an unconditional unavailable status. It preserves
device credentials and existing protected app state. No live configuration,
database, VPN profile, gateway, signing credential or installed binary is changed
by this source work.

Order: authenticated reviewed policy → disclosed purpose → native enrollment and
account binding → embedded extension preflight → exact saved consent → native
gateway lease → iOS profile approval → unchanged consent activation → tunnel
startup → provider evidence → current server consent → connected, awaiting
accepted observations. Failed checks stop activation. Collection is reported only
with separate fresh accepted-observation evidence; current native code reports
`collecting: false`.

The startup wait allows up to 16 status attempts, one second apart, with a
15-second deadline checked after asynchronous status/consent reads. Individual
provider messages have a three-second timeout; network requests retain their
existing bounded timeouts. Failure cleanup calls stop and verifies inactive
status. Unknown/active status after stop directs the user to iOS VPN Settings.

Provider evidence is checked against native device, permission, activation,
unexpired five-minute lease, OS profile and Keychain reference. The provider
responds only to status-v1, exposes no keys and stops itself at lease expiry.
The app separately polls current consent every 15 seconds while mounted. In the
background the bounded lease and server gateway reconciler remain the revocation
boundaries; this does not claim instantaneous background revocation or egress
verification. There is no unattended or automatic renewal.

The API can now wire its existing durable PostgreSQL gateway lease store from
explicit staging settings. The authenticated monitoring-policy endpoint supplies
the reviewed permission and purpose to the iPad's setup, permission and unlink
screens. It returns 503 when unconfigured and never exposes gateway credentials.
Gateway issuance requires active verified email/account, KICK’S entitlement,
profile, exclusive device binding, native device proof and exact current consent.
An unrelated permission ID cannot receive a lease.

Deployment prerequisites remain explicit: existing durable staging DATABASE_URL
(or KICKS_DATABASE_URL), KICKS_IOS_PROVISIONING_ENABLED=true for native enrollment,
KICKS_IOS_GATEWAY_ENABLED=true, and approved KICKS_IOS_GATEWAY_HOST, PORT,
PUBLIC_KEY, AUTHORITY_SECRET plus KICKS_MONITORING_PERMISSION_ID, PURPOSE,
PURPOSE_VERSION and POLICY_VERSION. No default purpose, key, host or secret is
invented. The authority secret must differ from the admin secret and stay in
protected runtime configuration. Missing or malformed enabled configuration fails
startup. Gateway enablement is rejected outside durable staging.

Before a TestFlight update: review the exclusive-ownership migration and existing
duplicates; compile the exact commit with the embedded iOS extension; validate
the deployed policy, provisioning and gateway/reconciler; sign with existing
identities; then verify connection, stop, revoke, account switch, expiry, outage,
IPv4/IPv6 routes/leaks and accepted observations on the installed iPad. Build 15
is the user-reported existing build; these source changes do not update it.

Local validation: 77 mobile tests and 53 API tests pass; three PostgreSQL tests
skip without an isolated test database. Both workspace TypeScript checks and the
Expo web export pass. The activation contract test runs the real mobile flow
against real in-memory API routes with an explicitly simulated native adapter;
it verifies ordered grant/lease/OS approval, transport-only status and revocation.
It is not native compilation, a live gateway handshake, or installed-device QA.
The existing macOS tunnel and isolated PostgreSQL PR workflows provide the next
compilation and persistence checks; their results must be assessed separately.
