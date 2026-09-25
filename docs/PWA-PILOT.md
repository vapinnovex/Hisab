# Hishob PWA pilot

Owners get a normal HTTPS link. They can use it in their browser immediately, or install Hishob on their home screen. There is no store release, invitation gate, ten-owner cap, feature restriction, or paid-plan gate. Existing owner/manager/worker permissions still apply.

## What is included

- Persistent **HttpOnly browser cookie**, scoped to `/api`, host-only, SameSite=Lax, Secure on HTTPS/production. Browser JavaScript never receives or stores the JWT. Native apps continue using SecureStore.
- Sessions survive reloads and browser restarts until their configured expiry (default **7 days**, `JWT_EXPIRE_MINUTES=10080`; maximum supported 30 days). Signing out revokes the server session. The existing limits remain: owners three sessions, managers/workers one. A browser and an installed app can have separate cookie stores and count as separate sessions.
- An install manifest, Hishob icons, Android/desktop install prompt where supported, iPhone instructions, standalone presentation, and Account-page installation guidance.
- A versioned service worker caches **only the public app shell, fonts and images**. No API responses, JWTs, transactions, attendance, or personal data are persisted in its cache. Already displayed data can remain visible in memory while disconnected, with a stale-data banner.
- Cold offline launch shows a reconnect screen rather than private cached data or a misleading logout. Returning online refreshes the session and focused screens. Server outages are retried with read-only requests.
- Offline writes fail before sending. Draft inputs stay in the open form. A timed-out/lost write response is explicitly **unconfirmed**, never automatically retried. Transaction retries from the same form retain their existing idempotency key. Other changes must be reviewed on reconnect before retrying.
- A newly installed app version waits for an explicit **Update Hishob** action. Unsaved financial, shop, team, profile and settings forms block that action. Browser reload/close warns about these unsaved forms where supported. Drafts are not saved across a forced close, OS eviction or account/shop switch.

The OTP provider is unchanged, as requested. The existing production startup guard still rejects development OTP. Complete the real provider separately before onboarding real accounts; this change does not bypass that guard.

## Hosting: Atlas + Render + Vercel

### 1. MongoDB Atlas

Create a cluster, database user and network access for your API host. Set the connection URI as Render's `MONGODB_URI`, and `MONGODB_DATABASE=hisab`. Use Render's documented outbound IP ranges for the chosen region. The API creates its indexes at startup. Keep database credentials exclusively on the backend. Configure database backups appropriate to the cluster you choose.

### 2. Render API

Create a Python web service from this repository with **Root Directory `backend`**:

- Build: `pip install -r requirements.lock.txt`
- Start: `uvicorn app.main:create_app --factory --host 0.0.0.0 --port $PORT`
- Health path: `/health`
- Environment: `APP_ENV`, `MONGODB_URI`, `MONGODB_DATABASE`, random `JWT_SECRET`, `JWT_EXPIRE_MINUTES`, OTP settings from `backend/.env.example`, and the exact browser origins in `CORS_ORIGINS`.

For example, once the frontend address is known:

```env
CORS_ORIGINS=["https://hishob.example.com"]
JWT_EXPIRE_MINUTES=10080
```

Keep this origin stable so installed apps and their cookies continue working. Include the exact Vercel production URL as another origin only if owners will actually use it. Do not use `*` or allow arbitrary preview origins. Use a backend instance that stays available during business hours; otherwise cold starts can exceed the client's 15-second timeout.

### 3. Vercel web app

1. **Replace `YOUR-HISHOB-API` in `mobile/vercel.json` with the actual Render hostname.** This is a required deployment-specific value.
2. Import the repository. Set **Root Directory `mobile`**, framework **Other**, Node **22.x**, install `npm ci`. The committed config sets build `npm run build:web` and output `dist`.
3. Leave `EXPO_PUBLIC_WEB_API_URL` **unset** (or empty) for deployment. The exported PWA calls `/api` on its own origin; Vercel proxies these requests to Render. This is essential for reliable cookie login on Safari and browsers blocking third-party cookies. `EXPO_PUBLIC_API_URL` remains the separate native/development setting.
4. Deploy and add the final HTTPS domain to Render's `CORS_ORIGINS`, then restart/redeploy the API. No backend credentials belong in Vercel's public Expo variables.
5. Check `https://YOUR-APP/api/auth/me` in a fresh browser: a **401 JSON response** is expected before login. HTML, 404, or 502 here means the rewrite/API needs fixing.
6. Log in, create a shop, reload, and verify the same account returns. Test sign-out and another browser account. Then share the stable app link with owners.

