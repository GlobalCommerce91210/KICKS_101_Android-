# Android collector and beta launch plan

## Launch position

The production collector is the next implementation milestone. KICK'S remains a visual demo until a native Android `VpnService`, independently owned ingestion backend, versioned consent ledger, and deletion controls pass the launch gates below.

## Collection boundary for the first beta

Collect normalized network metadata only: event time bucket, source-app identifier when attribution is technically reliable, destination domain or normalized endpoint, protocol category, byte-count bucket, classifier result, and the governing consent version.

Do not collect payload bodies, message contents, form values, credentials, full URLs or query strings. Minimize on device before upload. When app attribution or destination identity is uncertain, label it unknown rather than infer it as fact.

Observed traffic is not automatically permissioned marketplace data. A record becomes eligible for an approved use only when it is linked to an active, purpose-specific, versioned permission and the permitted recipient, retention period, and compensation terms.

## Fast-track sequence

### Days 1-5: native collector

- Generate the Android native project and implement a Kotlin foreground `VpnService`.
- Add OS VPN consent, a persistent monitoring notification, visible pause/stop controls, and a remote kill switch.
- Implement local metadata minimization, encrypted queueing, retry limits, and explicit demo/collection state.
- Run a technical spike for source-app attribution and encrypted DNS/ECH limitations; do not promise visibility the platform cannot reliably provide.

### Days 4-10: owned control plane

- Add authenticated device registration and short-lived credentials.
- Accept signed, schema-validated batches with replay protection and rate limits.
- Link every uploaded event to the applicable consent-ledger version.
- Add immutable audit events, retention enforcement, export, deletion, monitoring, and incident alerts.
- Keep development, staging, and production data and credentials separate.

### Days 8-15: internal beta

- Complete threat modeling, privacy review, battery/performance testing, and deletion verification.
- Publish a prominent in-app disclosure before the Android VPN permission prompt.
- Test consent acceptance, refusal, withdrawal, pause, deletion, and collector kill-switch behavior.
- Release to a small, named adult test cohort through the Play internal-testing track.

### Weeks 3-5: closed market beta

- Complete the Play Data safety form and `VpnService` declaration, including the required demonstration video.
- Publish the privacy policy and account-deletion web path.
- Move to closed testing only after security, privacy, reliability, and policy gates pass.
- Enable compensated opportunities only after identity/KYC, buyer-purpose approval, contract controls, and reward/payout reconciliation are operational.

## Non-negotiable launch gates

- Explicit, revocable, purpose-specific consent before collection.
- Clear disclosure of what is collected, why, where it goes, retention, and sharing.
- Payload/content exclusion verified by tests.
- Encryption in transit and at rest; secrets never embedded in the app.
- Consent, access, sharing, reward, and deletion events are auditable.
- User-facing pause, export, withdrawal, and deletion controls work end to end.
- Production kill switch, alerts, dashboards, and an incident owner exist.
- Store disclosures match actual app and SDK behavior.

## Planning estimate

With one focused Android engineer and one backend/security engineer, a controlled internal metadata beta is a 10-15 working-day target. A credible Play closed beta is approximately 3-5 weeks, subject to testing and Google review. These are delivery targets, not approval guarantees.
