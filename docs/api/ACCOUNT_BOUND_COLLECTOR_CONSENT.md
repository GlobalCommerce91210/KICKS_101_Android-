# Account-bound collector consent integration
Implementation base: feature/consumer-api-v1 at f5dc3575ab8fd991da31f3ff3d5b87a73a577fb4.
This is an additive backend integration proposal, not a deployed service or an iOS installation.

## Existing identity boundary
DataStorm owns /core/identity/v1/account and /core/identity/v1/session.
KICK'S consumer routes authenticate the DataStorm access token, require active KICK'S entitlement/profile, and reject missing, suspended or closed accounts.
Device binding requires the existing collector device token as proof and stores the account-to-collector mapping. Binding does not rewrite the collector subject.

## Added endpoints
- GET /core/consumer/v1/devices/{deviceId}/consent?permissionId={UUID}
- POST /core/consumer/v1/devices/{deviceId}/consent

Both require a DataStorm Bearer access token and an active device binding belonging to that account.
GET returns { consent: null } when no ledger decision exists, otherwise the current authoritative decision.
POST accepts only:
```json
{
  "permissionId": "<UUID>",
  "activationRequestId": "<new UUID for each intended decision>",
  "action": "grant",
  "policyVersion": "<reviewed policy version>",
  "purposeVersion": "<reviewed purpose version>",
  "purpose": "<exact reviewed purpose>"
}
```
Actions are grant, deny or revoke. Do not send account or collector subject IDs.
The server derives the collector subject from the binding, appends the decision to Store, and records the authenticated DataStorm account as the audit actor.
A grant returns an activationId used by the existing collector metadata-batch contract. Deny/revoke return no activationId.
Response 202 means accepted; an identical sequential retry returns the original receipt with replayed:true and HTTP 200.
Reusing an activationRequestId with a different body or changing the purpose/version scope of an existing permissionId returns 409.
A replay receipt describes the original decision, not current authorization. GET the current decision after retry/reconnect.
Missing/expired session returns 401; a device outside the account's active bindings returns 404; invalid fields return 422.

## Enforcement and persistence
These endpoints use Store.currentConsent/appendConsent, the same boundary consumed by /v1/metadata-batches.
They do not update the demo PermissionsEngine maps and do not authorize compensation or dataset sharing.
PostgresStore persists ledger events when the service is configured with its existing database integration. MemoryStore remains a test/local fallback.
A shared-memory service recreation test demonstrates the route reads the injected Store; it does not prove a PostgreSQL process restart or production durability.

## Remaining release gates
- Bring reviewed identity/backend changes and the iOS delivery branch together through PRs; do not copy a second account system into the mobile app.
- Connect the mobile account session using secure native token storage, refresh/logout handling, and the established identity routes.
- Replace demo identity permission controls with the authenticated, device-bound ledger flow and show unconfirmed decisions honestly.
- Verify database migrations, transaction ordering and concurrent request idempotency across multiple workers. The existing Store read-then-append interface does not guarantee atomic idempotency.
- Test actual database restart, revocation on the physical device, offline recovery, and audit reconciliation.
- Device binding removal stops this account's access to these endpoints; it does not itself revoke collector credentials or consent. Use an explicit consent revoke before unlinking when stopping collection.
- iOS collector extension and forwarding remain separate integrations. No live iOS collection is asserted.

No production deployment, identity migration, collector subject rewrite, dataset operation, signing change or device reinstall is part of this change.
