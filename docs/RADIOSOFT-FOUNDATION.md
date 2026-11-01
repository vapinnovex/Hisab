# RadioSoft foundation — synthetic preview only

Implemented against branch `dev`, inspected HEAD `0ed77d2`. The existing uncommitted README edit and the supplied handoff folder were preserved. No RadioSoft database was accessed, no shop was paired live, and nothing was deployed. The Windows connector, installer and Windows UI are **not implemented in this task**.

## Ownership and stages

RadioSoft owns bills, payable, lines, attribution and source corrections. Hishob owns collection events. Source cash/card/tender fields are rejected by the v1 input schema; they cannot produce receipts, paid status, bank verification or customer credit. Source series 0/1 do not imply a payment method. Bill discounts must be corrected at source.

1. **This change:** approved synthetic scope; OFF/PREVIEW settings; pairing/credential contract; atomic bill observations and pilot collections; permissions; daily comparison evidence; auto-refreshing page; synthetic security, fault and regression tests.
2. **Next task:** separately packaged Windows service, installer and local setup/status UI; durable outbox/checkpoints; SELECT-only extraction; reconnect/restart/reinstall tests. No ChatGPT, VS Code or terminal dependency.
3. **Later source validation:** confirmed Lalpotu shop/owner IDs, installation, FirmCode and types; vendor save/amount/lifecycle contract; non-production before/after fixtures; shadow comparison and performance measurements. A separately reviewed change is required to permit real ingestion.
4. **Later accounting release:** audited cutover and explicit opening/history policy, closed-day routing, reconciliation and refunds. Activation and preview promotion do not exist in this change.

Production startup rejects the synthetic feature flag. `ACCOUNTING` is rejected by the settings schema, and no report/export/cashbook path reads this ledger. Production can receive this code with the integration OFF; it cannot activate preview or accounting. No automatic promotion or implicit cutover is possible.

## Repository trace and financial boundary

| Concern | Existing code | Effect of this change |
| --- | --- | --- |
| Session, role and live shop membership | `backend/app/security.py`, `routers/auth.py`, `sessions.py` | Reused for every user request; owner/manager/ADMIN supported, workers excluded |
| Shop ownership and ordinary settings | `routers/shops.py`, `shop_policy.py`, `schemas.py` | Existing permissions untouched; separate owner-controlled preview grants |
| Integer-paise money and manual BILLING calculations | `cashbook.py`, `financial_schemas.py` | Unchanged. Existing billing/digital/credit subtraction is never applied to imported bills |
| Customer credit and due receipts | `dues.py`, `routers/dues.py` | Unchanged. Unpaid imported bills do not become customer-credit balances |
| Day revisions, cashbook, audited close/reopen, monthly summaries and snapshots | `routers/hishob.py` | Unchanged. Preview events cannot rewrite a closed day or any closing snapshot |
| Navigation, shared API and refresh | `mobile/App.tsx`, `src/api.ts`, `src/hooks.ts`, `src/screens/OwnerScreens.tsx` | Authorized pilot entry on home; API transport/cookie auth reused; interval configurable; 401/403 clears cached protected rows |
| New foundation | `backend/app/radiosoft.py`, `radiosoft_schemas.py`, `routers/radiosoft.py`, `mobile/src/radiosoft/screens.tsx` | Separate pilot state, synthetic contracts and UI |

Preview corrections are append-only events with actor, reason, server time, collection business date, source sequence and expected bill revision. They update the preview interpretation only, including when the corresponding manual day is closed. They do **not** reopen, amend, promote to, or reconcile that closed day. Accounting integration must extend the existing audited correction/reopen policy before it is enabled; this preview is not that extension.

## Evidence reviewed and polling decision

Reviewed the supplied `UPDATED-RADIOSOFT-HANDOFF.md`, schema JSON (columns/indexes, report definitions, change metadata and observations), redacted lifecycle examples, open questions and manifest. The package is inspection evidence, not an ordered change log.

* The persisted candidate sources are `Invoice` and `InvoiceDetails`. The verified bill PK is `(InvoiceNo, FYear, InvoiceType, FirmCode)`; namespace it by Hishob shop and source installation. Date is not part of the key. Keep FYear verbatim.
* `InvoiceDetails` has no verified unique line key. Canonicalize the complete line **multiset**, retaining duplicates and item-level salesperson references. A staff-only/item-only edit changes the snapshot digest; mere line order does not.
* No usable modified timestamp/rowversion/feed was established; CT/CDC were off. `Invoice1.Deleted` and `InvoiceDel` are not reliable cancellation feeds. Snapshot isolation is off, and some broad inspection queries timed out.
* One ordinary printed payable matched NetAmt; the report formula also refers to CardPayCharges. Nonzero charges/rounding/advance/coupon/loyalty cases need review. Exchange is already reflected in the sampled payable; do not subtract it again. No universal source money formula is claimed.

