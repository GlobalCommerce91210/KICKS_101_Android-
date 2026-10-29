# KICK-011A overnight implementation packet — 2026-10-29

## Lineage

- Repository: `GlobalCommerce91210/KICKS_101_Android-`
- Source base: `copilot/codexkick-011c-collector-gates` at `03e75af0dd5054ac0c9cb261d62f4271fc8d1f39`
- Working branch: `codex/overnight-kick011a-contract-20261029`
- Implementation commit before this packet: `b3ed1ff8830bf8bce76231d40c6b9815976dd8f0`
- Draft PR: #69

## Owned files

- `services/api/src/collector-authorization.ts`
- `services/api/src/server.ts`
- `services/api/src/collector-authorization.test.ts`

## Implemented behavior

1. `POST /v1/collector/eligibility` evaluates only; it does not issue an activation capability.
2. Request body remains strict and exact: `{permissionId,purpose,activationRequested:true}`.
3. Response exposes server-derived `decisionVersion`, `policyVersion`, and `purposeVersion`.
4. `GET /v1/collector/eligibility` is explicit deny-only/deprecated: HTTP 410 and `deprecated_route`.
5. Metadata ingestion continues to re-check authorization inside the repository commit transaction.
6. Extra request fields are rejected; monitoring remains off by default.

## Added tests

- Informational POST does not expose `authorizationId`.
- Server-derived version fields are returned.
- Extra request fields are rejected.
- Deprecated GET returns HTTP 410 and cannot authorize.

## Execution status

- Source write: completed at implementation commit above.
- Tests: added, not run in this turn.
- Build/CI: not run; no workflow runner tool is exposed in the current GitHub MCP catalog.
- PostgreSQL/device/runtime evidence: not produced.
- Production/infrastructure/signing/credential/device/collector changes: none.

## QA command handoff

Run the repository's API test and typecheck commands against PR #69, then attach exact pass/fail/skip counts and any PostgreSQL transaction evidence. Do not mark acceptance from this packet alone.
