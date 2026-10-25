# KICK'S zero-trust collector boundary

Status: mandatory architecture rule.

- Deny every device and write by default.
- Authenticate every request; private-network location is never identity.
- Store only hashes of device bearer credentials and support immediate revocation.
- Authorize each observation against the current subject, consent identifier, exact purpose, and consent state.
- Reject unknown fields so payloads, URLs, query strings, and unapproved identifiers cannot enter the metadata store.
- Reject batch replay and cap body and batch sizes.
- Keep staging and production identities, credentials, databases, encryption keys, and logs separate.
- Redact credentials from application logs and return `no-store` responses.
- Treat the Android client, device, network, forwarding gateway, API, operators, and partners as independently untrusted.

The service must continue to say `metadata-only` and `staging` until persistent storage, encrypted forwarding, revocation, deletion, monitoring, and a physical-device test pass end to end.


## KICK-011A.4 — Collector and OS permission gate

The Android app exposes an explicit collector status contract: `UNAVAILABLE`, `DISCONNECTED`, `CONNECTING`, `VERIFYING`, `VERIFIED`, and `VERIFICATION_FAILED`. A UI state is not proof of collection. `VERIFIED` is permitted only after native forwarding health and backend/device-bound verification both succeed.

The current 0.2.6 implementation intentionally returns `UNAVAILABLE`; the native forwarding path is not implemented, and enabling the build flag alone cannot mark it available. The VPN service must not establish a TUN interface until a complete forwarding implementation exists; silently routing device traffic into an incomplete tunnel would break connectivity and create a privacy risk. This is a fail-closed release gate, not a claim that the collector is complete.

Before enabling collection, the implementation must:
- confirm the device token against the persistent backend and verify the latest purpose-specific consent event;
- require explicit monitoring activation, Android VPN authorization, and notification permission;
- establish a real native forwarding path and capture only minimized, approved metadata;
- report status transitions from native service health, not a UI toggle;
- stop collection on consent revocation, authentication loss, permission loss, service failure, or backend verification failure;
- never label demo observations as live network traffic.
- implement and independently verify the iOS permission/collector path; no iOS collector verification is included in this release.

The merged Android manifest should contain only permissions justified by active features. The 0.2.6 manifest removes broad external-storage read/write permissions and the system-overlay permission because the collector/UI does not need them. Re-add a permission only with a documented feature requirement and reviewed user-facing disclosure.