**Hishob page (implemented):** poll the backend every **10 seconds**, only while the page is focused and app/browser is active. Re-fetch on focus, app resume and connection recovery, and allow manual refresh. Requests use the existing 15-second timeout, no-store and authenticated transport; timed polling does not overlap a pending request. A transient error retains visible rows with a stale warning; an authorization failure clears them. Home checks pilot visibility every 15 seconds. This is backend refresh, not a SQL polling interval.

Use polling rather than a push channel for the initial foundation: source observation itself is periodic and unvalidated, so push adds connection infrastructure without proving source immediacy. No SSE/WebSocket or instantaneous change-detection claim is made.

**Future connector starting policy (not yet measured or implemented):** a configurable **30-second** recent-bill pass (initially 14 business days), bounded key pages, explicit columns and complete items, plus targeted rereads of known unpaid/reviewed/selected old bills. Attempt a rotating historical **content** sweep nightly with persisted page coverage, throttling and successful-completion timestamps. Benchmark query/page budgets on the actual approved installation before scheduling; do not promise a nightly sweep will finish. Never use only a new-number watermark or recent-date window. The 235k+ observed ledger and inspection timeouts rule out rapid full-ledger scans.

Each extraction must use approved SELECT-only reads, not NOLOCK, numbering stored procedures, vendor `isSynced` fields or print tables as the ledger. A header/items stable reread can reduce inconsistent observations but does not prove a vendor transaction/save boundary. A failed/timed-out/incomplete scan is not empty data. Even an entirely completed read-committed scan is not an atomic snapshot. Confirm absent keys independently and flag `MISSING_REVIEW`; do not assert cancellation without a vendor-confirmed lifecycle contract. No automatic deletion inference exists in this foundation.

Polling only observes retained states when revisited. Intermediate edits, create/delete between scans, edit/revert and same-key delete/recreate can be missed. Complete detection requires an appropriate vendor-supported durable change/tombstone feed with retention and coherent snapshots. Historical coverage remains explicitly **UNVALIDATED** in the API.

## Synthetic setup and pairing contract

For an interactive local walkthrough, use [RADIOSOFT-LOCAL-DEMO.md](RADIOSOFT-LOCAL-DEMO.md). The `backend/scripts/radiosoft_demo.py` helper prints local IDs and sends synthetic observations through the real pairing/ingestion endpoints. It is not a Windows connector. Its pairing/simulation workflow and remote-address rejection have two additional passing targeted tests.

The regular backend/mobile run guides apply. MongoDB remains the repository's normal dependency. No Windows or source access is needed for synthetic tests.

Default environment:

```dotenv
RADIOSOFT_SYNTHETIC_ENABLED=false
RADIOSOFT_PILOTS=[]
```

For an **isolated development/test database only**, create a synthetic owner and shop using normal Hishob onboarding. Set `APP_ENV=development` or `test`, enable the flag and configure the exact IDs:

```json
[{"shop_id":"SYNTHETIC_SHOP_ID","owner_id":"SYNTHETIC_OWNER_ID","source_id":"synthetic-installation","firm_codes":[0],"tracking_from":"2026-11-01"}]
```

Never substitute the actual Lalpotu IDs in this synthetic configuration. The backend checks the current shop creator, active owner membership and full configured source scope on every request. Settings cannot override the allowlist or bind a source by shop name. Editing an existing source/owner/firm/tracking boundary makes that configuration ineligible; migrations are deliberately not automatic.

The approved owner sees **RadioSoft pilot setup** on Home, enables PREVIEW, chooses manager grants, then creates a pairing code. Viewing, recording and correcting are separate grants; recording/correcting also require view. Bills & Collections appears only when preview and view permission are enabled. Backend permissions remain authoritative for direct URL/API calls.

All paths below are relative to `/api`. Regular user endpoints use the current session authentication (HttpOnly cookie and trusted-origin/custom-header protection on web; session bearer on native).

