# Collector → Agent → UI Flow — KICK’S Mobile One Spec

**Status:** Canonical architecture artifact for the 0.2.6 verification layer  
**Canonical app:** `KICKS_101_Android-/apps/mobile`

## Logical flow

```text
┌──────────────────────────┐
│      DataStorm Layer     │
│  Verification / policy   │
└──────────────┬───────────┘
               │ verified event / approved signal
               ▼
┌──────────────────────────┐
│        COLLECTOR         │
│  Intake / queue / guard  │
└──────────────┬───────────┘
               │ canonical dispatch
               ▼
┌──────────────────────────────────────────────┐
│            SHARED PROCESSING LAYER           │
│----------------------------------------------│
│ Reward path       → reward state             │
│ Progression path  → ladder/progress state    │
│ Engagement path   → next-best-action state   │
│ Partner path      → partner-action state     │
└──────────────┬───────────────────────────────┘
               │ canonical application state
               ▼
┌──────────────────────────────────────────────┐
│                 KICK’S UI                    │
│----------------------------------------------│
│ Activity / Feed    ← verified actions        │
│ Ladder / Progress  ← progression state       │
│ Rewards            ← reward state            │
│ Partner surfaces   ← partner-action state    │
│ Profile            ← user-level state        │
└──────────────────────────────────────────────┘
```

## One Spec rules

1. **One canonical event identity.** The same verified event must not become multiple reward/progression events because Android native and Expo both observe it.
2. **One shared behavioral contract.** Native Android may perform collection/device work, while Expo renders cross-platform UI, but both layers must converge on the same domain/state contract.
3. **Collector before UI.** UI state must be derived from accepted canonical state, not independently inferred from raw device traffic.
4. **Additive evolution only for 0.2.6.** New event types or reward rules may extend existing contracts but must not break existing event/agent consumers.
5. **Idempotency across reconnect/restart.** Replays, retries, and queued events must not create duplicate balances, ladder increments, or reward unlocks.
6. **No platform divergence.** Android-native and Expo implementations may differ internally, but exposed consumer state and navigation outcomes must remain aligned.

## Platform responsibility split

### DataStorm

- Verification/policy decision source.
- Produces or authorizes the signal that becomes canonical KICK’S intake.
- Does not delegate reward/UI truth to the device collector.

### Native Android collector layer

- Device-level observation/integration where required.
- Permission/consent gates.
- Queueing, retry, attribution, and transport mechanics.
- Must preserve event identity and consent/policy boundaries.

### Shared KICK’S logic

- Converts accepted verified actions into application state.
- Owns reward/progression/engagement/partner-action behavior.
- Must remain deterministic and idempotent for the same canonical event.

### Expo / React Native UI

- Renders application state.
- Owns cross-platform interaction, navigation, design system, and presentation.
- Must not duplicate collector or reward decisions in presentation code.

## 0.2.6 verification path

```text
DataStorm-approved signal
        ↓
collector acceptance + consent/policy gate
        ↓
canonical event identity
        ↓
shared processing/state transition
        ↓
reward/progression/engagement/partner state
        ↓
Expo/native presentation
        ↓
no duplicate state after retry, reconnect, or process restart
```

This is the One Spec alignment target for 0.2.6.
