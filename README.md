# Hishob — Phases 1 & 2

A working Expo / React Native / TypeScript app and FastAPI / MongoDB API for shop onboarding, Owner/Manager/Worker access, mobile-and-password login, owner-managed attendance, and a daily cash register with audited closing. Billing, GST, inventory, payroll and AI features are outside this phase.

## Flexible daily Hishob

Choose **Count cash**, **Enter sales**, or **Use billing totals** in Account → Shop settings (or Hishob → Choose Hishob method before opening a day). Expenses can be paid from cash or digitally. Closing records money removed for the bank/home and carries only cash kept in the galla into tomorrow. **Calendar & sales** shows monthly totals with recorded and estimated sales separated. See [methods, calculations, API changes and examples](docs/HISHOB-METHODS.md).

## Web / PWA pilot

Hishob can be installed from a web link with persistent browser login, connection recovery and safe app updates. Access is unrestricted; the first ten owners get all existing owner features. See [PWA deployment and pilot guide](docs/PWA-PILOT.md) for Atlas, Render, Vercel, local preview and device checks. Password login and owner recovery email setup are described in [Password accounts and recovery](docs/PASSWORD-AUTH.md).

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

Phone and computer must share a reachable network. Restart Expo after editing `.env`. API URLs are public app configuration, never secrets. Native auth tokens are stored with Expo SecureStore. Web sessions use a persistent HttpOnly cookie. Production web builds use a same-origin `/api` proxy; see the PWA guide.

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

- **Owner:** Home, Register, Hishob, Team, Account. Team lists workers and managers together; manage managers from Team or Account. Shop settings are available from Home or Account.
- **Manager:** Home, Register, My day, Team, Account. With financial access, Hishob replaces My day in the tab bar; personal attendance actions and the monthly calendar stay available from Home and Account.
- **Worker:** Home, Attendance, Account. Attendance remains read-only.

When you belong to more than one shop, the top-right header shows the current shop with a dropdown arrow. Tap it to open the shop picker. Selecting a shop resets navigation and filters to that shop; the picker is hidden for single-shop accounts.

**Team** defaults to active staff, with Everyone/Workers/Managers and Active/Inactive/All filters. Search matches names (case-insensitive) or mobile numbers, including formatted numbers. Status counts reflect the current search and role filter. Managers can read the shared directory but still cannot edit manager profiles.

**Register** shows tappable counts for Everyone, Present, Absent, Not marked, Half day, and Leave, plus name/mobile search. Counts always describe the whole shop register; the list reflects the selected status and search. Inactive staff with a recorded entry today remain in the register. Missing entries stay **Not marked**, never automatically Absent. Home retains its simple daily totals without an attendance progress bar.

The supplied Hishob logo appears on the welcome screen, navigation headers, account screen, app icon, splash screen, and web favicon. Green, cream, and gold styling follows the logo. Native icons, splash screens, and the installed display name require a new native build; Expo Go does not represent the final standalone branding. Internal bundle/package IDs, token storage keys, JWT identifiers, and the database name retain their existing values to preserve compatibility. No environment-variable changes are required.

The mobile number field includes a searchable country-code picker (India +91 by default). Enter the national number beside it, or paste a full international number. Password login uses the combined international number. The same picker is available when changing your login number and when adding or editing workers and managers. Country calling-code metadata in `mobile/src/data/countries.json` comes from the backend’s installed `phonenumbers` package.

## Phase 2 — Daily Hishob

Open the **Hishob** bottom tab for today’s cash register, transaction search and the monthly calendar. Home and Account shortcuts also open this tab. It is visible to owners and managers with financial access; workers cannot access it. For managers with financial access, personal attendance is available from Home and Account, keeping the bottom bar to five tabs.

Amount fields show Indian comma grouping as you type (for example `1,25,000.50`), including opening cash, transactions, corrections and closing cash. API values remain plain decimal strings.

