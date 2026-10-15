# Native encrypted transport increment

`PacketTunnelProvider.swift` uses the official WireGuardKit package pinned by the Expo plugin to revision `2fec12a6e1f6e3460b6ee483aa00ad29cddadab1`. This is a remote encrypted transport, not Android's local DNS proxy copied to iOS.

The plugin creates and embeds `com.datastorm.kicks.PacketTunnel`, adds the packet-tunnel entitlement and shared native Keychain group, and links WireGuardKit. It does not create or change remote Apple certificates, profiles, team membership, or app identities. Enable it only with the explicit native-tunnel build configuration; default adapter compilation is not transport compilation.

The pinned upstream Go runtime patch requires Go 1.19 on the macOS builder. The plugin's bridge build rejects simulators; validate with the `iphoneos` SDK. Windows config generation cannot establish native compilation. The package downloads upstream Go dependencies during its bridge build. No secrets belong in build settings.

## Provisioning contract

The existing native-only Keychain entry `com.datastorm.kicks.collector` / `device-configuration-v1` remains the boundary. The provider reads its persistent reference supplied by the OS profile. It requires existing `deviceId`, `permissionId`, `tunnelServerHost`, ISO8601 `expiresAt` no more than five minutes away, plus:

```json
{
  "wireguard": {
    "privateKey": "native-only base64 WireGuard private key",
    "serverPublicKey": "gateway base64 WireGuard public key",
    "serverPort": 51820,
    "addressIPv4": "issuer-assigned IPv4 CIDR",
    "addressIPv6": "issuer-assigned IPv6 CIDR",
    "dnsServers": ["issuer-approved DNS IP"]
  }
}
```

Private key generation/storage and authenticated lease delivery belong to native enrollment, never JavaScript. A legacy configuration is rejected and preserved. Both address families are required, both default routes are directed into WireGuard, and persisted `includeAllNetworks` / `enforceRoutes` must be enabled with local exclusions disabled. These settings do not by themselves prove zero leaks: iOS can exempt system traffic, and device packet-capture tests remain necessary. Gateway IPv6 forwarding or deliberate IPv6 blocking must be tested explicitly.

The provider refuses mismatched profile/device/grant/server identities, missing credentials, invalid addresses/keys/DNS, and expired leases. It stops the transport at lease expiry. There is no automatic renewal or extension of authorization. Immediate server-side revocation enforcement and active consent polling remain separate integration requirements.

## Evidence boundary

Status reports `transportConfigured` only; `consentVerified` and `collecting` remain false. No handshake, packet counter, or VPN-connected flag is treated as observation ingestion. This increment does not implement hostname/app attribution, a research observation pipeline, backend provisioning, gateway deployment, or signed-device verification. Do not enable research collection or claim an installed working collector from project generation or adapter checks.
