# Collector candidate reconciliation — October 10, 2026

## Correction to the earlier candidate assessment

`d5ab15c1a35273faff52174d95f571f1d999e3a7` contains the newer shared account/iPad
screens and dependency repairs, but does **not** contain the implemented Android
collector or persistent collector API from the milestone workstream. Its newer
date and passing CI do not establish collector completeness.

Recovered sources:

- M3 collector continuity: `61ced3bf4c0b816341c4ecae95be84014fdb17bb`.
- M5 persistent API / hardening: `144468c33c730fa2c53a19aa3ebbba8361a87b91`.
- Shared account-consent integration: `14600d8c06bd5294985da0075c1036c60f93d102`.

The first two branch histories diverge from the shared iOS candidate. This local
integration preserves the newer iPad account/Profile/Permissions screens, app
identifiers, iOS EAS project and dependency patches; brings in the existing
collector/native Android sources, persistent API, device bindings and hardened
identity lifecycle; and takes the transactional account-consent store/routes,
database migrations and regression tests from the integration branch. It does
not promote or deploy any of those services.

Android collector source contains DNS forwarding, durable uploads, session
journaling, consent and recovery. It does not prove current deployment or device
operation. Its local DNS forwarding design cannot simply be copied into an
Apple Packet Tunnel Provider. Preserve platform separation and the intended VPN
research model while the submitted Apple inquiry is pending.

## Native iOS increment

The local `kicks-tunnel` Expo module adds native Keychain reads, exact extension
and VPN-profile matching, OS profile authorization, provider start, confirmed
stop, and conservative OS status. The UI discovers Expo JSI modules and retains
legacy-bridge compatibility. No new account/device identity, credential or
commercial permission is generated. Missing/expired enrollment and a missing
embedded extension reject activation.

This increment does **not** close the entire native collector gap. An embedded
Packet Tunnel Provider, WireGuardKit plus Go build integration, native expiring
enrollment issuance, and independent consent/ingestion evidence remain required.
The adapter explicitly reports `consentVerified: false` and `collecting: false`
until that evidence protocol exists. A connection alone cannot turn collection
on. Do not treat this increment as an installable collector candidate.

## Checks and limits

- Local API typecheck passed.
- API tests: 44 passed; PostgreSQL restart test skipped without a test database.
- Mobile consent/session/profile/native-discovery tests: 49 passed.
- Informational iOS enrollment gate tests: 3 passed separately.
- Mobile typecheck, web export and Apple autolinking discovery passed in an
  isolated dependency harness; that harness resolved newer SDK 57 patch versions
  than the canonical lockfile. Exact-lockfile macOS CI is still required.
- Windows cannot compile/sign the iOS Network Extension. No new signed IPA,
  TestFlight submission, iPad install, live observation, or partner transfer is
  established by these checks.

Next gate: exact-candidate macOS compilation and completion of the embedded
provider/transport and native evidence protocol, then signing and TestFlight
installation. Physical collector tests follow installation. Apple policy
clarification and production gates remain separate.