| Endpoint | Contract |
| --- | --- |
| `GET /shops/{shop}/radiosoft/status` | Eligibility, mode/revision, permissions, approved scope, source health/freshness; never credentials or hashes |
| `PUT …/settings` | `{revision, mode:"OFF"|"PREVIEW", manager_view, manager_collect, manager_correct}`; owner only, compare-and-swap revision |
| `POST …/pairing` | Owner creates 192-bit random, five-minute capability code; replaces any pending code; returns code once with expiry |
| `POST /radiosoft/connector/pair` | `{code, credential}`; caller generates and securely persists a random 256-bit base64url credential **before** exchange |
| `POST …/revoke` | Owner revokes credential and pending code; immediate for subsequent authenticated requests; history retained |

Pairing code and connector credential are stored only as SHA-256 hashes. High-entropy random secrets are required; these are not human passwords or shop IDs. Pair response returns v1, server-bound shop/source, generation, firms, types `[0,1]` and tracking boundary, never a credential. Retrying the same unexpired code with the same credential recovers a lost pairing response; a different credential cannot reuse a consumed code. Successful new pairing replaces the previous credential. Pair creation/setting changes/revocation are audited. Revocation does not retroactively cancel a request already authenticated and executing.

Connector ingestion/health require `Authorization: Bearer <connector credential>`; user-session tokens cannot substitute. No shop selector is accepted: connector query parameters and `X-Hishob-Shop` are rejected; unknown body fields are rejected. Shop/source/generation/firm are bound server-side. OFF clears credential/pairing/contact; re-enabling never restores a revoked secret. Re-pairing preserves the generation and stored sequence/history. Do not reset source identity, generation or sequence after restart/reinstall. Recovery of lost local sequencing requires explicit comparison with retained backend bill sequences before extraction resumes.

Use outbound HTTPS with certificate verification in the future deployed connector; HTTP loopback is only for synthetic local tests. Never place credentials/codes in URLs, logs, screenshots, ordinary settings or browser storage. Redact authorization and pairing bodies in infrastructure telemetry. Short-lived code expiry is server-enforced, independent of the displayed UI code. Foundation has no SQL password handling or live pairing endpoint.

## Observation and ledger contract

Machine-readable schema: [`radiosoft-observation.schema.json`](radiosoft-observation.schema.json). Executable definitions: `backend/app/radiosoft_schemas.py`; synthetic example: `backend/tests/fixtures/radiosoft-observation.json`. Set its generation from pairing and `observed_at` to the actual synthetic observation time. This fixture is not shop data.

`POST /radiosoft/connector/observations` accepts **one complete bill observation** per request:

* `version:1`, `synthetic:true`, approved `source_id`, server `generation`, and persisted integer `sequence` (1 through JS-safe integer maximum).
* `observed_at`: timezone-aware connector observation time, **not** a claimed source modified timestamp. More than five minutes in the future is rejected. Source time remains an unparsed raw string and business date remains a date.
* Full `key`, `business_date`, `mapping_version:"synthetic-net-v1"`, decimal-string `amounts`, and the full `lines` array. Maximum 200 lines; reject oversize bills, never truncate them. This narrow synthetic schema is not yet a certified RadioSoft extractor mapping.
* `source_status:CURRENT|MISSING_REVIEW|CANCELLED`; non-current test states require explicit `lifecycle_evidence`. Real cancellation/deletion mapping is unavailable.

Net amount uses Decimal, rounding half away from zero at the paise boundary (`ROUND_HALF_UP`), e.g. `1.005 → 101`, `4419.9921 → 441999`. Binary floating point is not used for money balances. Nonzero exceptional adjustments return null approved payable and `MAPPING_REVIEW`, blocking receipts. Exchange is retained separately, not deducted twice. Other unknown fields fail validation rather than being silently ignored. Source line salesperson references remain source references, not automatically matched to Hishob staff.

Full-key identity is deterministically hashed with shop/source/generation. A per-bill Mongo document holds current snapshot, retained changed versions, append-only collection actions and a revision. Source and cashier operations compete on that same revision; only one can win. Newer observations never replace collections. Lines are sorted for content digest while preserving multiplicity. Unchanged content advances observation sequence/freshness without adding a content revision, but still advances the concurrency revision.

A sequence is an ordering promise by the future connector, not proof of a RadioSoft event order. Assign it at durable observation capture, not delivery; maintain one ordered outbox per source. Same sequence and identical envelope retry returns the original acceptance time, with no write and no freshness reset. Older/conflicting sequence returns 409. After a 409, distinguish an already superseded outbox entry from a concurrent cashier conflict; do not mint a later sequence for old source data. Refetch current source state where necessary. Strictly ordered delivery avoids ambiguities for lost acknowledgements.