`mobile/vercel.json` includes the API rewrite, SPA fallback, no-store API responses and non-cached service-worker updates. Keep `/api` ahead of the SPA fallback so missing API routes cannot return the app HTML. Do not put a broad CDN cache in front of `/api`.

## Local production PWA preview

Expo development mode does not register a service worker. Use the exported preview to test installation, updates and offline startup.

Start MongoDB and the ordinary backend on port 8000 using the root README. Add `http://localhost:8083` to the backend's `CORS_ORIGINS`, retaining other needed local origins, and restart it. Then:

```sh
cd mobile
npm ci
EXPO_PUBLIC_WEB_API_URL='' npm run build:web
PWA_API_PROXY=http://127.0.0.1:8000 npm run preview:pwa
```

Open **http://localhost:8083** on this computer. The preview server binds only to loopback. A physical phone must use the deployed **HTTPS** link for PWA installation; a plain LAN HTTP address does not qualify as a secure PWA origin. HTTPS is handled by Vercel/Render in deployment.

## Verification

```sh
# From repository root; real MongoDB must be running on port 27018.
backend/.venv/bin/python -m pytest backend/tests -q
backend/.venv/bin/ruff check backend
backend/.venv/bin/ruff format --check backend

cd mobile
npm run typecheck
npm run lint
npm run format:check
npm run test:e2e
npm run test:pwa
```

Run the browser suites sequentially: both use an isolated API on port 8001 and unique test databases which are removed afterward. The PWA suite builds an export and serves it on port 8083 with a same-origin API proxy. It checks persistent cookies, reload/reopen, logout, manifest/icon sizes, offline startup/recovery, draft retention, unconfirmed saves, idempotent retry, app-update deferral, and exclusion of API data from the cache.

Before sharing the link, check on a real Android phone and iPhone:

1. Owner logs in → names their shop → adds a manager and worker. Each account sees its permitted features.
2. Install from the prompt/browser menu (Android) or Safari Share → Add to Home Screen (iPhone). Reopen from the icon and verify login.
3. Enter a transaction, turn off connectivity and press Save. The form stays open and says nothing was sent. Reconnect, save once, and verify the entry.
4. Fully close the app and reopen online. Then repeat offline: the cached shell opens with the reconnect message.
5. Publish a later build and reopen the app. The update prompt must wait for confirmation and preserve unsaved forms.
6. Log out and reopen: the sign-in screen returns. Test session eviction with a fourth owner session and a second staff session.

Automated Chromium tests cannot confirm the actual Android install dialog, iOS Add to Home Screen behavior, or OS-specific cookie retention. These device checks remain part of launch validation.

## Implementation map

- `backend/app/web_session.py`, `security.py`, `main.py`, `config.py`: browser cookie transport, shared session validation, exact-origin write checks, credentialed CORS and non-cacheable API responses.
- `backend/app/routers/auth.py`, `account.py`: existing OTP verification, logout and mobile-change endpoints now support cookie sessions alongside native bearer responses. No new accounting API or OTP provider was introduced.
- `mobile/src/storage.ts`, `auth.tsx`, `api.ts`, `connection.ts`, `hooks.ts`: persistent session restoration, public API URL selection, connection state and refresh behavior.
- `mobile/src/pwa.tsx`, `App.tsx`, account and form screens: installation guidance, connection/update banners and unsaved-form protection.
- `mobile/public/`, `scripts/build-pwa.cjs`, `scripts/worker.template.js`, `scripts/serve-pwa.cjs`, `app.json`, `vercel.json`: install assets, exported app shell, update worker, local proxy preview and hosting configuration.
- `backend/tests/test_web_session.py`, `mobile/e2e/pwa.spec.ts`, Playwright configs and test server: session security and production PWA integration checks.
- Package/lockfile, TypeScript configuration, `.env.example` files, mobile contributor instructions and README: reproducible tooling and setup documentation.
