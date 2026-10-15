# Separate iOS staging gateway

Selected transport: WireGuard, on an isolated Linux host with UDP 51820. This directory is preparatory infrastructure, not a deployed gateway or a working collector. No host, endpoint, keys, or Apple entitlement has been provisioned.

## Enrollment and authority

The iPad generates its private key in native secure storage; only its public key leaves the device. An authenticated DataStorm account session must bind the device, verify an active grant for the existing approved collector purpose/version, and issue a short-lived gateway lease. Account credentials and collector credentials remain distinct. The gateway receives an authoritative public-key/address peer set from the enrollment service; it must not trust a client-supplied authorization string. The renderer validates the shape of that service response, not its authenticity.

`render-config.mjs` produces a public configuration from verified service responses. Leases are limited to five minutes. `reconcile.mjs` validates each complete authoritative snapshot, replaces the peer set, and requests an empty set on authority outage, malformed data, revoked/expired leases, or expiry during an update. `host-runner.mjs` now supplies the WireGuard host adapter and periodic runner, with a systemd watchdog template described below. These are source implementations tested with a mocked host, not a deployed gateway. WireGuard itself does not expire leases.

## Linux runner and process supervision

The Linux runner owns only the peer set of the fixed `kicks-staging` interface. Before each update it reads `wg showconf`, preserves the existing interface private key, listening port and fwmark, and replaces all peers with `wg syncconf`. It never accepts arbitrary command names, interface names or shell text from the authority. Its root-owned temporary configuration is created exclusively with mode 0600 inside the systemd 0700 runtime directory on `/run`, and removed after every attempt. Host private configuration is never logged. The interface must already exist and be initialized by an operator; the runner neither creates a key nor resets the host identity.

Each authority read uses authenticated HTTPS with certificate validation, disallows redirects, limits the response size, and has a three-second timeout. Host commands have a two-second timeout. The runner polls every second, clears inherited peers before starting, and clears peers on malformed/unauthorized/stale responses, failed synchronization, shutdown signals, or loop failure. It refuses leases with less than thirty seconds remaining, reserving cleanup time for the watchdog; clients must renew before that margin and host clocks must be synchronized.

`kicks-ios-gateway.service` is an uninstalled systemd template. It starts only after the existing staging WireGuard service, provides a ten-second watchdog, and executes a separate peer-clear command after normal exit, crash, forced termination or watchdog failure. Health notification occurs only after a validated authority snapshot has been applied. If synchronization fails during supervisor cleanup, the fixed staging interface is brought down without changing its key/configuration. That requires operator recovery rather than silently reopening forwarding. This is a bounded process-failure strategy, not proof against a failed kernel or host power/network failure; actual Linux watchdog and kill tests remain required.

An operator must review the host paths (`/usr/bin/node`, `/usr/bin/wg`, `/usr/bin/ip`, `/usr/bin/systemd-notify`), copy the source modules to `/opt/kicks-ios-gateway`, and provision a root-readable `/etc/kicks-ios-gateway/authority-url` pointing to the actual HTTPS staging peer endpoint. Its separate bearer credential is supplied through systemd `LoadCredential` from `/etc/kicks-ios-gateway/authority-token`; no credential is supplied by this repository. File ownership, capability restrictions, firewall, egress, systemd version, existing interface identity and restart behavior must be verified on the chosen host before enabling the unit. No host, URL or secret has been provisioned or deployed by this change.

Run `node --test infrastructure/ios-gateway/*.test.mjs` for renderer, authority failure, host-setting preservation, exclusive temporary configuration, watchdog notification ordering, cleanup fallback and expiry-margin tests. These mocked tests do not prove Linux kernel forwarding or real systemd behavior.

## Implemented enrollment contract (disabled by default)

`services/api/src/ios-gateway-enrollment.ts` reuses existing DataStorm account access, the active iOS device binding, native-held collector device proof, and the current exact purpose/policy-version consent grant. It does not create accounts, collector identities, tokens, keys or consent. It issues a five-minute public lease tied to the existing activation, with IPv4 `/32` and IPv6 `/128` addresses. Private keys remain native-only. Collection remains disabled: routing authority is not evidence of collection.

The account-authenticated `POST /core/consumer/v1/devices/:deviceId/ios-gateway-lease` accepts `{ permissionId, publicKey, deviceToken }`. The device token must be supplied by native enrollment, never added to the app's JavaScript configuration. The response includes `deviceId`, `permissionId`, `activationId`, `purposeVersion`, `expiresAt`, `tunnelServerHost`, `collectionEnabled: false`, and `wireguard: { serverPublicKey, serverPort, addressIPv4, addressIPv6, dnsServers }`. Native code must combine this public response with its existing private key in shared secure storage. The HTTPS request must not disable server certificate validation.

The internal peer-set endpoint requires a separately injected gateway-authority authenticator. Every snapshot rechecks account/product access, active iOS binding, device revocation, exact current grant and activation, and lease expiry. Regranting consent does not revive an old activation. Client-provided authorization flags are not trusted. The response excludes human identity, tokens and token hashes. Snapshots are time-bounded and contain no collection records.

`buildServer` does not auto-enable these routes through environment defaults. Until a staging operator explicitly supplies the actual public gateway configuration, a `PostgresGatewayLeaseStore`, and authority authentication, enrollment returns unavailable and the peer endpoint rejects access. The in-memory lease store is for boundary tests only. PostgreSQL allocates unique addresses under an advisory transaction lock, preserves assignments on renewal/restart, rejects another account reusing an active device lease, and expires assignments before reuse. The existing PostgreSQL workflow now exercises lease restart and competing allocations; local PostgreSQL execution remains dependent on an explicitly supplied test database.

## Native device provisioning (before consent)

`POST /core/consumer/v1/ios-devices/provision` requires an authenticated DataStorm account with active KICK’S access. Native code first persists a prospective `requestId`, `deviceId`, a securely random 32-byte base64url device proof and its X25519 key pair, then submits `{ requestId, deviceId, deviceToken, publicKey }` over HTTPS. The actual account subject comes exclusively from the bearer session; client-supplied account fields are rejected. The server stores the proof hash only, atomically inserts a separate collector subject/device and account binding, and returns `{ deviceId, accountSubjectId, status: 'provisioned' | 'replayed' }`. This issues neither consent nor a tunnel lease. It does not duplicate the human account.

Identical retries are durable and return the same identity after a lost network response. Changed proofs, reused public keys, device-ID collisions, cross-account replay and revoked bindings are rejected; plain inserts never overwrite/revive an existing record. A maximum of five active iOS devices per account bounds enrollment. Native code must preserve its pending secure record across retries rather than generate replacements. The endpoint is unavailable by default; staging deployment requires a real database and explicit `KICKS_IOS_PROVISIONING_ENABLED=true`, or an explicitly injected provisioner. Production wiring stays disabled. The memory provisioner is test-only. The PostgreSQL workflow tests durable replay and rollback of device/binding writes on a conflicting public key.

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
