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
