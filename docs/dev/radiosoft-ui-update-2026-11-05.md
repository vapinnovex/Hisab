# RadioSoft real DEV UI update — 2026-11-05

Prepared on `dev`; no deployment or connector changes performed.

## Behavior

- Account entry shows loading and retryable unavailable status. HTTP 401/403 is explicitly access rejection, never inferred eligibility or permission.
- Authorized owner navigation remains available after pairing, including connection status, binding and recovery controls.
- Real preview is labelled separately from synthetic Bills & Collections; financial actions remain unavailable.
- Status, bills and salesperson directory refresh every 15 seconds while focused and foregrounded, on focus/reconnect/app activation, and through **Refresh real preview**.
- Empty bills distinguish disabled setup, unpaired PC, disconnected PC, source-read failure, no imported bills and end of pagination. Directory loading/error/empty states are visible.
- Failed status hides protected preview content. Permission failures clear resource data; disabling a resource clears its cached response. Preview local state resets when shop or role changes.

## Update preparation

Use Node 22 and the committed lockfile. The development-branded PWA export is prepared in ignored `mobile/dist` (shell `b9450a3894de4bb7`). No secrets or API responses are included in the PWA cache.

Publish the reviewed source through the existing development deployment procedure in [VERCEL-ENVIRONMENTS.md](../VERCEL-ENVIRONMENTS.md). The target remains Vercel project `hisab-mobile`, branch `dev`, API `https://hishob-dev.onrender.com`. Record the previous Ready deployment for rollback before publication. No backend configuration, pilot allowlist, shop binding, pairing, credentials, connector queue or cursor changes are needed.

After deployment, verify the installed dev app receives the update, then check Account → RadioSoft real DEV preview with the authorized pilot owner. Confirm paired recovery access, manual refresh and newly imported bills on the active screen. Do not re-pair or revoke the live connector for UI verification.

## Validation

- TypeScript, ESLint and repository formatting: passed.
- Deployment configuration tests: 53 passed.
- Backend real RadioSoft tests: 8 passed, using a temporary local MongoDB instance.
- Development PWA export: passed.
- Full browser workflow suite: stopped after cashbook.spec.ts:57 timed out waiting for the absent “Choose Hishob method” button. Attendance passed; the next cashbook test was interrupted and 53 tests did not run. This is not a full-suite pass.
- Focused real and synthetic RadioSoft browser workflows: 3 passed (including initial status failure/retry, access rejection, paired navigation, empty-state diagnostics and bills/directory arriving through polling).
- Development deployment guard: passed; all API rewrites resolve to the development backend.
