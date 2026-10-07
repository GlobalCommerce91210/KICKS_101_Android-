# Staging identity route diagnosis

The reported response was a Fastify JSON 404 for `GET /core/identity/v1/account` while `/health` identified `kicks-api`. That establishes that the responding server did not match this route. It does not establish the deployed commit or which origin Cloudflare reached.

The integration branch at `6c90a68d607471490c1bbb5db974f36459b6e771` registers the route through `registerDataStormIdentityRoutes` in `services/api/src/server.ts`. Without an application bearer token, the expected response is **401 JSON with `error: unauthorized`**. Adding another account route is unnecessary.

## Read-only check

From a checkout containing this script, run:

```sh
npm ci
npm run check:identity-route --workspace @kicks/api -- https://API_HOST
```

Replace `API_HOST` with the actual staging API hostname. If Cloudflare Service Auth is enforced, supply `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` through your existing secure environment mechanism. Both are optional together. Do not paste their values into commands, tickets, source files, or screenshots. The check sends no application bearer token, creates no account, does not follow redirects, and prints no response bodies or credentials. HTTP is accepted only for loopback diagnosis.

| Result | Meaning / next check |
| --- | --- |
| Health 200 plus account 401 `unauthorized` | Account route exists and rejects anonymous application requests. This is not a full login or database readiness test. |
| Health 200 plus account 404 | Inspect the deployed commit and the origin selected for the identity path. |
| Redirect or non-JSON response | Inspect Access policy and routing; an Access login page or static web fallback can produce this. |
| JSON 403 or another unexpected status | Inspect the responding layer's logs; status alone does not identify the policy or origin. |
| Network failure | Inspect hostname, tunnel/origin reachability, and listener. |

## Deployment work order

1. On the actual origin, record the running release/commit and startup command. Compare it to the reviewed integration commit. The default branch reviewed earlier lacks the identity route; a healthy legacy API can still return this 404.
2. Check the API directly on its configured listener with the same script (for example `http://127.0.0.1:3000` if that is the actual listener). If local succeeds but the public hostname fails, inspect Cloudflare origin/path routing. If local returns 404, correct the API deployment/version first.
3. The API entrypoint is `services/api/src/start.ts`, launched from the repository root by `npm run start --workspace @kicks/api`. It uses `PORT` (default 3000) and `HOST` (default `0.0.0.0`). The repository's `vercel.json` builds the static mobile web app and rewrites to `index.html`; that configuration does not deploy the Fastify identity API.
4. Deploy an approved integration release to the API origin using the existing deployment process, after the database preflight/migration procedure in `MOBILE_ACCOUNT_CONSENT_INTEGRATION.md`. Preserve the configured database and subject history. This route check performs no migrations and does not authorize a deployment.
5. Repeat the loopback and public-origin check. Only then run the authenticated mobile account/consent smoke flow. Keep Cloudflare service credentials, account session tokens, and collector device tokens separate.

The deployed origin, schema state, and public route recovery have not been verified by the local test suite. Token/policy updates can be handled separately; this check requires no credential rotation or bypass-policy change.
