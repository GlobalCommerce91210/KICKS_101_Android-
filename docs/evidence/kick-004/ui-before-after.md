# KICK-004 UI evidence — source comparison

This is source evidence, not rendered screenshot or physical-device proof. Baseline is commit `0557bb5bac9cae86ddf8c39aad3417e5a93c5fb7`. Modified files are on this branch.

| Trigger | Before | After | Source |
|---|---|---|---|
| Web/Android wallet API fails | Approved $24.80; pending $4.20; settled $12.50; lifetime $37.30; demo user and simulated-credit controls | Authenticated account wallet; `UNAVAILABLE`, reference ID and “Wallet service unavailable”; no inferred numeric balance | `apps/mobile/app/wallet.tsx`, `apps/mobile/components/AccountWallet.tsx` |
| Wallet succeeds with numeric zeros | Missing and real zero could be indistinguishable in account wallet | `$0.00 earned`, `Pending: $0.00`, `Settled: $0.00`, `SUCCESS`, only after schema-valid numeric response | `AccountWallet.tsx`, `requestState.ts` |
| Wallet refresh fails after valid load | Previously loaded data discarded | `STALE WALLET · previously loaded` with failed request state/reference, bounded to five minutes and same account | `AccountWallet.tsx` |
| Profile refresh pending/fails | Valid data erased at refresh start | Previously loaded data retained with explicit stale notice; monitoring status withheld while pending/failed | `apps/mobile/app/profile.tsx` |
| Devices payload is `{}` or contains null records | Could display a successful empty list or fail during rendering | `ERROR` / unavailable source; no confirmed empty list or enrollment success | `profileService.ts`, `AccountPermissions.tsx` |
| Devices response is `{devices: []}` | Empty conflated with missing shape | Source state `EMPTY`; “No linked devices” for successful no-record response | `profileService.ts`, `apps/mobile/app/my-devices.tsx` |
| Shopping load fails | Error only in console, placeholder estimated dollars/scores | Visible unavailable/retry screen; no placeholder numeric success | `apps/mobile/app/opportunities.tsx` |
| User presses shopping “Grant & Connect” | Local state displayed “Agreement Enforced on Ledger” | Explains that authenticated acceptance API is unavailable; no agreement/payment recorded | `opportunities.tsx` |

The automated service suite asserts zero/empty/error/cache distinctions. Baseline and modified web exports compile. Rendered UI behavior, accessibility and physical-device behavior still require acceptance testing.
