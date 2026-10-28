# KICK-011D consent, collector, and Android acceptance

Each numbered case is explicitly designated **Automated** or **Manual**. “Automated — existing” identifies current test coverage, not a claim that the suite ran during this revision. API persistence integration tests require `KICKS_TEST_DATABASE_URL`; they may be skipped otherwise. The mobile consent session provider restores and verifies secure device credentials, but no identity-token provider is registered, so login/enrollment remains unavailable until an actual provider is added. UI/device cases requiring a session remain proposed gates, not currently executable acceptance.

The current native collector is unavailable and disabled. No collector start/resume/background lifecycle, OS-revocation handling, or queued-batch drain path is implemented. Cases describing those behaviors are future gates only; they must not be read as evidence those paths exist. Consent events never by themselves imply OS authorization or data collection.

1. **[Automated — existing mobile collector guard] Initial default-off**
   - Setup: Use the checked-in Android build configuration with no activation request.
   - Action: Inspect collector status before any consent action.
   - Expected: Collector remains `UNAVAILABLE`/off, `collectorEnabled` is false, and no monitoring or OS permission prompt is implied. Existing coverage: `apps/mobile/tests/collector-guard.test.js`.
2. **[Automated — existing mobile consent service] Missing authenticated session**
   - Setup: Do not register a secure consent session provider.
   - Action: Read the session used by the Permissions screen.
   - Expected: No device/user identity is fabricated; the screen fails closed and does not read or submit a consent decision. Existing coverage: `permissions-consent.test.js` session-provider test.
3. **[Manual — proposed UI/session gate] Grant in every consent category**
   - Setup: In a future build with a securely registered session, load app, metadata, and buyer catalogs with empty histories.
   - Action: Grant one app purpose, one metadata purpose, and one buyer-category purpose.
   - Expected: Each grant uses its own stable permission UUID and is shown only after service acceptance/history confirmation. Current UI cannot pass this gate until session integration exists.
4. **[Manual — proposed UI/session gate] Deny in every consent category**
   - Setup: Use the same authenticated app, metadata, and buyer fixtures with known current sequences.
   - Action: Deny one purpose in each category.
   - Expected: Each durable history records `deny` at its next sequence; no category is displayed as granted from local state.
5. **[Manual — proposed UI/session gate] Revoke in every consent category**
   - Setup: First confirm a grant for one app, metadata, and buyer purpose.
   - Action: Revoke each purpose.
   - Expected: Each history appends `revoke`, preserves the prior grant, and no revoked purpose is described as active authorization.
6. **[Automated — existing API test] Purpose, policy-version, and purpose-version mismatch**
   - Setup: Use a valid device and active consent, then prepare otherwise-valid metadata with the wrong purpose string, `consentPolicyVersion`, and `consentPurposeVersion`, varying each independently.
   - Action: Submit each mismatched batch.
   - Expected: Each mismatch independently returns 403 and writes no observations. Existing exact coverage: `services/api/src/metadata-authorization.test.ts`, “metadata ingestion rejects mismatched consent subject, purpose, or versions”.
7. **[Automated — existing API persistence integration; DB-gated] Durable history after API restart**
   - Setup: Run the PostgreSQL integration test against a disposable database and persist a consent grant.
   - Action: Recreate the API/repository process, then read the same permission history.
   - Expected: The original event and action remain present. This verifies API persistence/restart, not mobile secure-session persistence.
8. **[Automated — existing API tests] Duplicate exact request ID**
   - Setup: Submit one consent request, then repeat the identical request ID and payload concurrently and after restart.
   - Action: Replay the exact request.
   - Expected: The service returns the original event; it does not append another sequence. Existing coverage is in server and persistence integration tests.
9. **[Automated — existing API tests] Conflicting request ID reuse**
   - Setup: Persist a request ID, then reuse it while changing permission, action, purpose/version, or expected sequence.
   - Action: Submit each changed payload.
   - Expected: The service returns a conflict (409) and does not treat the mismatch as a successful replay. Existing coverage is in API persistence tests.
10. **[Automated — existing API/mobile tests] Stale and concurrent sequence**
    - Setup: Read sequence N, then advance it on the server; also prepare two concurrent decisions both expecting N.
    - Action: Submit the stale decision and both concurrent decisions.
    - Expected: Stale writes return 409; at most one concurrent decision succeeds. The mobile screen does not optimistically apply a stale result.
