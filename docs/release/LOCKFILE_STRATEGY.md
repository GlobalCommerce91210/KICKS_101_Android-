# Lockfile Strategy — KICK’S Mobile Hub

**Release line:** 0.2.6  
**Repository:** `GlobalCommerce91210/KICKS_101_Android-`  
**Preferred package manager:** npm

## Objective

Provide deterministic workspace dependency resolution, reproducible CI installs, and valid GitHub Actions caching for the KICK’S monorepo.

## Current repository facts

The root `package.json` already defines:

```json
"workspaces": ["apps/*", "services/*", "packages/*"]
```

The current `quality` workflow uses:

```yaml
- uses: actions/setup-node@v4
  with: { node-version: 20, cache: npm }
- run: npm ci
```

Therefore the canonical lockfile for this branch should be:

```text
/package-lock.json
```

Do not place the canonical lockfile only inside `apps/mobile`.

## Package-manager rule

Use **one** package manager for this repo.

For 0.2.6, npm is the preferred choice because the existing CI is already configured for npm caching and `npm ci`.

Do not add `yarn.lock` or `pnpm-lock.yaml` while npm remains canonical.

## Creation procedure

From the repository root:

```bash
npm install
```

This must generate or refresh:

```text
package-lock.json
```

Then verify:

```bash
npm ci
npm run typecheck
npm test
```

## Historical-lockfile note

Earlier 0.2.6 branches (`release/0.2.6-engine-merge` and `rc/0.2.6-m2-m4-lock`) contain an npm lockfile whose root workspace pattern matches the current monorepo and whose `apps/mobile` entry is `@kicks/mobile` version `0.2.6`.

That historical file is useful as evidence and a reconciliation source, but it must not be copied blindly. Before reuse, every workspace package manifest on the current branch must be reconciled against the lockfile.

## CI contract

Once the root lockfile is committed:

1. `actions/setup-node` can resolve npm cache metadata.
2. `npm ci` becomes the deterministic install gate.
3. Typecheck and tests can execute.
4. Any future Jest/Expo collector harness can run as an actual test step.
5. Cache invalidation follows lockfile content changes.

## Guardrails

- Never commit multiple package-manager lockfiles.
- Do not hand-edit dependency resolutions unless resolving a documented package issue.
- Treat `package.json` and `package-lock.json` changes as one logical dependency change.
- Dependency additions for the collector harness must update the root lockfile in the same PR.
- `npm ci` is the CI install command; `npm install` is the developer command used to intentionally update dependency resolution.