The connector must persist snapshot/outbox/sequence before HTTP, persist acknowledgements before removing outbox records, retry identical requests with bounded exponential backoff+jitter for transport/503 failures, and stop visibly for 401/403 or incompatible schema. Startup scans and installation-generation recovery are next-task responsibilities. Per-bill history has an 8 MB guard below Mongo's limit: reject further changes visibly, never truncate audit history. Operational archival beyond this bounded pilot is deferred.

`POST /radiosoft/connector/health`: `{status, pending_observations}` where status is `OK`, `SOURCE_UNAVAILABLE`, `SCHEMA_MISMATCH`, `SCAN_INCOMPLETE` or `OUTBOX_BLOCKED`. Heartbeat every 30 seconds is the next-task target. Contact older than 120 seconds means offline. Heartbeat never advances bill sync. `last_successful_sync` derives from the committed bill receipt, so there is no second acknowledgement write to lose; `last_source_observation` carries the extraction time. Either timestamp older than 120 seconds sets stale. Repeated unchanged scans should submit fresh observed snapshots/sequences; old queued delivery cannot make source data fresh. These are observation/delivery ages, not proof of complete coverage. Each bill also exposes its own observation timestamps.

## Collections, audit and comparison evidence

`GET …/bills?after=<cursor>&limit=50` is bounded to 100 rows, ordered by stable bill ID; returns next cursor, permission flags and freshness. `GET …/bills/{id}` returns versions, original events and effective receipts. All reads use the bound source/shop scope. There is no preview export or accounting-report integration.

`POST …/bills/{id}/collections` accepts:

```json
{"request_id":"cashier-request-unique-001","revision":1,"action":"RECEIVE","allocations":[{"method":"CASH","amount_paise":40000},{"method":"UPI","amount_paise":20000}]}
```

Actions are RECEIVE, MARK_PAID (no allocations: atomically takes current outstanding as UNSPECIFIED), RECLASSIFY (existing `collection_id`, complete replacement method allocations and reason) and REVERSE (existing `collection_id`, reason, no allocations). Reclassification only assigns known methods to a receipt containing unspecified money and must preserve its total. It is an event on the same receipt, not a second receipt. Reversal corrects a mistaken receipt; it is **not an actual cash refund**. Cash refunds and source-return ingestion are deferred; unknown return fields are rejected.

Request IDs are scoped to the bill and retained in its audit. Retry the same body, ID and revision. The same actor's identical retry is safe even after the bill changes; reuse with altered input conflicts. A concurrent cashier/source update returns 409 and requires refresh/review. Amounts are positive strict integer paise; a receipt cannot exceed outstanding. The page retains an uncertain request for an identical retry while mounted; after browser/app restart, refresh history before any new action. Durable client-side draft recovery across app restarts is not implemented.

Partial, cash, UPI, card and split payments are supported. UNSPECIFIED counts toward collected but none of the known-method totals. Recorded UPI/card is never bank verified. Paid bills retain money when source amounts rise/fall; excess stays negative outstanding with review. Missing/cancelled sources preserve all history and block new receipts. Reappearance retains history. Bills before `tracking_from` are historical review, never automatically collectible opening debt. Any historical opening or preview promotion needs a future explicit, replay-safe workflow.

`POST …/daily-evidence` records request ID, date, `scope:ALL_PILOT_COLLECTIONS`, source label, UPI/card paise, note, actor and timestamp. Repeated idempotency keys do not duplicate evidence. `GET …/daily-evidence/{date}` compares recorded effective receipt methods by **collection date**, not bill date, with the latest evidence for that scope. Earlier evidence remains audit history (response limit 100 with truncation flag). Multiple observations replace comparison evidence, never sum into receipts. Differences and unspecified amounts remain visible; `fully_reconciled` and `bank_verified` are always false. No per-bill allocation is inferred from a daily app total. Preview rollups can reflect later audited corrections; they are not closed accounting reports.

## Windows delivery requirements for the next task

This is the intended setup/runbook, **not installation instructions for an existing executable**:

