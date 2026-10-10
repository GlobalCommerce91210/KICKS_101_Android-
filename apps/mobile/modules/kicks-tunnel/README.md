# iOS native connection adapter

Local Expo module, autolinked only on Apple platforms. The shared consent flow
loads it through Expo's JSI registry, with compatibility for existing React
Native bridge builds. Android never loads this adapter.

The implementation reads existing native Keychain enrollment, checks that the
matching extension is embedded, creates an OS VPN profile only after the shared
consent checks, starts the matching provider, and waits for confirmed shutdown.
It does not create accounts, device bindings or credentials, replace duplicate
profiles, export secrets to JavaScript, enable on-demand activation, or infer
consent/collection from VPN connectivity.

This is the connection adapter milestone, **not a completed collector**. The
embedded Packet Tunnel Provider, WireGuardKit/Go build integration, native
enrollment issuer and extension ingestion-evidence protocol remain open. Status
therefore never asserts verified consent or collection; the shared activation
flow stops a connection that cannot establish those assertions.

The existing Keychain boundary remains service `com.datastorm.kicks.collector`,
account `device-configuration-v1`. Reading additionally requires `deviceId`,
`permissionId`, `tunnelServerHost`, and a valid ISO-8601 `expiresAt` at most five
minutes ahead. Historical records without these properties are preserved and
rejected, never silently migrated or replaced. This adapter does not issue or
renew that authorization. The eventual provider must independently enforce its
expiry and authoritative consent. Keychain access groups and provisioning must
be validated on the signed app and extension before any device activation.

Windows JavaScript tests do not compile Swift or establish signing, extension
embedding, packet forwarding, collector operation, or policy acceptance. The
canonical macOS iOS validation workflow must compile this module on the exact
candidate before a signed build is attempted.