**Hishob history** opens as a monthly calendar. Tap a date for its cash summary, then open the full day. Gold marks open days, green marks closed days, and a red dot flags a closing cash difference. Month arrows, status counts and a current-month shortcut help with reviews; **Date range** retains the custom-range list. Dates follow the shop timezone, and missing days remain “Not started” rather than being treated as zero cash.

Main app detail pages retain the bottom tabs, including Hishob, team forms, attendance history, account changes and shop settings. Switching tabs preserves your place and unsaved form fields; tapping the active tab again returns to its main page. Login and first-shop onboarding remain outside the tabs.

### Finding transactions

Open **Hishob → Search transactions**. Search descriptions, categories or the person who recorded the entry. Filter by cash, digital or credit sales, other cash in, expenses, supplier payments, bank deposits or withdrawals. Search defaults to all dates; choose Today, This month or a custom date range. Each result opens its original day for details and permitted corrections. Individual day transaction lists also support text and type filters.

Results show matching counts and separate cash-in/cash-out totals across all matching active entries, with 30 results per page. **More filters** can include deleted entries or show only deleted entries; these never contribute to the totals. Search is case-insensitive literal text (up to 100 characters). The backend validates the shop membership and financial permission on every request, and uses the existing shop/date index before searching embedded transactions. No database migration or new environment variables are required.

### Daily calculation

For Enter sales and Billing methods (transfers include those recorded at closing):

```
Expected closing cash = Opening cash + Cash sales + Other cash in
                        - Cash expenses - Cash supplier payments - Bank deposits - Withdrawals
Difference = Cash retained in galla - Expected closing cash
```

Enter money as decimal strings, for example `"15000.00"`. The backend validates at most two decimal places, converts to integer paise using `Decimal`, and recalculates totals from every non-deleted transaction. MongoDB stores money as integer paise; JSON responses use two-decimal strings. The client uses `BigInt` paise for difference previews and formatting. No floating-point currency calculations are used. Each entered amount is at most ₹99,99,99,999.99; transaction amounts must be positive, opening/actual cash can be zero. Expected cash and the difference may be negative.

A shop has one day per business date, using its saved IANA timezone. The first day requires manual opening cash. Later days default to the **latest earlier CLOSED day's actual cash**, with source date, ID, revision and amount recorded. Overrides require a reason. Opening cash is fixed when a day is created: reopening or correcting an earlier day does not silently cascade into later days.

For Enter sales/Billing methods, closing compares cash against recorded cash sales and requires a note when the difference is nonzero. Count cash estimates sales instead and leaves expected cash/difference unavailable. Closing separately records the physical count and money removed for the bank/home; expected and actual closing balances represent the cash retained after those transfers. It preserves a complete snapshot: totals, entries, cash count, notes, actor and timestamp. Closed days reject mutations. Only owners can reopen them, with a reason. Each subsequent closing creates another snapshot; older snapshots remain readable in Day details.

### Financial permissions

| Action | Owner | Manager | Worker |
| --- | --- | --- | --- |
| View current day/history/audit | Yes | Requires `manager_can_access_hishob` | No |
| Start day, add transactions, override opening with reason | Yes | Requires `manager_can_access_hishob` | No |
| Edit / soft-delete transactions | Yes, with reason | No | No |
| Close day | Yes | Requires both financial access and `manager_can_close_hishob` | No |
| Reopen day | Yes, with reason | No | No |

Both manager settings default to **false** on new and existing shops. Set them in **Account → Shop settings**. The backend checks live membership, shop and permission on every request; workers cannot read financial data even by guessing a URL. Permission changes remove financial screens from an open manager session on refresh.

### Financial storage and consistency

`hishob_days` is a new collection with unique `(shop_id, date)` and lookup `(shop_id, status, date)` indexes. Daily documents contain individually addressable transaction records with IDs, shop/day/date, type, amount, category, description, creator, timestamps and soft-deletion metadata. They also contain calculated totals, a revision, append-only audit events and immutable closing snapshots. This is intentionally a **single-document aggregate**, not a totals-only ledger: one atomic compare-and-swap saves the entry, totals and audit together, and works with the existing standalone MongoDB without introducing replica-set transactions.

