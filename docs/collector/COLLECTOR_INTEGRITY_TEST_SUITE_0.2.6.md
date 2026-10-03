# Collector Integrity Test Suite — KICK’S Mobile 0.2.6

**Status:** One Spec verification artifact  
**Canonical app:** `GlobalCommerce91210/KICKS_101_Android-/apps/mobile`  
**Package:** `@kicks/mobile`  
**Release:** `0.2.6`

## Purpose

Validate that the collector / Verified Action intake pipeline behaves correctly after the 0.2.6 upgrade while preserving the One Spec architecture.

> This document defines required behavior and acceptance criteria. It does **not** claim that a Jest/Expo executable harness is already present in `apps/mobile`. The current mobile workspace has no `test` script, so implementation of automated JS/mobile tests remains a release task.

## Intended test locations

- JS / Expo verification target: `tests/collector/` or an equivalent mobile test workspace added deliberately to the repo.
- Native Android verification: Android instrumentation tests associated with the collector/native layer.
- Existing CI must be extended only when the test runner is actually introduced.

## A. Event Intake Tests

### A1 — Accepts valid VerifiedActionEvent

Input:

```json
{
  "id": "evt_001",
  "type": "scan",
  "timestamp": 1696272000,
  "metadata": { "partnerId": "p_001" },
  "userId": "u_001"
}
```

Expected:

- Collector accepts event.
- Emits or records the equivalent of `collector:received`.
- No schema error occurs.
- Event remains eligible for downstream processing.

### A2 — Rejects invalid schema

Input conditions:

- Missing `id`.
- Invalid field type.
- Missing required metadata where the contract requires it.

Expected:

- Collector rejects the invalid event.
- Emits or records the equivalent of `collector:error:invalid-schema`.
- No agent processing is triggered.

### A3 — Timestamp drift handling

Input: timestamp within ±5 minutes.

Expected:

- Event is accepted.
- Timestamp normalization, if part of the implementation contract, does not alter business meaning.
- No drift warning is required.

Input: timestamp around ±30 minutes.

Expected:

- Collector records or emits a timestamp-drift warning.
- Event handling follows the existing non-breaking contract.
- Processing is not silently duplicated.

> Exact drift thresholds must match the implemented collector contract. If the production code uses different thresholds, update this test spec rather than changing runtime behavior solely to satisfy the draft threshold.

## B. Agent Dispatch Tests

### B1 — Reward processing occurs once

Expected:

- Reward-processing path receives an eligible verified event once.
- No duplicate invocation for the same event identity.
- Retry behavior remains idempotent.

### B2 — Progression processing occurs once

Expected:

- Progression / ladder state is updated when thresholds are met.
- Equivalent of `progression:updated` is observable in the implemented state/event layer.
- Replayed duplicate input does not double-increment progression.

### B3 — Engagement processing occurs once

Expected:

- Next-best-action state is recalculated when applicable.
- Equivalent engagement recommendation output is observable.
- Duplicate intake does not produce duplicate recommendations unless explicitly allowed by the contract.

### B4 — Partner action processing

Expected:

- Eligible partner events reach the partner-action path.
- Ineligible or malformed partner events do not create rewards.
- Partner processing follows the same event identity/idempotency rules.

## C. UI Update Tests

### C1 — Feed surface updates

Expected:

- Newly accepted verified action appears once in the consumer activity/feed surface represented by the current One Spec UI.
- Timestamp formatting is correct for the active UI contract.
- No duplicate render for a duplicate event.

### C2 — Ladder / progression surface updates

Expected:

- Progression state changes only when thresholds are met.
- Any animation triggers once per real transition.
- Rehydration does not replay the transition as a new reward event.

### C3 — Rewards surface updates

Expected:

- Eligible reward state is displayed.
- Reward unlock occurs once.
- Duplicate/replayed events do not duplicate balances or unlock state.

### C4 — Partner surface updates

Expected:

- Partner-action state is rendered from the same canonical event/agent output.
- UI does not synthesize a partner reward that the agent/state layer did not produce.

## D. Stability Tests

### D1 — High-volume event intake

Input: 100 events over 10 seconds.

Expected:

- No silent event loss within the supported queue/transport contract.
- No duplicate downstream processing.
- UI remains responsive.
- Queue/backpressure behavior is observable and bounded.

### D2 — Offline mode

Expected:

- Events that are eligible for offline retention are queued according to the implemented storage contract.
- Reconnect processing is ordered/idempotent.
- Already-acknowledged events are not replayed as new rewards.

### D3 — Process restart / rehydration

Expected:

- Durable collector state survives an app/process restart when required by the active collector design.
- In-flight state does not create duplicate reward/progression outcomes.

## Release acceptance

Collector integrity is considered verified only when the executable implementation proves:

- valid/invalid event handling,
- idempotent dispatch,
- reward/progression consistency,
- UI state consistency,
- offline/reconnect behavior,
- high-volume stability,
- Android native continuity behavior,
- and no breaking change to the existing Verified Action / agent contracts.