11. **[Automated — existing API failure tests] Persistence outage and HTTP 503**
    - Setup: Make device-auth, consent-write, or consent-history persistence fail.
    - Action: Read history or submit a decision.
    - Expected: The API returns retryable 503 where specified and never represents an unpersisted write as accepted. Existing coverage is in `persistence-failure.test.ts`.
12. **[Manual — proposed client/network gate] Offline and ambiguous timeout**
    - Setup: Use an authenticated session; simulate offline access and a POST timeout after the service may have committed.
    - Action: Submit a decision, reconnect, and retry the same action; separately restart after an ambiguous timeout.
    - Expected: No unconfirmed grant is shown. In-process retries preserve the exact request ID/payload; after restart, the UI rereads history and does not infer authorization from local storage. No durable offline queue is claimed.
13. **[Manual — proposed future auth-expiry gate] Credential expiration and device revocation**
    - Setup: For expiry, use a future token-expiration mechanism and wait until a valid token expires; separately enroll and revoke a test device.
    - Action: Attempt consent reads/writes and protected API access with the expired credential and the revoked device credential.
    - Expected: Both credentials are rejected before state changes (expired credentials should return 401). The current API has no token-expiry mechanism; existing automated coverage verifies only invalid/revoked credentials and neither implements nor tests expiry.
14. **[Manual — proposed Android device gate; OS lifecycle path absent] OS permission revocation**
    - Setup: This gate is executable only in a future collector-enabled build with explicit Android authorization.
    - Action: Revoke the relevant OS permission in Android Settings while monitoring is active.
    - Expected: The future implementation stops promptly and reports authorization lost. In the current build, verify only that the collector remains unavailable/off; no revocation handler is claimed.
15. **[Automated — existing API test] Missing or unavailable `collectorVerifier` during metadata ingestion**
    - Setup: Use a valid device and active purpose consent, then omit the independent verifier or make its `verify` call unavailable.
    - Action: Submit an otherwise-valid metadata batch; optionally query `/v1/collector/eligibility` separately.
    - Expected: Metadata ingestion fails closed and writes no rows. `/v1/collector/eligibility` reports only consent eligibility, not collector readiness or verification; no eligibility response, including `eligible: true`, proves active capture. Existing coverage: `services/api/src/metadata-authorization.test.ts`, “missing, rejected, and unavailable collector verification never writes metadata”.
16. **[Automated — existing API test] `collectorVerifier` returns false**
    - Setup: Use a valid device, active exact-purpose consent, and a `collectorVerifier.verify` stub that returns `false`.
    - Action: Submit an otherwise-valid metadata batch.
    - Expected: Ingestion returns 403 `collector_verification_failed`; both batch and observation stores remain empty. Existing exact coverage: `services/api/src/metadata-authorization.test.ts`, “missing, rejected, and unavailable collector verification never writes metadata”. This specifically tests verifier rejection at ingestion, not verifier-false eligibility.
17. **[Manual — proposed Android lifecycle gate; lifecycle path absent] Start, resume, background, retry**
    - Setup: Future build only, after a safe collector and lifecycle implementation exists.
    - Action: Exercise explicit start, background/foreground resume, and a retry after verification/network failure.
    - Expected: Each start/resume rechecks device, OS authorization, and current consent; failure stays stopped. Current build has no supported lifecycle/start path, so this case is not presently executable.
18. **[Manual — proposed queue gate; queue/drain path absent] Queued batch drain**
    - Setup: Future build only, with an explicitly implemented bounded queue and documented minimization schema.
    - Action: Disconnect during approved metadata delivery, reconnect, then exercise drain and retry.
    - Expected: Only approved metadata is drained, stable batch/event IDs prevent duplicates, current consent is revalidated, and failure remains visible. No queue or drain behavior exists in the current mobile tree.
19. **[Automated — existing API persistence integration; DB-gated] Revocation during in-flight ingest**
    - Setup: Grant consent and race a metadata ingest against a revoke under the persistence integration test.
    - Action: Run both operations concurrently, then attempt another ingest.
    - Expected: The race is serialized safely; after revoke, later ingest is rejected and no unauthorized row is persisted. Existing coverage is in `persistence.integration.test.ts`.
