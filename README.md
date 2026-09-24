# Hishob — Phase 1

A working Expo / React Native / TypeScript app and FastAPI / MongoDB API for shop onboarding, Owner/Manager/Worker access, mobile OTP login, and owner-managed attendance. No accounting logic is included.

## Run locally

Prerequisites: **Node 22.13+ (22 LTS recommended)**, Python 3.9+ (3.12 recommended), and MongoDB 7+ or Docker. `.nvmrc` selects Node 22. Python dependencies and the npm lockfile are checked in.

### 1. MongoDB

```sh
docker compose up -d mongo
```

Without Docker, with `mongod` installed:

```sh
./scripts/start-mongo.sh
```

Both use `mongodb://127.0.0.1:27018`. The local script persists data under `.local/mongo`; Docker uses a named volume. Use one option at a time.

### 2. API

```sh
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.lock.txt
cp .env.example .env
uvicorn app.main:create_app --factory --reload --host 0.0.0.0 --port 8000
```

Health: http://localhost:8000/health · interactive API: http://localhost:8000/docs

Alternatively, after copying `backend/.env.example` to `backend/.env`, `docker compose up --build` runs MongoDB and the API together. Compose overrides the database URI to its internal MongoDB service.

### 3. Mobile

```sh
cd mobile
npm ci
cp .env.example .env
npm start
```

Open in an **Expo Go version supporting SDK 57**, or use `npm run ios` / `npm run android` with a configured emulator. `npm run web` runs the browser preview. Expo SDK 57 and React Native 0.86 are pinned to the template's compatible versions.

Set `EXPO_PUBLIC_API_URL` before starting Expo:

| Device | API URL |
| --- | --- |
| iOS simulator / browser | `http://localhost:8000` |
| Android emulator | `http://10.0.2.2:8000` |
| Physical phone | `http://<computer-LAN-IP>:8000` |

Phone and computer must share a reachable network. Restart Expo after editing `.env`. API URLs are public app configuration, never secrets. Native auth tokens are stored with Expo SecureStore. Web preview tokens stay **in memory only** and are intentionally lost on reload.

## Roles and shop settings

There are three explicit login choices: **Owner**, **Manager**, and **Worker**. Managers and workers must first be added by an owner (or an authorised manager for workers); they cannot independently register in those roles.

| Capability | Owner | Manager | Worker |
| --- | --- | --- | --- |
| Create shops, appoint/edit/deactivate managers, change settings | Yes | No | No |
| View workers and their attendance | Yes | Yes | Own attendance only |
| Record worker arrivals/departures and correct worker attendance | Yes | Enabled by default; owner can turn off | Never |
| Record manager attendance and correct manager history | Yes | Own arrival/departure only, off by default; owner can enable | Never |
| Add workers | Yes | Off by default; owner can enable | No |
| Edit/deactivate/reactivate workers | Yes | Off by default; owner can enable | No |
| View monthly calendars | All staff | Own calendar and team history | Own only; enabled by default, owner can turn off |

Open **Owner dashboard → Shop settings** to configure each shop independently. Permissions apply to all managers/workers of that shop; they are not global account roles. The backend checks the latest saved policy on every request. Open mobile sessions refresh permissions within five seconds and on app resume.

**Check-in only is the default**: the owner or manager marks arrival once and the day is present. There is no open shift or required check-out. Owners can choose **Check-in and check-out** for shops that need both times. Settings changes apply to new arrivals, while existing open shifts remain closable and old timestamps remain visible.

Workers never mark or edit attendance. The self-check-in/out endpoints accept only managers whose owner has enabled **Managers can mark their own attendance**. This setting is off by default and independent of permission to manage worker attendance. Only the owner can correct a manager’s attendance, including half-days and leave; managers cannot mark or correct another manager.

Bottom navigation follows each role:

- **Owner:** Home, Register, Team, Account. Team lists workers and managers together; manage managers from Team or Account. Shop settings are available from Home or Account.
- **Manager:** Home, Register, My day, Team, Account. My day combines personal attendance actions and the monthly calendar.
- **Worker:** Home, Attendance, Account. Attendance remains read-only.

When you belong to more than one shop, the top-right header shows the current shop with a dropdown arrow. Tap it to open the shop picker. Selecting a shop resets navigation and filters to that shop; the picker is hidden for single-shop accounts.

**Team** defaults to active staff, with Everyone/Workers/Managers and Active/Inactive/All filters. Search matches names (case-insensitive) or mobile numbers, including formatted numbers. Status counts reflect the current search and role filter. Managers can read the shared directory but still cannot edit manager profiles.

**Register** shows tappable counts for Everyone, Present, Absent, Not marked, Half day, and Leave, plus name/mobile search. Counts always describe the whole shop register; the list reflects the selected status and search. Inactive staff with a recorded entry today remain in the register. Missing entries stay **Not marked**, never automatically Absent. Home retains its simple daily totals without an attendance progress bar.

