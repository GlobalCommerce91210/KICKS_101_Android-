# iOS native connection and provisioning adapter

Local Expo module, autolinked only on Apple platforms. Android never loads this adapter. The optional embedded WireGuard provider and build integration live in `../../native/PacketTunnel` and `../../plugins`.

## Explicit native provisioning

`provision(apiOrigin, accountBearer, accountSubjectId)` is an explicit enrollment action and returns only the public device identifier. It accepts an ephemeral account bearer from the existing account session; it never persists or refreshes account tokens. The origin must exactly match the staging API. Native code generates a 32-byte cryptographically random device proof and CryptoKit X25519 key pair, then stores a prospective request/device identifier and the secrets before contacting `POST /core/consumer/v1/ios-devices/provision`.

The server authenticates the existing DataStorm account and establishes the separate collector-device binding. No duplicate human account is created. The same persisted request identifier, public key, device identifier and proof are used for unchanged retries after a lost response. The response must confirm the actual account subject and device, with `provisioned` or `replayed` status, before native state becomes confirmed. Failed requests leave a pending record rather than rotating credentials or creating another device on retry.

New state is stored in Keychain service `com.datastorm.kicks.collector`, account `device-provisioning-v1`, accessible after first unlock on this device only. A different account/origin, malformed existing record, or legacy collector configuration is rejected and preserved. The first write uses `SecItemAdd`; records are not silently replaced. No private key or device proof is exported to JavaScript. Android's operator-provisioned credential is never reused on iOS.

## Grant and lease sequence

After confirmed provisioning, `getDeviceId` returns the existing native device identifier and `prepare` verifies provisioning and the embedded extension. The shared flow must verify/save current account-bound consent before calling `renewLease(accountBearer, permissionId)`. Native code supplies the device proof and public key to the account-authenticated gateway lease endpoint. It checks the exact device/grant, activation identifier, bounded expiry, gateway key/port, dual-stack addresses and DNS shape, then combines the public response with the native private key. The provider performs further address/key validation.

The resulting lease lives in `device-configuration-v1`. Renewal may update only a recognized managed record for the same device and private key; historical records are preserved and rejected. Lease issuance does not establish research collection. Both HTTP operations use ephemeral sessions with standard TLS, reject redirects, disable cookies/cache, bound time/response size, and expose only generic failures. Neither bearer, proof, keys nor raw server errors are logged or returned to JavaScript.

## Connection and evidence boundary

The shared flow authorizes the OS VPN profile only after verified consent and lease delivery. The adapter uses a Keychain persistent reference, preserves duplicate profiles for review, disables on-demand activation and waits for confirmed shutdown. The provider independently expires the five-minute lease. The signed app and extension must share their configured Keychain group and Network Extension capabilities.

This is still **not a verified working collector**. The provider status does not assert consent or observation ingestion; shared activation stops an unverified connection. Immediate revocation enforcement, backend deployment, gateway forwarding, encrypted-route/leak testing, accepted observations, signing and installed-iPad behavior remain validation gates. Windows source checks do not compile Swift. The exact candidate's macOS device compilation workflow must validate the complete transport separately from simulator adapter checks.