20. **[Automated — existing API tests] Batch replay**
    - Setup: Submit one valid metadata batch, then submit the same batch/event IDs again.
    - Action: Replay the batch.
    - Expected: Replay is rejected (409) and duplicate observations are not persisted. Existing coverage is in server and persistence integration tests.
21. **[Automated — existing API test] Unsupported metadata schema version**
    - Setup: Prepare an otherwise-valid metadata batch with an unsupported `schemaVersion`.
    - Action: Submit the batch to the metadata endpoint.
    - Expected: The API returns 400 and writes neither batch nor observations. Existing exact coverage: `services/api/src/metadata-authorization.test.ts`, “unsupported metadata schema version returns 400 without writes”.
22. **[Automated — existing minimization/collector guards] Payload minimization and no content capture**
    - Setup: Submit a metadata batch containing an unapproved payload/content field; inspect the disabled collector source guard.
    - Action: Attempt ingestion and run the collector guard test.
    - Expected: The API rejects extra payload fields and the unavailable collector does not inspect or capture traffic content. This does not claim a live collector has been physically tested.
23. **[Manual — proposed UI gate; session integration required] Truthful loading/read state**
    - Setup: In a future authenticated UI run, delay one or more durable history reads.
    - Action: Open Permissions and wait for the response.
    - Expected: Loading is visible; catalog state is not presented as consent truth; each item is shown only after its server history is read.
24. **[Manual — proposed UI/session gate] Truthful success state**
    - Setup: In a future authenticated UI run, use a service that accepts a decision and returns durable history.
    - Action: Grant, deny, and revoke a choice.
    - Expected: Success is displayed only after service acceptance; text describes a recorded consent event, not OS authorization or collector activation.
25. **[Manual — proposed UI gate] Truthful error, offline, stale, and malformed-history states**
    - Setup: In a future authenticated UI run, separately trigger HTTP rejection, network loss, 409 stale sequence, and malformed history.
    - Action: Submit a decision for each condition.
    - Expected: The UI distinguishes error/offline/stale, applies no optimistic state, and labels malformed or unavailable history as untrusted pending refresh.
26. **[Automated — existing mobile consent service] Malformed history event validation**
    - Setup: Stub events with missing/malformed IDs, mismatched permission IDs, unsupported actions, missing purpose/version fields, or missing/discontinuous expected/event sequences.
    - Action: Read consent history.
    - Expected: The service rejects the entire history with `invalid_history`; no malformed event can be displayed as an empty, granted, or current history.
27. **[Manual — proposed mobile restart gate; session integration required] UI reread after app restart**
    - Setup: In a future build, record a decision, terminate/relaunch the app, and restore the same secure session.
    - Action: Reopen the permission category and history.
    - Expected: The screen rereads durable server history. App-local data alone never establishes authorization.
28. **[Manual — Android build/install/device smoke; install gate unavailable here] Build/install smoke**
    - Setup: Run the workflow build steps from their stated working directories: `npx expo prebuild --platform android --no-install` in `apps/mobile`, then `./gradlew assembleDebug` in `apps/mobile/android`; check `adb devices -l`.
    - Action: After a successful APK build, install and launch only on a listed emulator/device; open Permissions and inspect status.
    - Expected: App installs and renders truthfully; collector remains unavailable/off, no unintended OS permission is requested, and no collector start is triggered. Current attempt: prebuild succeeded; `assembleDebug` failed resolving `org.gradle.toolchains.foojay-resolver-convention:1.0.0`; `adb devices -l` listed no devices and the emulator binary was unavailable. This smoke remains Manual and unpassed.
29. **[Automated — existing mobile consent service] Stable IDs and retry payload**
    - Setup: Generate IDs for the same permission/sequence/action; stub a retryable 503 followed by acceptance.
    - Action: Submit the decision through `consentApi.ts`.
    - Expected: IDs are stable for identical input and both retries carry the exact same request ID, payload, and expected sequence. Existing coverage: mobile `permissions-consent.test.js`.
30. **[Automated — existing mobile source/collector guards] Consent never starts the collector**
    - Setup: Inspect the Permissions screen and run the collector guard suite.
    - Action: Exercise/assert the consent screen’s decision wiring.
    - Expected: The screen uses consent-event APIs, does not call collector start or legacy permission setters, and a grant leaves collector activation disabled.