1. Ship a separately versioned installer, Windows service and local setup/status app. Service uses Automatic (Delayed Start), recovery/restart policy and a dedicated restricted identity. Validate startup before user login, reboot, logout, upgrade and removal. UI may close without stopping synchronization.
2. Admin configures approved local SQL access. Application-admin login is not a SQL credential. The inspection session had sysadmin/db_owner; it is not suitable for the connector. Grant SELECT only on approved objects/columns; test denied DML, DDL and write procedures. Do not expose SQL or add inbound network rules. Validate driver, bitness and TLS compatibility on the inspected legacy SQL installation; do not assume modern ODBC is installed.
3. Setup UI asks for backend address, five-minute pairing code and approved local source connection. Show server-returned shop/source/firm scope for verification; it must not let users redirect a credential. Protect credential/outbox via DPAPI/service identity and restrictive ACLs. A service-owned durable outbox survives UI closure, outage and reboot.
4. Always-visible local status should distinguish service stopped, unpaired, source unavailable, backend unavailable, connected but stale, queued retries, scan incomplete, revoked and incompatible schema. Show last source observation, last acknowledged sync, queue depth and historical sweep completion. Provide safe retry/re-pair and redacted diagnostic export.
5. Validate normal operation with ChatGPT, VS Code, terminals and setup UI closed. Validate lost responses, power interruption between outbox/ack writes, network outage, revocation and credential rotation. Reinstall/restore must not silently reset identity or replay stale versions.

## Release, monitoring and rollback

Ship backend and mobile together with both flag and allowlist at defaults. No data migration touches existing accounting. Deploying this release does not enable a shop. Use isolated synthetic fixtures and tests first; production deployment/live pairing are separate explicit future steps.

Monitor authentication rejection rates, source/sequence conflicts, schema/amount review counts, per-bill history size, sync/observation ages, connector heartbeat, source-health state and future outbox/sweep progress. Correlate request IDs and bill IDs; never log codes, tokens, full bodies or personal source fields. Fleet dashboards, alert delivery and Windows monitoring are not implemented here.

Rollback: owner switches OFF or revokes the connector; global synthetic flag false also blocks all preview reads/writes. OFF clears credentials and pending pairing codes but preserves bill/evidence history. Remove the allowlist entry for an emergency scope stop. Re-enable only deliberately and re-pair; never truncate pilot ledgers to repair a fault. Application rollback requires no accounting reversal because no production totals were changed. Preserve the new collections/indexes for audit until an explicit retention decision. Requests already executing at revocation may finish; inspect the final revision.

## Validation and remaining gates

Run backend `pytest -q`, backend Ruff check/format, mobile typecheck/lint/format/i18n and Playwright workflow tests. The RadioSoft tests use a real isolated Mongo database and wholly synthetic bills, including a fresh API lifespan for restart recovery. The E2E-only approval helper is defined in `tests/serve_e2e.py`, not the application factory or production routes.

Tests cover default-off/production guard, ownership/tenants, source/generation/firm tampering, worker/manager grants, pairing expiry/one-use/lost response/revocation, duplicate/conflicting/out-of-order observations, API restart, concurrent cashiers and source edits, money rounding, split/partial/unspecified receipts, same-receipt classification/reversal, amount increases/reductions, synthetic cancellation/missing/reappearance, exchange non-duplication, full keys and line multisets, historical gating, queue-age freshness, evidence without double counting, and preservation of closed manual BILLING records through OFF/rollback. Real Windows crash recovery, network faults at SQL boundaries, complete edit/delete coverage and actual-shop correctness remain unvalidated.

Before live use, resolve `Hishob-RadioSoft-Updated-Handoff-2026-10-29/OPEN-QUESTIONS.md`: exact owner/shop/installation/firm mapping, collection start/opening policy, saved-header/complete-lines boundary, amount exceptions and return semantics, lifecycle/tombstone support and same-key reuse. Obtain approved non-production lifecycle examples, SELECT-only identity tests and source-load measurements. Do not turn inspection observations into guarantees.

### Completed verification — 1 November 2026

| Check | Final result |
| --- | --- |
| `cd backend && .venv/bin/pytest -q` | **205 passed** (includes 28 RadioSoft synthetic tests), 483.24 seconds |
| `cd mobile && npm run test:e2e` | **54 passed**, 7.4 minutes; includes the complete synthetic RadioSoft browser workflow and existing manual workflows |
| Backend `ruff check` and `ruff format --check` | Passed |
| Mobile `npm run typecheck`, `npm run lint`, `npm run format:check` | Passed |
| Mobile `npm run test:i18n` | Passed; 1,315 Hindi/Marathi messages |
| Mobile `npm run build:web` | Passed; web bundle and PWA shell exported locally, not deployed |
| `git diff --check` | Passed |
| Supplied evidence integrity | All five evidence files match SHA-256 values in the supplied manifest |

The tests used temporary isolated Mongo databases on loopback port 27018. No SQL Server, actual RadioSoft source, Windows service, live pairing or production accounting was tested or activated. The temporary Mongo process started for this task was stopped after verification. The existing README edit and handoff directory were not modified.