The supplied Hishob logo appears on the welcome screen, navigation headers, account screen, app icon, splash screen, and web favicon. Green, cream, and gold styling follows the logo. Native icons, splash screens, and the installed display name require a new native build; Expo Go does not represent the final standalone branding. Internal bundle/package IDs, token storage keys, JWT identifiers, and the database name retain their existing values to preserve compatibility. No environment-variable changes are required.

## Test the complete flow

Development OTP is **123456**, shown on the OTP screen. No real SMS is sent. Enter full international mobile numbers.

1. Choose **Continue as Owner**, log in with `+919876543210`, and create a shop.
2. **Add worker** → name `Asha`, mobile `+919876543211`.
3. **Manage managers → Add manager** → name `Ravi`, mobile `+919876543212`.
4. Open **Today’s attendance → Mark in · Asha**. In the default mode, no check-out is needed.
5. On another device/session, log in as Worker with Asha’s number. Her dashboard is read-only. **My attendance** shows a monthly calendar, totals for each status, and details when a date is tapped.
6. In another session, log in as Manager with Ravi’s number. He can view the register and record/correct attendance, but cannot yet add workers or change settings.
7. Owner: **Account → Shop settings** → enable **Managers can add workers**, **Managers can mark their own attendance**, optionally **Managers can edit and deactivate workers**, choose **Check-in and check-out**, and save.
8. Manager: **Team → Add worker** now appears. Add another worker, then record **Mark in** and **Mark out** in Register. Open **My day**, tap **Mark my arrival**, then **Mark my departure**. The monthly calendar updates immediately. Owner: Register also shows Ravi and allows recording or correcting his attendance.
9. Owner or authorised manager: open **Update / history · Asha**, choose a date, tap **Update YYYY-MM-DD**, select **Half day**, add a note, and save. The worker’s calendar updates within five seconds.
10. Turn off a manager permission and verify their open session loses that action. Workers can never mark attendance, regardless of settings.
11. Edit and deactivate a worker or manager. Their next request loses shop access; history is preserved. Reactivate from the same form.
12. Try Manager/Worker login using an unadded number: it is rejected. **Account → Sign out** revokes the current session.

Owners can create several shops and users with multiple active memberships get a shop switcher. The same mobile may have different roles in different shops; the login portal and active membership both constrain access. Managers automatically have personal attendance under their manager membership; a separate worker membership is unnecessary. If an older setup already gave someone both memberships, existing records remain separate and are not silently merged.

## Checks and automated integration tests

These use **real MongoDB**, not mocks. Each backend test gets its own disposable database; the browser suite starts its own isolated API and Expo server on ports 8001 and 8082.

```sh
# MongoDB on port 27018 must be running.
cd backend
.venv/bin/pytest -q
.venv/bin/ruff check .
.venv/bin/ruff format --check .

cd ../mobile
npm run typecheck
npm run lint
npm run format:check
npx expo-doctor
npx expo export --platform ios --platform android --platform web
npx playwright install chromium
npm run test:e2e
```

For a different test database host, set `TEST_MONGODB_URI`. Tests generate isolated `hisab_test_*` / `hisab_e2e_*` databases and never clear the development database. Browser tests exercise all three roles, both attendance modes, manager onboarding, worker creation by a permitted manager, manager self-marking and default denial, role-specific bottom tabs, responsive branding, combined team search/filtering, attendance status counts/filtering, multi-shop switching, live permission changes, half-day correction, the worker calendar, month navigation, visibility settings, logout, and unadded-staff rejection. Backend tests also cover permission escalation, cross-shop access, staff deactivation/reactivation, mobile reassignment, concurrent check-in/out, OTP expiry/replay/limits, expired JWTs, unique indexes, overnight shifts, legacy data compatibility, owner-managed manager attendance, self-marking revocation, and manager self/peer correction denial.

Native bundling and web interaction are separate checks: the browser suite does not validate the iOS Keychain / Android Keystore or physical-device behavior. Run the walkthrough on your phone before distribution.

## Data and permissions

- **User** (`users`): global identity, unique normalized E.164 mobile. No `role` or `shop_id` on the user.
- **Shop** (`shops`): name, IANA timezone, creator, and shop-specific settings.
- **ShopMembership** (`memberships`): user + shop + role (`OWNER`, `MANAGER`, `WORKER`), active flag, and a display name for manager memberships. Unique `(shop_id, user_id, role)`.
- **WorkerProfile** (`worker_profiles`): membership-specific name. Unique `membership_id`. Its ID equals the worker membership ID. Attendance uses a stable staff membership ID as `worker_id` for both workers and managers; managers retain their display name on their membership and do not need a duplicate WorkerProfile.
- **Attendance** (`attendance`): unique `(shop_id, worker_id, date)`, UTC-aware timestamps, status, source, optional note, update attribution, and the most recent 100 attendance actions. A partial unique index permits at most one open shift per worker in each shop.
- Auth support collections: OTP challenges, rate limits, and revocable sessions, all with TTL expiry indexes.

