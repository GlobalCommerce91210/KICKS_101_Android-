# KICK'S cross-platform identity and collector gates

## Identity provider

Repository review found no configured identity provider, login SDK, or account contract. The root `.env.example` contains an empty `OIDC_ISSUER`; there is no audience, JWKS URL, or configured signing-key trust. Do not replace this dependency with passwords created by the app or accept a client-supplied account subject.

Authenticated enrollment must verify a provider-signed token, including its signature, issuer, audience, expiry, and subject. Enrollment is unavailable until those values and a trusted JWKS endpoint are configured. The existing `/v1/staging/devices` route remains an admin-only staging tool and is not a mobile sign-up flow.

The mobile app has no sign-in provider today. Secure credential storage can persist a device token, but cannot authenticate a person or mint a provider identity token. Do not enable Permissions actions until a real identity provider supplies a verified token and enrollment is confirmed.

## Android collector

The tracked Android service is a stub, not a packet forwarder:

- `apps/mobile/native/android/src/main/java/com/datastorm/kicks/vpn/KicksVpnService.kt` sets `FORWARDING_IMPLEMENTED` to `false`, stops without establishing a TUN, and processes no packets.
- `apps/mobile/plugins/withKicksVpn.js` sets `COLLECTOR_ENABLED` to `false`.
- There is no bounded metadata queue, packet-processing/forwarding implementation, upload/drain worker, live native health proof, or revocation-triggered service shutdown.

Do not establish a TUN until a reviewed implementation can forward supported IPv4/IPv6 traffic without disrupting connectivity, protect upstream sockets from loops, minimize metadata before persistence, and stop/discard data on every authorization or OS-permission failure. Do not claim that VPN permission or API eligibility proves collection.

## iOS/iPadOS collector

No iOS native project, Swift source, `NEPacketTunnelProvider`, Network Extension configuration, WireGuard implementation, iOS bundle identifier, entitlement file, provisioning profile, or EAS iOS signing configuration is tracked in this repository. There is therefore no existing iOS tunnel path to extend or verify.

An iOS/iPadOS collector requires an Apple Developer account and a registered App ID with the appropriate Network Extension packet-tunnel entitlement, signed provisioning, an iOS build configuration, and physical-device validation. Those Apple-controlled prerequisites are not present here. Do not describe the iPad collector as operational or add a duplicate/bypass tunnel in their absence.

## Release state

Keep collection OFF by default and `COLLECTOR_ENABLED=false`. The release remains blocked on a configured and verified identity provider, end-to-end secure device-session lifecycle, real Android forwarding and authorization shutdown, and an independently implemented and signed iOS Network Extension path. This document records prerequisites; it does not assert that any native collector is working.

## Platform acceptance gates

These platform-specific cases are future acceptance gates, not tests run or evidence of current support.

### Android

1. **Secure session restore:** Enroll with a verified identity token; restart the app; confirm the device credential is restored from Keystore-backed storage and the API still recognizes the active device.
2. **Logout and revocation:** Log out while online; confirm backend revocation and local credential deletion. Revoke the device remotely and confirm the next session refresh clears local credentials and protected calls fail.
3. **VPN authorization loss:** In a future forwarding build, revoke Android VPN or required notification permission; confirm the service stops and discards buffered observations.
4. **Forwarding and connectivity:** In a future forwarding build on physical Android devices, verify supported IPv4/IPv6 DNS and TCP/UDP flows preserve ordinary connectivity, `VpnService.protect` prevents loops, and sockets/TUN resources close on network changes and stop.
5. **Metadata minimization:** Confirm no payload bytes, credentials, full URLs, or message bodies reach storage or upload; inspect only approved DNS/byte/time metadata.

### iOS/iPadOS

1. **Signed extension prerequisites:** Confirm the registered App ID, Network Extension packet-tunnel entitlement, provisioning profile, and signed build include the intended extension.
2. **Keychain session lifecycle:** Confirm a device credential survives app restart only in Keychain, is removed on logout, and is cleared after remote revocation is detected.
3. **Tunnel authorization lifecycle:** In a future `NEPacketTunnelProvider` build, revoke/stop authorization or simulate backend failure; confirm the provider terminates and discards queued observations.
4. **Forwarding and connectivity:** On physical iPhone and iPad devices, verify supported IPv4/IPv6 and DNS/TCP/UDP flows preserve ordinary connectivity, prevent tunnel loops, and clean up on network changes.
5. **Metadata minimization:** Confirm no packet payload, credentials, full URLs, or message bodies are persisted or uploaded; only explicitly allowed metadata is emitted.

### Combined release decision

The 30 consent acceptance cases remain in `apps/mobile/tests/permissions-consent.acceptance.md`. Android and iOS/iPadOS collector acceptance must be reported separately. At present, identity-provider configuration is missing, Android forwarding is a disabled stub, and iOS native collector/signing prerequisites are absent; therefore both platform collector acceptance summaries are **blocked and unverified**, and collection must remain OFF.