All updates require the revision the editor originally loaded. Concurrent edits/closing return **409**, requiring a refresh and review; they never silently overwrite another change. Transaction creation also requires a stable `request_id`, so retrying the same save after a network failure does not duplicate an entry. Reusing it with different values is rejected. Soft deletion retains the original entry and before/after audit. Day details show actors, timestamps, reasons and before/after values; snapshots expose the exact entries that were closed.

No audit events or snapshots are truncated. A 12 MB per-day document guard rejects further growth before MongoDB's 16 MB limit; unusually large daily registers need a future storage migration. History queries accept date ranges up to 366 days and return summaries without transaction/audit payloads; open a day for full details. The API also supports creating a missing past day between shop creation and today; the mobile creation flow deliberately starts today's day only. No new environment variables or destructive migrations are needed. Restart the API to create the new indexes automatically.

### Phase 2 APIs

Prefix every path below with `/api/shops/{shop_id}/hishob`. All routes require an authenticated native/browser session and financial shop permission.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/monthly-summary?month=YYYY-MM` | Closed-day sales, recorded/estimated split, payment types, expenses, transfers and coverage counts |
| GET | `/transactions?q=tea&type=EXPENSE` | Search entries; optional `from_date` + `to_date`, `entry_status=ACTIVE/ALL/DELETED`, `page`, `page_size` (1–100); returns items, count and active cash-in/out totals |
| GET | `/today` | Today's record, date/timezone, suggested opening and permissions |
| POST | `/days` | Create day; `{opening_cash?, date?, reason?}` |
| GET | `/days?from_date=YYYY-MM-DD&to_date=YYYY-MM-DD` | Date-filtered summaries |
| GET | `/days/{day_id}` | Full breakdown, entries, snapshots and audit |
| PATCH | `/days/{day_id}/opening` | `{revision, opening_cash, reason}` |
| POST | `/days/{day_id}/transactions` | `{revision, request_id, type, amount, payment_method?, category?, description}` |
| PATCH | `/days/{day_id}/transactions/{transaction_id}` | `{revision, type, amount, payment_method?, category?, description, reason}` |
| POST | `/days/{day_id}/transactions/{transaction_id}/delete` | Soft-delete; `{revision, reason}` |
| POST | `/days/{day_id}/close` | `{revision, actual_closing_cash, cash_sales?, digital_sales?, credit_sales?, closing_bank_deposit?, closing_withdrawal?, notes?, difference_note?}` |
| POST | `/days/{day_id}/reopen` | Owner only; `{revision, reason}` |

The existing `/settings` and `/auth/me` responses include `hishob_mode`, the financial permission settings and effective `view_hishob`, `add_hishob_transactions`, `edit_hishob_transactions`, `close_hishob`, `reopen_hishob` permissions. `/docs` has the full schemas.

### Test Phase 2 manually

1. Register/sign in as Owner (development email verification code `123456`) and create a fresh shop. Open **Today's Hishob** from Home.
2. Enter opening cash **0** and start the day.
3. Add **Cash sales ₹15,000**, **Expense ₹500** (Transport), and **Bank deposit ₹2,000**. Current Galla is **₹12,500**; at closing this becomes the expected cash for comparison with your count.
4. Open **Close day**, enter **₹12,300** actual cash. Difference is **-₹200**. Choose **Cash shortage**, then close.
5. Open **Hishob history**, tap the date in the calendar, and open the day. Try month navigation, status counts and the **Date range** list. Review its entries, creator names, audit and preserved closing.
6. Reopen with a reason, correct an entry or soft-delete a duplicate, then close again. Both closing snapshots remain available.
7. On the next local business date, start the new day. Opening defaults to the last closed day's **actual** cash. Override only with a reason. Automated API tests advance the clock to verify this without waiting a real day.
8. Add a manager. Initially Hishob is unavailable. Enable financial access: they can view/add but cannot close. Enable closing separately and verify they can close but cannot edit/delete/reopen. Disable access and verify the open manager app loses financial screens.
9. Switch to another shop: its register and opening cash are independent. Workers have no financial entry point and financial API requests are denied.

New implementation files: `backend/app/financial_schemas.py`, `backend/app/routers/hishob.py`, `backend/tests/test_hishob.py`, and `mobile/src/financial/{types,money,components,screens,history,calendar,search}.*`. Existing database setup, app factory, shop policy/settings, navigation, Home/Account screens and browser tests are extended. Use the same run/test commands below; no new dependencies are required.

## Concurrent logins

Workers and managers share **one active staff session per account**, across all shops. A successful password login replaces their previous staff session. Owners may keep **three active Owner sessions**; the fourth successful login replaces the oldest. The limits are separate by login portal group, so an Owner session never grants worker/manager permissions. Failed logins and unapproved reset requests do not log anyone out; approved resets and password changes revoke existing sessions.

Session limits are enforced by an atomic, bounded allowlist on the User document, including concurrent logins. Every protected API checks the allowlist. A displaced app returns to login on its next request, normally within five seconds while open, or when resumed. Explicit logout and expiry free their slots. Legacy sessions are checked against the same limits and carried forward when a new login initializes the allowlist. No environment changes are needed.

## Owner account details

Owners provide their name and a verified recovery email at registration. Existing names can be updated through **Account → Edit your name**. **Password & security** changes a known password. **Change mobile number** checks the current password and a code sent to the recovery email, then updates the number and revokes other sessions without changing user/shop/history IDs. No SMS verification is used.

See [password onboarding, recovery, existing-account migration, SMTP settings and API reference](docs/PASSWORD-AUTH.md). Existing logged-out owners without an email require operator-assisted enrollment; a phone number alone cannot claim an old account.

## Test the complete flow

Development **email** code is **123456**, shown on the email verification screen. No real email is sent until SMTP is configured. Use full international mobile numbers and passwords of 12–128 characters.

1. Choose **Continue as Owner**, register with `+919876543210`, your name, a recovery email and a password, then create a shop. India/Kolkata is the default timezone; tap **Change** to use another IANA timezone.
2. **Add worker** → name `Asha`, mobile `+919876543211`.
3. **Manage managers → Add manager** → name `Ravi`, mobile `+919876543212`.
4. Open **Today’s attendance → Mark in · Asha**. In the default mode, no check-out is needed.
5. Owner: open **Team → Password access · Asha → Generate setup code**, then share the code directly with Asha. On another device/session, choose Worker, enter Asha’s number, and use the setup code to set/confirm her password. Her dashboard is read-only. **My attendance** shows a monthly calendar, totals for each status, and details when a date is tapped.
6. Issue Ravi a setup code through Password access, then set his password in another Manager session. He can view the register and record/correct attendance, but cannot yet add workers or change settings.
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

For a different test database host, set `TEST_MONGODB_URI`. Tests generate isolated `hisab_test_*` / `hisab_e2e_*` databases and never clear the development database. Browser tests exercise all three roles, both attendance modes, manager onboarding, worker creation by a permitted manager, manager self-marking and default denial, role-specific bottom tabs, responsive branding, combined team search/filtering, attendance status counts/filtering, multi-shop switching, live permission changes, half-day correction, the worker calendar, month navigation, visibility settings, logout, unadded-staff rejection, owner name onboarding/editing, and verified mobile change followed by login with the new number. Backend tests also cover permission escalation, cross-shop access, staff deactivation/reactivation, mobile reassignment, concurrent check-in/out, OTP expiry/replay/limits, expired JWTs, unique indexes, overnight shifts, legacy data compatibility, owner-managed manager attendance, self-marking revocation, and manager self/peer correction denial.

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

All paths below are prefixed with `/api`; all except the public login/onboarding/recovery endpoints require a bearer JWT (native) or the HttpOnly session cookie (web). Browser writes also require `X-Hishob-Client: web` and an exact allowed `Origin`.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/auth/password/options` | `{mobile, role}` → login/onboarding step |
| POST | `/auth/password/login` | `{mobile, role, password}` → native token or HttpOnly session cookie |
| POST | Owner/staff setup and recovery endpoints | See [password API reference](docs/PASSWORD-AUTH.md#api-changes) |
| GET | `/auth/me` | User, login portal, active memberships, shop settings and effective permissions |
| PATCH | `/auth/profile` | Owner updates their own `{name}` |
| POST | `/auth/mobile-change/request` | Owner submits `{mobile, role: OWNER, password}`; send a code to the recovery email |
| POST | `/auth/mobile-change/confirm` | Verify recovery-email `{challenge_id, code}`; update identity and return a replacement native token or web session cookie |
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
| `APP_ENV` | `development` | `development` / `test` allow dev email; production rejects it |
| `MONGODB_URI` | `.env.example`: `mongodb://127.0.0.1:27018` | MongoDB connection (includes credentials in a deployed environment) |
| `MONGODB_DATABASE` | `hisab` | App database |
| `JWT_SECRET` | **Required**, minimum 32 characters | Use a strong random secret; example value is development only |
| `JWT_EXPIRE_MINUTES` | `10080` | Session duration (7 days); expires into password re-login |
| `EMAIL_PROVIDER` | `dev` | `dev` or `smtp`; production requires SMTP |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_SSL` | See `.env.example` | Authenticated owner email delivery |
| `DEV_OTP` | `123456` | Six-digit local test code |
| `OTP_EXPIRE_SECONDS` | `300` | OTP lifetime |
| `OTP_RESEND_SECONDS` | `30` | Per-email cooldown |
| `OTP_MAX_ATTEMPTS` | `5` | Per-challenge verification limit |
| `CORS_ORIGINS` | JSON array | Browser origins allowed by the API |
| `EXPO_PUBLIC_API_URL` | `http://localhost:8000` | Native/development API base, without `/api` |
| `EXPO_PUBLIC_WEB_API_URL` | Unset | Development web-only override; production web always uses same-origin /api |
| `TEST_MONGODB_URI` | `mongodb://127.0.0.1:27018` | Test runner only |

Password attempts and email-code requests are rate-limited per account/address and peer IP in MongoDB. Codes use HMAC hashes, are single-use and expire explicitly. Passwords use Argon2id hashes; native SecureStore and browser HttpOnly session cookies remain. See [security and SMTP setup](docs/PASSWORD-AUTH.md#email-configuration). SMS login is removed.

## Files

- `backend/app/config.py`, `db.py`, `schemas.py`: configuration, collections/indexes, validated inputs.
- `backend/app/security.py`, `shop_policy.py`, `passwords.py`, `email_provider.py`: authentication, shop permissions, password hashing and email delivery.
- `backend/app/routers/{auth,password_auth,account,shops,attendance}.py`: complete REST workflows.
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

- 99 backend integration tests passed against real MongoDB, including browser cookies, CSRF, session limits, mobile-number changes, native bearer compatibility and total-only billing.
- 16 workflow/formatting Playwright checks cover attendance, account flows, the cash register, history, search and currency editing, cash-count/billing modes, total-only reports and monthly sales. 4 additional PWA checks cover production-export installation metadata, persistent login, offline recovery, drafts, safe updates and unconfirmed saves.
- TypeScript, ESLint, Prettier, Ruff lint/format checks passed.
- Expo Doctor: 21/21 checks passed.
- iOS, Android, and web production JavaScript bundles exported successfully.
- npm audit: 0 vulnerabilities.
- Native binaries were not built or run on a physical device or simulator in this workspace.