Shop IDs in paths are selectors, never authority. Every protected operation verifies a live active membership, the token’s login portal, and any required shop permission. Worker reads derive identity from membership; workers have no write permission. Only owners can appoint managers or change shop policy.

Existing shops without saved settings receive the defaults above without a data rewrite. Legacy `ADMIN` memberships are exposed as Manager memberships through Manager login; they do not confer Owner access. Existing worker profiles, history, and open shifts remain intact. No destructive migration or environment-variable change is needed.

Workers are deactivated, never deleted. Changing a worker's mobile reassigns that shop membership and its existing history to the new verified mobile account; the old account immediately loses that membership. The edit screen explains this behavior. Duplicate workers are rejected; reactivate the original instead.

## Attendance rules

- Days use the **shop timezone**; timestamps are UTC-aware and displayed in the shop timezone.
- Owner/authorised-manager check-in marks `PRESENT`. No automatic payroll or half-day-duration rules are applied.
- **Check-in only** records arrival without creating an open shift. **Check-in and check-out** records an open shift that the owner/manager closes on departure. The selected mode is stored with each new shift.
- Missing days are `NOT_MARKED`, not automatically absent. The calendar covers the joining date through today; future and pre-joining dates are disabled. Summaries count each status separately; half-days are not counted as full present days.
- Atomic conditional writes and unique indexes prevent duplicate arrivals/departures and check-out without an open check-in.
- An overnight shift keeps its arrival date. The owner/manager sees the earlier open shift and closes it before starting another. Switching to check-in only does not strand it.
- Owner/authorised-manager corrections support `PRESENT`, `ABSENT`, `HALF_DAY`, `LEAVE`, `NOT_MARKED` and a note. Corrections close an open shift and retain existing times; they do not invent a departure timestamp. To record both a half-day and its departure time, mark out before correcting the status.
- `NOT_MARKED` deliberately clears the times so an authorised person can re-record arrival. Workers can never edit or reset attendance.
- Every marking/correction records who changed it. Deactivation retains history; owners/authorised managers can close existing shifts for inactive workers.

## API surface

All paths below are prefixed with `/api`; all except OTP endpoints require a bearer JWT.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/auth/otp/request` | `{mobile, role}` → challenge ID, expiry, resend delay, development OTP |
| POST | `/auth/otp/verify` | `{challenge_id, code}` → access token, expiry |
| GET | `/auth/me` | User, login portal, active memberships, shop settings and effective permissions |
| POST | `/auth/logout` | Revoke current session |
| POST | `/shops` | Owner creates `{name, timezone}` |
| GET | `/shops/{shop_id}/team` | Owner/manager reads workers and managers, including inactive staff |
| GET | `/shops/{shop_id}/workers` | Owner/authorised manager lists active and inactive workers |
| POST | `/shops/{shop_id}/workers` | Owner/authorised manager adds `{name, mobile}` |
| PATCH | `/shops/{shop_id}/workers/{worker_id}` | Owner/authorised manager updates `{name, mobile, active}` |
| GET | `/shops/{shop_id}/attendance/today` | Worker and manager register with per-person `can_mark` / `can_edit` permissions |
| GET | `/shops/{shop_id}/workers/{worker_id}/attendance?month=YYYY-MM` | Owner/authorised manager monthly history |
| PUT | `/shops/{shop_id}/workers/{worker_id}/attendance` | Owner/authorised manager sets `{date, status, note}` |
| GET | `/shops/{shop_id}/me/attendance/today` | Worker/manager own today and active shift |
| GET | `/shops/{shop_id}/me/attendance?month=YYYY-MM` | Worker/manager own calendar, summary, joining date and today |
| POST | `/shops/{shop_id}/me/attendance/check-in` | Manager records own arrival if permitted by owner |
| POST | `/shops/{shop_id}/me/attendance/check-out` | Manager records own departure if permitted by owner |
| POST | `/shops/{shop_id}/workers/{worker_id}/attendance/check-in` | Owner/authorised manager records arrival |
| POST | `/shops/{shop_id}/workers/{worker_id}/attendance/check-out` | Owner/authorised manager records departure |
| GET | `/shops/{shop_id}/settings` | Active member reads current shop policy |
| PUT | `/shops/{shop_id}/settings` | Owner replaces the shop policy |
| GET / POST | `/shops/{shop_id}/managers` | Owner lists/adds managers |
| PATCH | `/shops/{shop_id}/managers/{manager_id}` | Owner edits/deactivates/reactivates a manager |

The attendance routes under `/workers/{worker_id}` accept either worker or manager membership IDs. Owner access covers both; a manager’s team permission applies only to workers, and self-marking uses the separate owner-controlled setting. Worker profile CRUD remains worker-only. `PUT /settings` includes `manager_can_mark_own_attendance` (default `false`).

`GET /health` checks database connectivity. `/docs` contains request schemas and runnable examples. Typical errors: 400 invalid OTP, 401 expired/revoked session, 403 forbidden access/unadded worker, 404 wrong-shop worker, 409 attendance/duplicate worker conflict, 422 validation, 429 throttling, 503 database/provider unavailable.

## Environment variables

| Variable | Default/example | Purpose |
| --- | --- | --- |
| `APP_ENV` | `development` | `development` / `test` allow dev OTP; production rejects it |
| `MONGODB_URI` | `.env.example`: `mongodb://127.0.0.1:27018` | MongoDB connection (includes credentials in a deployed environment) |
| `MONGODB_DATABASE` | `hisab` | App database |
| `JWT_SECRET` | **Required**, minimum 32 characters | Use a strong random secret; example value is development only |
| `JWT_EXPIRE_MINUTES` | `10080` | Session duration (7 days); expires into OTP re-login |
| `OTP_PROVIDER` | `dev` | Provider registered in `app/otp.py` |
| `DEV_OTP` | `123456` | Six-digit local test code |
| `OTP_EXPIRE_SECONDS` | `300` | OTP lifetime |
| `OTP_RESEND_SECONDS` | `30` | Per-mobile cooldown |
| `OTP_MAX_ATTEMPTS` | `5` | Per-challenge verification limit |
| `CORS_ORIGINS` | JSON array | Browser origins allowed by the API |
| `EXPO_PUBLIC_API_URL` | `http://localhost:8000` | Mobile API base, without `/api` |
| `TEST_MONGODB_URI` | `mongodb://127.0.0.1:27018` | Test runner only |

