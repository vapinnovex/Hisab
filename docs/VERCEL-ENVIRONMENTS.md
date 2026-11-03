# Independent Vercel environments

## Architecture and supported mechanism

Both branches use the same `mobile/vercel.mjs` and
`mobile/scripts/deployment-config.cjs`. Do not edit routing when merging `dev`
into `prod`. Remove the old `mobile/vercel.json` on both branches; keeping two
configuration files is an error, and regression tests enforce this.

The original dev authentication failure was a proxy mismatch: Vercel forwarded
requests to the production Render service while the dev service's CORS allowlist
was correct. Branch-specific hardcoded rewrite files can repeat this failure on
the next merge.

Vercel officially supports programmatic configuration, including `.mjs`, using the
same `rewrites`, `headers`, `buildCommand` and `outputDirectory` properties as JSON.
Vercel evaluates the exported configuration as part of configuration loading. It
is not a script that rewrites `vercel.json` inside the Expo build. Static JSON is
not treated as an environment-variable template. No serverless proxy, paid custom
environment, or plan upgrade is required by this implementation.

References checked November 3, 2026:

- [Programmatic configuration and migration](https://vercel.com/docs/project-configuration/vercel-ts)
- [Availability for all projects and supported extensions](https://vercel.com/changelog/vercel-ts)
- [Official configuration compiler](https://github.com/vercel/vercel/blob/main/packages/cli/src/util/compile-vercel-config.ts)
- [System variables](https://vercel.com/docs/environment-variables/system-environment-variables)
- [Variable scopes](https://vercel.com/docs/environment-variables)
- [Hobby rollback limits](https://vercel.com/docs/instant-rollback)

No new runtime dependency is needed to evaluate the config. The pinned
`@vercel/routing-utils` development dependency tests the actual Vercel rewrite and
header transformation. The build also runs `check:deployment` before Expo export,
printing only the validated routing configuration for review in build logs. Web
exports clear Metro's transform cache so an environment change cannot reuse a
previous environment's inlined `EXPO_PUBLIC_APP_ENV` branding.

## Project settings and exact variables

Both projects: repository `vapinnovex/Hisab`, Root Directory **mobile**, Framework
Preset **Other**, Node **22.x**, Install Command **npm ci**. Configuration controls
Build Command (`npm run check:deployment && npm run build:web`) and Output Directory
(`dist`). Remove obsolete dashboard overrides so they agree with the repository.
Do not set a command that generates a new `vercel.json`.

| Setting                   | Development project               | Production project                 |
| ------------------------- | --------------------------------- | ---------------------------------- |
| Vercel project name       | `hisab-mobile`                    | `hishob`                           |
| Production Branch         | `dev`                             | `prod`                             |
| Stable domain             | `hisab-mobile-delta.vercel.app`   | `hishob-blond.vercel.app`          |
| `APP_ENV`                 | `development`                     | `production`                       |
| `EXPO_PUBLIC_APP_ENV`     | `development`                     | `production`                       |
| `API_PROXY_TARGET`        | `https://hishob-dev.onrender.com` | `https://hishob-anuj.onrender.com` |
| `EXPO_PUBLIC_WEB_API_URL` | Remove (empty also accepted)      | Remove (empty also accepted)       |

Set these variables in **Production scope in each project**. Vercel's Production
scope means that project's stable deployment, not Hishob's application environment.
The Vercel Development scope is for local `vercel dev`; it does not configure the
deployed dev frontend. `NODE_ENV` remains controlled by the build tooling.

Enable **Automatically expose System Environment Variables** (also labeled
**Enable access to System Environment Variables**). The config requires Vercel's
`VERCEL_PROJECT_NAME` and `VERCEL_GIT_COMMIT_REF`; do not define manual replacements.
Project renames and new branches require a reviewed mapping change. Missing
identity fails closed. CLI/local config inspection must explicitly supply those
values; do not substitute a hand-created identity for a hosted Git deployment.

Use project-local variables. Remove conflicting shared/team or branch-scoped
overrides for the keys above. `API_PROXY_TARGET` is build configuration and must
not be named `EXPO_PUBLIC_API_PROXY_TARGET`. It is not a secret. Do not put Render
credentials, JWT keys, database URLs or tokens into frontend variables.

`EXPO_PUBLIC_API_URL` remains the native/local development setting; exported web
bundles ignore it. Remove it from Vercel if it was added to control the web proxy.
If another build genuinely needs it, keep its correct environment-specific value;
it cannot override these web routes. `EXPO_PUBLIC_WEB_API_URL` is allowed for local
Expo development only. `EXPO_PUBLIC_APP_ENV` continues to control branding, and is
checked against `APP_ENV` and project identity before deployment.

There is no backend URL fallback. Exact comparison rejects HTTP, credentials,
unknown domains, the opposite backend, whitespace, trailing slashes, paths, query
strings and fragments. Changing all custom variables to production values in the
dev project still fails because Vercel project identity is checked independently.

## Preview policy and isolation boundary

Only `dev` can deploy in `hisab-mobile`, and only `prod` in `hishob`. Cross-project
Git preview builds and feature branches intentionally fail instead of acquiring
access to the other backend. Preview scope can remain unconfigured. If a deployment
of the project's correct branch is explicitly created as a Preview, it requires
the same project-specific variables and still selects the same backend. Its
temporary hostname is not automatically allowed by backend CORS. Do not add broad
preview allowlists or promote a build from the other project.

The config protects normal builds/merges and misconfigured variables. It cannot
prevent an administrator from changing source guards, overriding system identity,
or manually assigning a production domain to a different project. Keep the two
stable domains attached to their existing projects. Backend databases, credentials,
exact-origin CORS checks, custom client headers and cookie security remain unchanged.

## Local verification

From `mobile/`, with Node 22 and dependencies installed:

```sh
npm run test:deployment
npm run typecheck
npm run lint
npm run format:check
```

Inspect the complete config for either environment without contacting a backend or
deploying anything:

```sh
VERCEL_PROJECT_NAME=hisab-mobile VERCEL_GIT_COMMIT_REF=dev \
APP_ENV=development EXPO_PUBLIC_APP_ENV=development \
API_PROXY_TARGET=https://hishob-dev.onrender.com EXPO_PUBLIC_WEB_API_URL='' \
npm run check:deployment

VERCEL_PROJECT_NAME=hishob VERCEL_GIT_COMMIT_REF=prod \
APP_ENV=production EXPO_PUBLIC_APP_ENV=production \
API_PROXY_TARGET=https://hishob-anuj.onrender.com EXPO_PUBLIC_WEB_API_URL='' \
npm run check:deployment
```

The first three destinations must use the expected Render origin; both attendance
station entry paths must end at `/api/face-station/`. The generic API path retains
`/api/:path*`. SPA routes still reach `/index.html`; `_expo`, assets, icons, service
worker, manifest and favicon are excluded. Existing cache/security headers remain.
These commands verify resolved configuration, not a live deployed routing table.

## Safe development rollout

1. Record the current Ready deployment URL in `hisab-mobile` for rollback. Review
   its project name, Production Branch `dev`, stable domain and variables above.
2. Review the local change, run checks, and deliberately publish the reviewed
   commit to `dev` when ready. A Git push can trigger Vercel automatically; do not
   push until prepared to deploy. This task does not push or deploy.
3. Inspect the new build logs. `check:deployment` must show all three API
   destinations on `hishob-dev.onrender.com`. A guard failure must leave the
   previous Ready deployment serving the stable domain; fix settings, do not
   bypass the guard.
4. Verify that the stable dev domain points to that deployment, then run the safe
   checks below. Test login/logout and attendance using development accounts only.

## Safe production rollout

1. Finish development verification first. Record the current Ready production
   deployment URL in `hishob`. Do not change its domain or Render configuration.
2. Prepare the exact production-scoped variables in `hishob`; environment changes
   apply to subsequent builds and do not rewrite the currently serving deployment.
3. Review the merge from `dev` into `prod`, retaining the shared config and deletion
   of `vercel.json`. Run the production config inspection and regression tests.
4. When ready, deliberately publish that merge to `prod`. Inspect build logs for
   `hishob-anuj.onrender.com` in all API destinations and confirm the deployment's
   source branch and project before accepting it as the new stable deployment.
5. Verify routing, static assets and authentication on the stable production domain.
   Keep Render production CORS and credentials unchanged.

## Verify the running deployment

The resolved config in the deployment's build log establishes its intended target.
Correlate the following timestamped requests with the expected Render service's
existing request logs/metrics to confirm the actual destination. Status alone does
not identify a backend if both backends happen to allow an origin. Do not add
credential logging or expose backend settings to make this check.

```sh
# No credentials, account data or valid authentication input is sent.
curl -sS -o /dev/null -w '%{http_code}\n' \
  https://hisab-mobile-delta.vercel.app/api/auth/password/options \
  -H 'Origin: https://hisab-mobile-delta.vercel.app' \
  -H 'X-Hishob-Client: web' -H 'Content-Type: application/json' --data '{}'

curl -sS -o /dev/null -w '%{http_code}\n' \
  https://hishob-blond.vercel.app/api/auth/password/options \
  -H 'Origin: https://hishob-blond.vercel.app' \
  -H 'X-Hishob-Client: web' -H 'Content-Type: application/json' --data '{}'
```

Expected: **422**, showing exact-origin acceptance followed by input validation.
Repeat with `Origin: https://untrusted.example`: expected **403**. If the intended
origin receives 403, inspect the resolved target and existing exact allowlist; do
not weaken validation. Check `/api/auth/me` without cookies: expected **401 JSON**,
not the SPA HTML. Open both `/api/face-station` and `/api/face-station/`, verify an
app deep link, and inspect `/sw.js`, `/manifest.webmanifest`, and an exported asset.
API responses must remain `no-store`; service-worker and security headers must match
the config. No changes to Render production are required by this migration.

## Rollback

If configuration or build validation fails, leave the current Ready deployment in
place and correct the rejected settings before retrying. Do not remove guards or
switch a backend as a workaround.

If a newly active deployment fails checks, use **Instant Rollback** in that same
Vercel project to its immediately previous production deployment. Hobby supports
that immediately previous deployment; record it before rollout and avoid stacking
untested releases. Rollback reuses that deployment's original build/configuration,
so do not rebuild an old commit with today's variables as a substitute. Verify the
stable domain and authentication afterward. Rollback does not roll back Render or
data. Fix the source/settings and verify the next release before restoring normal
promotion; Vercel can leave automatic production-domain assignment disabled after
rollback until a deployment is explicitly promoted.
