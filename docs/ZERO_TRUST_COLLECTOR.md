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

## Android collector audit

The Android collector remains deliberately unavailable. This workstream does not implement packet interception, VPN forwarding, payload inspection, or network-content capture. The forwarding flag in the native service is false and the Expo Gradle plugin sets `COLLECTOR_ENABLED` to false; both conditions must be true before the native module can report an enabled collector.

Current execution paths:

- **Startup:** Expo Router mounts the app without starting a collector. The Engine screen reads native status on mount; it reports `UNAVAILABLE` for this build. No collector is started by the app layout or other screens.
- **Resume:** There is no Android service restart, resume callback, or periodic collector/status worker. Engine status is refreshed only on mount or by its explicit refresh action; it is not refreshed automatically on resume.
- **Eligibility:** The native module accepts an explicit activation request and makes up to three bounded HTTPS eligibility attempts. It does not persist the result. No current screen calls the eligibility method, so the required in-memory eligibility gate remains false and native `start()` rejects.
- **Start/stop:** The Engine start control is disabled unless the status is verified; the settings monitoring control is now disabled and remains visibly off. The API refuses to request VPN or notification authorization while native status says unavailable. Native start independently requires eligibility, VPN authorization, notification permission on Android 13+, and both build/forwarding flags. Stop clears the in-memory eligibility gate and asks the service to stop.
- **Service:** If manually invoked, the service is non-sticky and exits because forwarding is not implemented. It does not establish a TUN, start a persistent notification, or collect traffic. There is no live service-health status.
- **Scheduled work and buffering:** No WorkManager, JobScheduler, AlarmManager, periodic collector task, local observation queue, buffered batch, or drain/retry worker exists in `apps/mobile`.
- **Native setup:** The Expo config plugin registers the React Native package, copies the Kotlin bridge/service into the generated Android project, declares the VPN service, and configures the false build flag. The checked-in repo contains the plugin and Kotlin sources rather than a generated Android project.

The plugin does not declare a foreground-service type or add foreground-service/notification permissions while collection is unavailable. It retains only the non-exported VPN service protected by `BIND_VPN_SERVICE`; app configuration blocks external-storage and overlay permissions. The authorization UI does not prompt for VPN/notification access while the collector is unavailable. Add only the permissions justified by an implemented, verified feature and a target-SDK-specific manifest review.

**Release blockers:** A safe production collector cannot be completed within this audit: the requested scope excludes implementing the forwarding/interception path, and the current repo has no forwarding implementation, persistent queue/drain, verified live service-health reporting, revocation-triggered shutdown, or end-to-end device validation. Keep `COLLECTOR_ENABLED=false` and status `UNAVAILABLE`; do not describe demo samples or UI status as live collection. The new `npm run test:collector-guard` is a source-level fail-closed regression check only; it does not validate Android manifest merging, OS authorization, VPN behavior, or physical-device behavior.
