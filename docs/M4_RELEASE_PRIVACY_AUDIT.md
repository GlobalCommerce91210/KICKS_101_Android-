# M4 — KICK'S 0.2.6 Release Privacy, Consent, VPN and Permission Audit

Baseline: `release/0.2.6-engine-merge` at `5068e7a67f9a6404d0f5f2de1bdc6d83411a1c26`.

## Safety boundary

- `C:\KICKS`, existing Moto/tablet datasets, collector subject IDs, and historical observations are protected source-of-truth data.
- M4 does not reset, clean, overwrite, re-key, or destructively migrate collector history.
- Monitoring consent is independent from commercial-data authorization, marketplace/buyer authorization, compensated opportunities, and marketing.
- New users, apps, metadata categories, and buyers fail closed unless explicitly authorized.

## 0.2.6 collector/VPN behavior verified from release source

`KicksVpnService` requires both a provisioned collector configuration and a fresh `ActiveMonitoringSession` before it starts. It establishes an Android VPN TUN, routes the configured DNS monitor, forwards protected DNS traffic, records minimized hostname/app-attribution metadata, writes uploads to a durable queue, retries deferred uploads, emits lifecycle/heartbeat records, and shuts down when Android revokes VPN authorization or repeated transport failures occur.

Foreground disclosure:

- title: `KICK'S metadata monitoring`
- text: `Consent-linked destination metadata only`

The release manifest declares the service with `BIND_VPN_SERVICE`, `FOREGROUND_SERVICE`, and `FOREGROUND_SERVICE_SPECIAL_USE`. The special-use subtype states: `User-authorized, consent-gated, metadata-only privacy monitoring VPN`.

## Android permission disposition

Required/retained in the 0.2.6 release integration:

- `INTERNET` — API/DNS transport.
- `FOREGROUND_SERVICE` — active monitoring service.
- `FOREGROUND_SERVICE_SPECIAL_USE` — declared VPN monitoring foreground-service subtype.
- `POST_NOTIFICATIONS` — foreground monitoring disclosure/notification.
- `BIND_VPN_SERVICE` — service-level Android VPN authorization.

Removed from the application source manifest because no release runtime requirement was established:

- `SYSTEM_ALERT_WINDOW`
- `READ_EXTERNAL_STORAGE`
- `WRITE_EXTERNAL_STORAGE`
- `VIBRATE`

CI now inspects the Gradle-generated merged **release** manifest after `assembleRelease`. The quality gate fails if any of the four removed permissions reappear, or if the required VPN/special-use declarations disappear. The merged manifest is copied into the uploaded build artifact for audit evidence.

## Authorization-domain separation

1. **Monitoring / collector** — governed by collector provisioning, Android VPN authorization, and exact-purpose consent/activation.
2. **Commercial metadata use** — permission engine metadata category must be explicitly `allowed`; default is `blocked`.
3. **Marketplace / buyer access** — user app/buyer permission controls remain separate from metadata category controls. Marketplace matching is an internal candidate calculation, not external data delivery or payment execution.
4. **Compensated opportunities / wallet** — wallet permission enforcement requires explicit grants and denies new earning/payout activity after relevant blocking/revocation.
5. **Marketing** — DataStorm identity `marketing_opt_in` is a separate identity field and is not inferred from monitoring or commercial permission.

## Fail-closed changes in this integration

- Unseen metadata categories now start `blocked`, including operational metadata.
- Intelligence gates now start `blocked` for all seven categories.
- Missing intelligence gates fall back to `blocked`.
- `conditional` never counts as marketplace authorization.
- Marketplace matching ignores offers that declare `consent_required=false`; an offer cannot bypass authorization semantics.
- New app and buyer permission collections remain empty until explicitly set.

## Data Safety / Play disclosure mapping for beta

Collected by the monitoring collector when explicitly active:

- destination hostname / DNS destination metadata
- protocol and bounded traffic-size bucket at the API contract layer
- source-app attribution and bounded attribution evidence when available
- event/session identifiers and timestamps
- consent/activation linkage and collector lifecycle/heartbeat metadata

Not authorized by monitoring consent alone:

- commercial use
- buyer/marketplace sharing
- compensated-opportunity execution
- marketing

The collector contract is intended to exclude raw payload contents, URL query strings, arbitrary headers, passwords, account numbers, message contents, and arbitrary extra identifiers.

## Revocation and denial behavior

- Collector ingestion requires active exact-purpose consent at the API boundary.
- Android VPN revocation calls `onRevoke`, stops the active monitoring session, and tears down the TUN/service.
- Permission/wallet regression coverage verifies later blocking denies new earning/payout behavior.
- Identity account closure is handled separately under M2 and must not delete or rewrite collector history.

## Remaining release dependencies

M4 can validate what the 0.2.6 application declares and enforces, but final production retention/deletion periods and durable deletion implementation depend on M5's persistence design. M5 must preserve historical Moto/collector data while defining retention, backup, restore, and deletion behavior for production stores.

No external buyer data transfer is enabled by this M4 candidate-matching engine. Any future buyer-delivery path must add authenticated subject/buyer authorization and purpose-limited delivery before it can be treated as marketplace sharing.
