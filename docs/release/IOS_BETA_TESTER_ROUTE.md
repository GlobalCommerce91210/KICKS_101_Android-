# iOS beta tester route

Prepared route: GET /beta/ios. Status: GET /v1/beta/ios/status. Enrollment: POST /v1/beta/ios/enroll rejects with 503 and ios_beta_enrollment_closed. These routes are implemented in source; no deployment or domain mapping is established by this change.

The public page is informational and accepts no personal details. It has no invitation/build URL, enrollment form, analytics, or registration bypass. Its closed state cannot be opened by an environment flag. Testers have no JumpCloud administrative access.

## Opening criteria

Implement authenticated, durable enrollment tied to the account, unique device, existing purpose/version and active consent; validate rejection across accounts, retry/idempotency, revocation and restart. Verify a reachable staging gateway, native tunnel/handshake, minimized ingestion, engine outputs including inverse engines, and account-session isolation. Record signed candidate SHA, IPA/build ID, app/extension signing and native CI results. Complete the operational build before distributing invitations. A source code flag or healthy HTTP endpoint is insufficient.

For a small approved cohort, generate the official Expo device-registration link, approve the device on the correct Apple team and build or resign an internal IPA with the refreshed provisioning profile. Share only that approved candidate's installation link. Do not reuse the old visual build's link as operational-beta evidence. https://docs.expo.dev/build/internal-distribution/

For wider testing, upload the validated store-distribution candidate to App Store Connect, set beta information and pass any required TestFlight beta review before invitations. https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/

Before opening the page, establish the support destination, privacy notice, retention and withdrawal procedure. Keep device-registration status, installation status and collection consent separate. Do not store UDIDs, tokens or traffic in feedback reports. No new collection categories, consent purposes, payouts or production authority are granted by this route.

Rollback: revert this route's commit; it has no enrollment storage or tester accounts to migrate. Turning off invitations alone must never substitute for consent revocation in the future implementation.

Offline checks: node --test services/api/src/ios-beta.test.mjs. Full Fastify integration/typecheck and a deployment check are additional evidence, not established by those boundary tests.
