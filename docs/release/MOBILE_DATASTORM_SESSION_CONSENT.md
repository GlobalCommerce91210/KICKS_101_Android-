# Mobile DataStorm session and consent integration
Base mobile changes: PR #25, e6f6774d8af4e936b84066dfba3ff43f38fa7af4.
Backend dependency: existing feature/consumer-api-v1 account/device routes plus PR #26 account-bound consent endpoints.
These changes are a reviewable mobile implementation; they are not installed on the founder's iPad or deployed to a backend.

## Consumer behavior
Settings → My DataStorm account opens sign-in for an existing DataStorm account.
Sign-in validates the account and active KICK'S entitlement/profile. It does not create monitoring consent.
Passwords are cleared from the form after each attempt and are never stored by the session layer.
Native session recovery stores only an origin-bound refresh token in Expo SecureStore with WHEN_UNLOCKED_THIS_DEVICE_ONLY accessibility; access tokens stay in memory.
Web uses volatile memory and intentionally requires sign-in after a page reload. No localStorage token is introduced.
Startup refreshes the session and checks account/product access again. Expiring concurrent requests share one refresh. A 401 clears the session.
Sign-out clears local credentials and requests server revocation. If server revocation cannot be confirmed, the app reports that distinction.
Secure-storage deletion failure remains visible across screens with a retry action and is surfaced and must be resolved before treating device sign-out as complete.
Session generations prevent late login/restore/refresh responses from restoring a signed-out or switched account.
No token or password is logged.

Permissions now uses the account session rather than user_demo_01 or the demo PermissionsEngine routes.
It lists only server-authorized device bindings, reads authoritative ledger decisions, and posts explicit grant/revoke decisions.
Missing account, device binding, backend availability or reviewed configuration keeps consent controls unavailable.
Unconfirmed writes disable controls until the saved decision is reloaded. A saved permission never claims iOS collector activity.

## Deployment configuration (public values, no secrets)
EXPO_PUBLIC_API_URL: verified HTTPS base URL serving the established DataStorm identity and KICK'S consumer endpoints. Do not route a native device to localhost.
EXPO_PUBLIC_MONITORING_PERMISSION_ID: reviewed UUID matching the intended existing device permission. Do not use a new ID to bypass a denied permission.
EXPO_PUBLIC_MONITORING_POLICY_VERSION and EXPO_PUBLIC_MONITORING_PURPOSE_VERSION: reviewed exact versions.
EXPO_PUBLIC_MONITORING_PURPOSE: exact reviewed purpose text matching the collector contract.
No default grant, default permission UUID or automatic monitoring activation is supplied.
If an existing decision has a different purpose/version, the app blocks changes pending a reviewed update.
Do not put an admin secret, collector credential, password or consumer token in Expo public variables.
Device binding must be established through the existing proof-of-possession workflow; this UI does not copy or rewrite collector subjects.

## Dependencies
Expo SDK 57's installed bundledNativeModules.json specifies expo-secure-store ~57.0.4 and expo-crypto ~57.0.3.
Both dependencies and the root npm lockfile are updated together. The SecureStore config plugin is added to app.json.
A new native build is required; the installed baseline cannot receive the new native module through a JavaScript-only update.
Keep the same bundle ID and signing team. Do not uninstall or clear app data.

## Acceptance sequence
1. Review and integrate PR #25, PR #26, and this mobile PR with their respective backend/mobile base branches. This mobile PR is stacked on #25.
2. Verify staging identity, KICK'S access, bound device and exact reviewed consent configuration.
3. Build and install an in-place internal iOS upgrade through EAS.
4. Sign in with a synthetic staging account; verify the correct devices and account.
5. Relaunch while online: session refresh should restore the account. Offline/expired/revoked session must fail visibly.
6. Explicit grant → reload decision → relaunch → revoke → collector ingestion denied, with backend audit evidence.
7. Sign out → relaunch → confirm signed-out state; verify server token revocation separately.
8. Verify Keychain behavior and secure-storage failure handling on the physical iPad.
iOS extension/forwarding, commercial sharing, study enrollment and payouts remain separate unverified gates.

## Validation
Local mobile typecheck, web bundle export and 15 routing/session tests passed before publication.
Tests cover refresh rotation, entitlement denial, storage failure, environment isolation, refresh deduplication, 401/logout, server sign-out uncertainty, and late login/restore races.
Native simulator validation and CI are recorded on the PR. Passing pure session tests does not prove Keychain behavior or a physical-device account journey.

