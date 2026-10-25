# KICK'S 0.2.6 — implementation notes

## Included in this build candidate

- Durable PostgreSQL device identity and append-only purpose-specific consent events.
- Request IDs, persisted expected sequence, stale-decision rejection, and same-payload idempotent retry behavior.
- Device token revocation endpoint and authenticated current-purpose collector eligibility endpoint.
- Retryable persistence/authentication failures return HTTP 503 with `Retry-After`; protected ingestion fails closed.
- Android native collector status contract, VPN authorization check, notification permission gate, and backend eligibility verification bridge.
- Collector UI distinguishes demonstration observations from live collection and displays OS/backend readiness checks.
- Removed unused broad storage and system-overlay permissions from the Android manifest.
- Android app version bumped to 0.2.6 / versionCode 3.

## Important release boundary

The Android native forwarding collector is **not yet implemented end to end**. The build keeps `COLLECTOR_ENABLED=false`, reports the collector as `UNAVAILABLE`, and refuses activation. This is deliberate: enabling a VPN before a safe forwarding path exists could interrupt device connectivity or misrepresent collection. The next required implementation is the real metadata-only native forwarding/ingestion path, followed by device-bound backend verification, revocation stop behavior, and physical-device acceptance.

## Verification status

Automated tests, migration application, Android build, API restart recovery, and physical-device collector acceptance are intentionally pending until the implementation sequence is complete. Do not merge, distribute, or enable monitoring based solely on these source changes.

- Added a mobile consent API helper that retries transient persistence failures using the same request ID and payload; it refuses non-HTTPS endpoints.
- Native permissions API configuration no longer silently targets `localhost` on a physical device.

## Remaining integration gaps before calling consent end-to-end

The existing Permissions screen still uses the legacy permissions endpoints and demo user ID. It is not yet fully wired to the new durable consent ledger because the app-side authenticated device enrollment/session flow must first supply a securely stored device token and real UUID-backed permission identity. Do not treat a change in the legacy Permissions screen as proof that the PostgreSQL consent event was persisted.

- Added PostgreSQL metadata-batch persistence with device-active checks, purpose-specific consent revalidation under the same permission lock as grant/revoke writes, and duplicate batch rejection.
- Added database-backed test cases for persisted metadata, replay rejection, and revocation blocking ingestion; these are authored but not yet executed.