OTP requests are limited per mobile and peer IP in MongoDB, so limits work across API workers. Verification is limited per challenge and peer IP. OTP hashes use HMAC, codes are not logged, successful challenges are single-use, and manager/worker eligibility is rechecked after verification. TTL cleanup is not relied on for expiry enforcement. Configure trusted proxy IPs correctly when deploying behind a proxy.

To add real SMS, implement `OTPProvider.send(mobile, code)` and register it in `get_provider()` in `backend/app/otp.py`. Auth already generates random six-digit codes for non-dev providers. Production startup rejects the development provider and placeholder secret; use HTTPS, a random JWT secret, and authenticated MongoDB when deploying. Real SMS delivery is intentionally outside this development phase.

## Files

- `backend/app/config.py`, `db.py`, `schemas.py`: configuration, collections/indexes, validated inputs.
- `backend/app/security.py`, `shop_policy.py`, `otp.py`: authentication, shop permissions, SMS provider boundary.
- `backend/app/routers/{auth,shops,attendance}.py`: complete REST workflows.
- `backend/app/main.py`: application factory, startup, CORS, health, error handling.
- `backend/tests/`: real-database integration tests and isolated browser-test server.
- `mobile/src/{api,auth,storage,hooks,types}.*`: typed API client, session lifecycle, SecureStore, data refresh.
- `mobile/src/screens/`: owner, manager and worker screens, including shop settings.
- `mobile/src/components/`: shared UI, shop switching, attendance calendar/summary, cards and month controls.
- `mobile/App.tsx`: authenticated role-specific bottom tabs with native stack detail screens.
- `mobile/src/components/Brand.tsx`, `mobile/assets/brand/hishob-logo.png`, `mobile/app.json`: shared branding and native/web launch assets.
- `mobile/e2e/`, `mobile/playwright.config.ts`: full browser integration tests.
- `compose.yaml`, `backend/Dockerfile`, `.env.example` files, `scripts/start-mongo.sh`: runnable development setup.

The npm dependency override pins `xcode`’s transitive `uuid` to 11.1.1, retaining its CommonJS `v4()` API while fixing the vulnerable older version shipped by the Expo dependency tree. `npm audit` reports no vulnerabilities with the committed lockfile.

## Verified in this workspace

- 20 backend integration tests passed against MongoDB 7.0.2.
- 5 Playwright browser tests cover the full owner/manager/worker flow and staff login eligibility.
- TypeScript, ESLint, Prettier, Ruff lint/format checks passed.
- Expo Doctor: 21/21 checks passed.
- iOS, Android, and web production JavaScript bundles exported successfully.
- npm audit: 0 vulnerabilities.
- Native binaries were not built or run on a physical device or simulator in this workspace.
