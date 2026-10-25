# KICK-013 silent-agent pilot foundation

## Current status

This change adds a deterministic, in-process report builder for allowlisted, minimized evidence. It is not an autonomous agent, does not collect evidence, and is not connected to a scheduler, API route, worker, or report store. It cannot execute recommendations.

| Area | Repository evidence | Pilot status |
| --- | --- | --- |
| API health | `GET /health` in `services/api/src/server.ts` returns a fixed staging/metadata-only response. | A basic endpoint exists; its response is not a live availability, latency, or error measurement. |
| Diagnostic and intelligence data | The API's `IntelligenceEngine` seeds demo events in memory. The Android `KicksVpnService` stops without establishing a TUN interface. | No verified live Android telemetry source is established by this repository. |
| Consent and audit | Consent logs are held in the in-memory `PermissionsEngine`. `services/api/db/schema.sql` defines consent/audit tables, but the API does not connect to them. | No production audit query, append-only report store, or agent read identity is established. |
| Database counts | The SQL file describes tables; no aggregate read adapter or source-of-truth count definitions are wired into the API. | Reconciliation cannot run until approved read views and aligned count definitions/windows exist. |
| CI/build evidence | `.github/workflows/quality.yml` runs typecheck and tests on pull requests and main pushes. | CI is event-triggered evidence only; it is not an agent scheduler or production health signal. |
| Schedulers and reporting | The repository has no monitoring schedule, event hook for these agents, or daily report persistence. | Do not create or activate one under this pilot. |
| iOS | No iOS app target or signed Network Extension validation evidence is present in this repository. | iOS health/count and collector verification remain unknown. |

The current `GET /v1/permissions/.../consent-log` and intelligence summary routes expose demo/in-memory state and do not establish an agent-scoped, technically read-only identity. They must not be treated as approved production evidence sources.

## Deterministic report contract

`services/api/src/silentAgent.ts` exports `buildPilotReport`. It accepts a typed evidence bundle from its caller and returns a report with a run ID, generation time, reporting window, rules version, evidence references and source timestamps, confidence, limitations, supplied source failures, and recommendation-only text.

- Android and iOS findings are separate. Missing, stale, future-dated, or out-of-window health signals are `unknown`, not healthy.
- Event IDs are deduplicated before the count is reported; identifiers are not included in the report.
- Consent findings distinguish a reported revocation from downstream blocking. Only fresh evidence reporting both is a fact; processing still active is an inference, and absent evidence is unknown.
- Counts are compared only when device, API, audit, and database aggregates are all present exactly once, fresh, nonnegative, and share the same definition and exact reporting window. Otherwise the result is unknown/incomparable.
- iOS collector wording is gated on an evidence record reporting a valid signature, a signed Network Extension, and physical-device validation. The report builder does not validate artifacts or devices itself; a human must review the cited validation evidence. Without qualifying input, verification stays unknown.
- Evidence references and run IDs must use opaque `evidence:<handle>` and `run:<handle>` forms; other values are replaced with `[REDACTED]`. The bundle must still be minimized and sanitized by an approved source before it is passed to this function.

The four report roles are `observability-quality`, `consent-guardian`, `api-service-watcher`, and `reconciliation`. This module performs no network or database reads, consent changes, retries, repository writes, or other side effects. Facts mean the supplied evidence reports the stated value; they are not independent verification of the source.

## Approval-gated gaps

Before any staged pilot can be considered, an owner must identify approved, technically enforced read-only identities and allowlisted sources for Android, iOS, API, consent/audit, database aggregates, crashes, and CI. Define freshness limits and count semantics, establish sanitization at the source, and prove source isolation. The repository does not currently provide these controls or sources.

The scheduled 1–5 minute checks, 5–15 minute reconciliations, event triggers, daily report delivery, append-only run history, bounded retries, deduplication policy, and kill switch are proposals—not configured capabilities. Evaluate them against existing approved infrastructure and obtain explicit approval before any configuration or activation. If suitable existing capacity, source access, storage, or technical read-only boundaries are unavailable, stop at a proposal. Do not add a control plane, credentials, collectors, schedules, production changes, or execution pathway as part of this foundation.
