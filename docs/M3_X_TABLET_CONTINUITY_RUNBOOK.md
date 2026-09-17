# M3 — X-Tablet Collector Continuity Validation Runbook

Locked baseline: `89bfe4de8f358ff69f101040528116e68d9ff198` (RC72).

## Safety boundary

- Use the X-tablet as the primary physical systems-test device for M3.
- Never uninstall KICK'S from the protected X-tablet to resolve upgrade problems.
- Never clear app data, collector state, VPN state, or protected collector datasets as part of validation.
- Never rewrite collector subject identity.
- Never run destructive migrations against preserved tablet datasets or `C:\KICKS` source data.
- If upgrade or binding attempts would require destructive recovery, stop and record a P0/P1 blocker instead.

## Required pre-upgrade evidence

Capture before touching the protected X-tablet installation:

1. X-tablet device serial and Android build identity.
2. Installed KICK'S package version and signing certificate fingerprint.
3. Existing collector subject ID.
4. Existing collector configuration identifiers that are safe to record.
5. Historical observation count and bounded sample identifiers/timestamps.
6. Pending durable-upload queue count if available.
7. Current monitoring-consent state and consent ID/purpose.
8. Snapshot/export of relevant protected dataset metadata without modifying source files.

Store evidence in OneDrive under `KICKS-026/06_Backups_Protected_Data` and `KICKS-026/07_QA_Logs_Checksums`.

## Upgrade test

1. Verify the candidate artifact source SHA equals the locked RC SHA or a later explicitly approved green replacement.
2. Verify signing certificate continuity before upgrade.
3. Install as an in-place update only.
4. Do not use uninstall, clear-data, reset, re-provision-from-zero, or collector cleanup as a workaround.
5. Confirm collector subject ID is unchanged after first launch.
6. Confirm preserved historical count/sample remains accessible.

## Account binding test

1. Bind the existing X-tablet collector to the DataStorm/KICK'S account.
2. Confirm account binding adds relationship state only.
3. Re-read collector subject ID and historical count/sample.
4. Fail the test if binding rewrites collector identity, deletes history, or creates a replacement collector namespace.

## Live collection continuity

1. Start monitoring only through the existing explicit consent + Android VPN authorization path.
2. Record session-start evidence.
3. Generate a bounded set of normal network activity on the X-tablet.
4. Confirm new metadata-only observations arrive under the same collector subject.
5. Verify old and new records are simultaneously accessible.

## Offline/replay test

1. With monitoring active, interrupt network connectivity without clearing app state.
2. Generate a bounded set of monitorable events.
3. Record queue depth/pending state if observable.
4. Restore connectivity.
5. Verify durable queue replay succeeds without duplicate destructive re-provisioning.
6. Confirm replayed events retain the same collector subject and consent linkage.

## Unbinding test

1. Capture historical count/sample immediately before unbinding.
2. Unbind account/device relationship only.
3. Confirm collector history remains present and readable.
4. Confirm collector subject ID remains unchanged.
5. Rebinding may restore account relationship but must not recreate collector history.

## Reboot recovery

1. Reboot the protected X-tablet normally.
2. Do not clear VPN/app data during reboot recovery.
3. Verify the app can recover its persisted collector configuration.
4. Verify monitoring remains consent-gated and does not silently restart outside Android/user authorization rules.
5. Confirm historical data and collector identity remain unchanged.
6. Confirm new monitoring can resume and upload after authorization.

## Evidence / result record

For every test record:

- X-tablet serial/build
- app version/versionCode
- app signing fingerprint
- source commit SHA
- artifact SHA-256
- collector subject ID before/after
- historical record count/sample before/after
- new event IDs/timestamps
- replay result
- bind/unbind result
- reboot result
- defect IDs and severity

### Severity

- **P0:** data loss/corruption, destructive migration, subject rewrite, consent/security bypass. Stop promotion immediately.
- **P1:** upgrade/auth/collector/VPN/replay unusable without data loss. Release blocked.
- **P2:** recoverable defect without data/security impact. Fix only if beta acceptance requires it; do not expand scope.

M3 is complete only when protected X-tablet evidence proves continuity. CI or source inspection alone is not a substitute for the physical-device acceptance criteria.
