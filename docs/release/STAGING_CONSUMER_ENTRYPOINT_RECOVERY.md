# Staging consumer entry point recovery — 2026-10-10

## Verified findings
- Founder human Allow policy already installed for datastorminc@outlook.com, 1h sessions, app 91db3dcc-79cc-4b45-aa12-3efeadd5dfcd. Service Auth policy preserved.
- Founder reports origin Fastify JSON 404 for GET /core/identity/v1/account after Access authentication.
- Healthy tunnel datastorm-kicks-staging (98e9ab8f-5836-4b50-9dac-606281883126) sends staging-api.datastorminc.live to http://localhost:3000 on the connector host; no path rewrite in retrieved ingress config.
- Shared mobile candidate 44b1bf8d961f1f852faa883b3358f5e5890c079c services/api/src/server.ts lacks DataStorm identity route registration. Its green client/simulator CI is not full account-backend readiness.
- implementation/canonical-account-profile-readiness contains registerDataStormIdentityRoutes and durable identity/consumer code; it diverges 35 commits ahead / 15 behind from the shared candidate. Do not replace either tree wholesale.
- Prior hosting documentation identifies connector host DESKTOP-N0PB2Q9, different from editing environment. Current host process SHA and DB configuration unverified.

## Required source/runtime work
Technology owner: reconcile reviewed durable account/consumer backend from canonical-account-profile-readiness with shared mobile candidate. Preserve collector ingestion, subjects, existing database and native continuity.
Validate workspace tests, PostgreSQL restart/consent regression, native Android and iOS on resulting exact SHA.
Stage reconciled backend on a separate port on the connector host before changing existing collector origin. Use existing PORT/HOST-capable startup only after reviewing source. Do not start an in-memory replacement or apply migrations blindly.
Confirm loopback unauthenticated account GET returns JSON 401 (not 404), valid synthetic session returns verified account/product subject, refresh rotates, old refresh and revoked access are rejected.
No source deployment or migration performed by this record.

## Consumer ingress design
Separate consumer staging hostname, leaving collector hostname, service tokens and protected datasets intact.
Public consumer-facing gateway permits only reviewed account lifecycle and read/profile/consent endpoints and methods. Account/session creation and refresh must reach backend auth; protected reads require backend-validated human Bearer sessions.
If proxying through Access-protected origin, Cloudflare service pair exists only in server secret bindings; never in Expo public env vars, source, mobile binaries or consumer responses.
Strip caller-supplied CF-Access headers, cookies, origin/admin headers; construct upstream URL from fixed origin and allowlisted paths. Do not forward arbitrary paths, destinations or credentials. Preserve human Authorization for backend validation.
Fail closed on absent server credentials, redirects, origin HTML or unavailable backend. No caching token/account responses; no body/auth-header logs. Set body/time limits and login rate limits. CORS only approved portal origins.
Do not expose currently unauthenticated demo permissions/wallet paths until backend subject authorization is verified.
Entry point cannot be called consumer-authenticated until real valid/invalid/expired/cross-account tests pass against durable origin.
Broad existing Everyone bypasses remain unchanged in this task; review separately with collector continuity evidence.

## Acceptance / owners
Technology: exact source reconciliation + durable origin + fixed-origin consumer ingress.
Founder/authorized operator: existing server secret provisioning and connector-host access.
Onboarding: synthetic login/profile/restore/logout/expiry verification.
Product: signed Android/iPad journey acceptance.
Current status: policy complete; backend deployment and consumer entry point BLOCKED / NOT ESTABLISHED.
Rollback: leave collector tunnel ingress untouched; remove pilot consumer route/disable gateway if acceptance fails. Human policy rollback is removal of b7a67467-63ce-4462-a6fc-fe2fbf370981 only.
