# KICK'S MVP — Android First

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
