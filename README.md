# KICK'S Mobile Hub — Android Native + Expo/React Native

This repository is the **single source of truth for active KICK’S mobile development**.

It combines:

- **Native Android layer** for device-level capabilities, Android-specific integrations, collectors, services, and performance-critical modules.
- **Expo/React Native layer** at `apps/mobile` for the cross-platform KICK’S application.
- **Shared product logic** for agents, event schemas, design tokens, navigation models, consent-aware flows, and the unified KICK’S user journey.

## Canonical mobile workspace

| Area | Canonical location | Status |
| --- | --- | --- |
| Native Android | Repository root / Android modules | Active |
| Expo / React Native | `apps/mobile` | Active — source of truth |
| Expo package | `@kicks/mobile` | Active |
| Current Expo version | `0.2.5` | Current |
| Next functional target | `0.2.6` | Planned |
| Legacy Expo repo | `GlobalCommerce91210/KICK_S_App/apps/mobile` | Deprecated — no new work |

> **Routing rule:** All new KICK’S mobile work goes to this repository. Do not route new mobile development to `KICK_S_App/apps/mobile`.

## Hybrid architecture responsibilities

### Native Android

Use native Android for platform-specific capabilities such as device integrations, services, collectors, permissions, secure storage, networking hooks, and other functionality that requires direct Android APIs.

### Expo / React Native

The active Expo app lives at:

```text
apps/mobile/
```

Current workspace metadata:

- Package: `@kicks/mobile`
- Version: `0.2.5`
- Expo SDK: `57`
- React Native: `0.86.2`
- React: `19.2.3`
- Router: Expo Router

Expo owns the shared cross-platform application shell, screen flows, navigation, design system, and reusable consumer-facing logic.

### Shared system layer

Native Android and Expo should converge on the same product contracts, including:

- agent interfaces and event handling
- verified-action and consent event schemas
- design tokens and Night/Light themes
- navigation and journey definitions
- identity and account state
- reward/progression state
- partner-action state

Platform implementations may differ, but product behavior and contracts should remain aligned.

## Development

From the repository root:

```bash
npm install
npm run typecheck
npm run test
npm --workspace @kicks/mobile run start
```

To run Android through Expo when appropriate:

```bash
npm --workspace @kicks/mobile run android
```

For native Android work, use the repository's Gradle/Android Studio workflow.

## Versioning direction

The Expo workspace is currently **0.2.5**. The next aligned KICK’S functional release target is **0.2.6**. Do not bump the Expo package version merely for documentation; version changes should accompany the actual 0.2.6 implementation/release gate.

---

KICK'S is the official DataStorm Inc. privacy and data-value product and app, formerly known as Kickback's. This standalone application is derived from validated concepts in the existing Base44 beta. The Base44 application remains untouched and is not the production control plane.

The current KICK'S visual layout is the product-owner-approved baseline. See `docs/DESIGN_BASELINE.md`. The fast-track production collector and Android beta gates are defined in `docs/ANDROID_BETA_LAUNCH_PLAN.md`.

Collector and ingestion work follows the mandatory deny-by-default controls in `docs/ZERO_TRUST_COLLECTOR.md`. Active monitoring is not claimed until the Android forwarding path and persistent staging control plane pass end-to-end testing.

## MVP promise

KICK'S shows consumers which companies their apps communicate with, explains the commercial implications, lets consumers grant or revoke explicit data-sharing permissions, and provides access to compensated data opportunities.

## What is included

- Android-first Expo/React Native client with four focused surfaces: Activity, Permissions, Opportunities, and Wallet.
- KICK'S-owned API boundary with versioned contracts.
- Append-only consent events and rewards transactions in the data model.
- Audit events, correlation IDs, health checks, and environment-safe configuration.
- A production path for Android traffic observation using `VpnService`, with the current UI explicitly using demo observations until the native collector is implemented and reviewed.
- Launch-gate documentation covering identity/KYC, consent enforcement, payout reconciliation, monitoring, revocation, and recovery.

## Explicitly frozen

Business and government portals, social/community features, referrals, seasonal experiences, consumer scoring, dynamic pricing recommendations, broad analytics, marketing automation, AI assistants, subscriptions, and speculative privacy/security claims.

## Quick start

```bash
npm install
npm run typecheck
npm run test
npm --workspace @kicks/api run dev
npm --workspace @kicks/mobile run start
```

Copy each `.env.example` to `.env` for local work. Never commit secrets or production user data.

## Status

This repository is an implementation-ready MVP scaffold, not a production launch. Demo traffic observations and opportunities are synthetic. Real KYC, real payouts, and device-wide traffic monitoring remain gated integrations.

The web presentation is deployed through Vercel from `main`; Android remains the primary product target.
