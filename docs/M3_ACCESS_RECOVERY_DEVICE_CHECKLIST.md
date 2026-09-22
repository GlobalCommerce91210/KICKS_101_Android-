# M3 Access-credential recovery: device acceptance checklist

This checklist prepares a future **in-place** test from versionCode 9 to the
credential-only recovery candidate (versionCode 10). Source and local tests are
not physical-device acceptance evidence.

## Source and artifact gate (no device mutation)

- [ ] Record source commit for versionCode 9: `33e2312187e1e32f618451c7357d86ac70dede4d`.
- [ ] Record CI #78 / run `35189742537` and artifact
      `KICKS-0.2.6-ARM-unsigned-78`; verify its embedded source SHA,
      manifest versionCode 9, and SHA-256.
- [ ] Record the exact source SHA and SHA-256 of the proposed versionCode 10
      artifact. Confirm the only Android changes are Access failure
      classification, credential-only update, tests, manifest action, and
      required upgrade version bump.
- [ ] Verify the candidate APK is signed by the **same certificate** as the
      installed versionCode 9 APK. CI's unsigned artifact is not installable.
- [ ] Do not proceed if source, certificate, or package name differs.

## Protected-device baseline (read-only)

- [ ] Confirm `adb devices -l` shows exactly the intended authorized tablet.
- [ ] Record Android build, serial, KICK'S package name/versionCode,
      installed APK SHA-256, and signing-certificate SHA-256.
- [ ] Record bounded historical observation IDs/timestamps, count, pending
      upload queue count, consent state, and safe (non-secret) device/subject
      identifiers. Never print a bearer token or Access secret.
- [ ] Record monitoring OFF/ON and VPN service state.
- [ ] Save evidence only in the approved protected evidence location.

## In-place upgrade and credential recovery

- [ ] Install only with `adb install -r` after passing the gates above. Never
      uninstall, clear data, reset, or change collector subject identity.
- [ ] Verify versionCode 10, package name, signer, and historical sample
      remain unchanged after first launch.
- [ ] Verify monitoring is OFF before credential rotation; the rotation
      action must reject active monitoring.
- [ ] Provide the new Cloudflare service-token pair through an authorized,
      local operator channel. Do not put either value in chat, source,
      screenshots, saved command history, or CI logs.
- [ ] Invoke only `UPDATE_ACCESS_CREDENTIALS`; do not pass deviceToken,
      consentId, or purpose. Confirm the operation rejects attempts to pass
      those fields and reports success without echoing credentials.
- [ ] Recheck the same safe device/subject identifiers and historical sample.
      If identity or history differs, stop as P0.

## Consent, collection, and continuity

- [ ] With monitoring still OFF, verify `/health` using the same Cloudflare
      service-token pair from a local secure test (no secret output).
- [ ] Activate through the app UI. Record consent grant status, new activation
      ID, and Cloudflare Access decision. A 403 must leave monitoring OFF.
- [ ] Complete Android's user-visible VPN authorization if prompted.
- [ ] Verify foreground VPN service, new metadata-only observations, correct
      consent linkage, and preserved historical observations.
- [ ] Exercise bounded offline activity, restore connectivity, and verify
      replay without duplicates or subject changes.
- [ ] Test account unbind/rebind as relationship-only changes, preserving
      collector subject and history.
- [ ] Reboot normally; confirm configuration survives, monitoring does not
      silently bypass fresh-consent rules, and authorized collection can
      resume.

## Stop conditions

Stop and report a release blocker for any signature mismatch, 403 after
rotation, missing durable DB, consent bypass, destructive upgrade prompt,
identity rewrite, historical-record loss, failed replay, or unverified reboot
recovery. PR #19's green GitHub quality run does not clear its separate failed
Vercel deployment or these physical M3 gates.
