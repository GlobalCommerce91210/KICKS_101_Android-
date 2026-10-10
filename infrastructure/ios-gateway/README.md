# Separate iOS staging gateway

Selected transport: WireGuard, on an isolated Linux host with UDP 51820. This directory is preparatory infrastructure, not a deployed gateway or a working collector. No host, endpoint, keys, or Apple entitlement has been provisioned.

## Enrollment and authority

The iPad generates its private key in native secure storage; only its public key leaves the device. An authenticated DataStorm account session must bind the device, verify an active grant for the existing approved collector purpose/version, and issue a short-lived gateway lease. Account credentials and collector credentials remain distinct. The gateway receives an authoritative public-key/address peer set from the enrollment service; it must not trust a client-supplied authorization string. The renderer validates the shape of that service response, not its authenticity.

`render-config.mjs` produces a public configuration from verified service responses. Leases are limited to five minutes. `reconcile.mjs` now validates each complete authoritative snapshot, replaces the peer set, and requests an empty set on authority outage, malformed data, revoked/expired leases, or expiry during an update. Its injected host adapter is not yet connected to WireGuard. A deployed runner must refresh before expiry, reconcile frequently for revocation, and use an independent supervisor/watchdog to clear peers on process death. WireGuard itself does not expire leases. Do not deploy until those host controls and their failure tests exist.

## Implemented enrollment contract (disabled by default)

`services/api/src/ios-gateway-enrollment.ts` reuses existing DataStorm account access, the active iOS device binding, native-held collector device proof, and the current exact purpose/policy-version consent grant. It does not create accounts, collector identities, tokens, keys or consent. It issues a five-minute public lease tied to the existing activation, with IPv4 `/32` and IPv6 `/128` addresses. Private keys remain native-only. Collection remains disabled: routing authority is not evidence of collection.

The account-authenticated `POST /core/consumer/v1/devices/:deviceId/ios-gateway-lease` accepts `{ permissionId, publicKey, deviceToken }`. The device token must be supplied by native enrollment, never added to the app's JavaScript configuration. The response includes `deviceId`, `permissionId`, `activationId`, `purposeVersion`, `expiresAt`, `tunnelServerHost`, `collectionEnabled: false`, and `wireguard: { serverPublicKey, serverPort, addressIPv4, addressIPv6, dnsServers }`. Native code must combine this public response with its existing private key in shared secure storage. The HTTPS request must not disable server certificate validation.

The internal peer-set endpoint requires a separately injected gateway-authority authenticator. Every snapshot rechecks account/product access, active iOS binding, device revocation, exact current grant and activation, and lease expiry. Regranting consent does not revive an old activation. Client-provided authorization flags are not trusted. The response excludes human identity, tokens and token hashes. Snapshots are time-bounded and contain no collection records.

`buildServer` does not auto-enable these routes through environment defaults. Until a staging operator explicitly supplies the actual public gateway configuration, a `PostgresGatewayLeaseStore`, and authority authentication, enrollment returns unavailable and the peer endpoint rejects access. The in-memory lease store is for boundary tests only. PostgreSQL allocates unique addresses under an advisory transaction lock, preserves assignments on renewal/restart, rejects another account reusing an active device lease, and expires assignments before reuse. The existing PostgreSQL workflow now exercises lease restart and competing allocations; local PostgreSQL execution remains dependent on an explicitly supplied test database.

## Host deployment prerequisites

Use a dedicated staging VM with a public UDP endpoint, WireGuard tooling, forwarding and a scoped egress firewall. Generate the gateway private key on the host with restrictive file permissions; never commit it. Limit peer source addresses to 10.88.0.0/24 and fd88:4b49:434b::/64, with a unique /32 and /128 per peer. Both families require verified gateway egress or explicit rejection; assigning an IPv6 address alone does not prove forwarding. Block access to private, link-local, cloud metadata and management networks; prevent peer-to-peer forwarding. An operator must review actual interface names and firewall rules on the selected host before enabling forwarding. No permissive NAT template is supplied.

The HTTPS enrollment endpoint needs real TLS and account/device-bound consent enforcement. An HTTP-only deployment cannot act as the WireGuard UDP gateway. Do not expose a public registration endpoint that directly executes `wg` or accepts arbitrary shell values.

## iOS app prerequisites

Integrate WireGuardKit into an embedded Packet Tunnel Provider target, with its Go bridge build dependency, Network Extension provisioning and matching app/extension capabilities. Follow https://git.zx2c4.com/wireguard-apple/about/#wireguardkit-integration. A successful visual IPA does not establish these capabilities. Tunnel connection, handshake and authorized collection are separate states.

WireGuard forwarding does not supply application names, TLS URLs, HTTP methods, or consent evidence. Do not fabricate these from packet counters. Collection remains disabled until a metadata path is explicitly implemented under the existing approved categories, with revocation and durable ingestion verified. No payload recording, TLS interception, or additional consent purpose is authorized by this package.

## Validation, rollback and rebuild

Run `node --test infrastructure/ios-gateway/render-config.test.mjs` from the repository root. These are offline boundary tests; they do not establish traffic forwarding, enrollment, revocation propagation or collection.

Before a deployment: test unauthorized enrollment, cross-account device binding, duplicate enrollment, durable restart, lease expiry, authority outage, revocation and a real tunnel handshake against the exact candidate. Retain commit SHA, dependency revisions, signed IPA identifier, endpoint/configuration hashes with secrets excluded, and test timestamps.

Rollback by disabling new enrollment, removing all staging peers and stopping the gateway interface. Stop the app tunnel before reverting the app. Preserve the installed baseline ff8b405040fae40893f07e00918f6e8015594ff8 and device data. Rebuild from a recorded commit with pinned WireGuard dependencies and unchanged bundle identity; signing must cover both app and extension. No production changes or protected merges are included.
