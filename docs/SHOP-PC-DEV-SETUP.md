# RadioSoft real-data DEV pilot setup

4 November 2026. Repository implementation, **not a deployment or Windows qualification report**.
Base revision: `7e3737e50434b8802f8bab89cf705357db9ca1ff` plus this working-tree change set. Preserve the pre-existing `backend/scripts/radiosoft_demo.py`, `mobile/.env.example` edits and `PC.md`. Do not build the base revision alone: commit/review this change set and record the resulting full SHA in the release manifest. Builds record `source_revision` and `source_dirty`; qualify only a clean reviewed checkout. The accompanying `docs/dev/radiosoft-real-reviewed-files.json` records SHA-256 hashes of the reviewed changed files against this base; verify those hashes before building the resulting commit. No package was built or executed on Windows during this task.

## Deployment and migration

Deploy backend and mobile from the same reviewed revision to DEV only. Keep existing DEV Mongo/JWT/email/CORS values. Do not copy production secrets or change production settings.

```dotenv
APP_ENV=development
RADIOSOFT_REAL_ENABLED=true
RADIOSOFT_REAL_PILOTS=[{"shop_id":"14559e70-f9b0-40fd-8bfe-34aea0745f43","owner_id":"ef2f1849-4f09-4807-9d46-551b1463dcdf","source_id":"<approved-PC-installation-id>","generation":"<approved-RsDB-generation-id>","database":"RsDB","firm_codes":[0],"invoice_types":[0,1],"tracking_from":"<owner-approved-YYYY-MM-DD>","capture_from":"<approved-YYYY-MM-DD>","capture_until":"<approved-exclusive-YYYY-MM-DD>","mapping_version":"real-display-v1"}]
```

The placeholders are deliberate required setup inputs, not deployable values. The owner has not supplied a tracking date, capture bounds, installation ID or database-generation ID. Do not infer them from bill dates or silently generate a new generation on reinstall. `capture_from <= tracking_from < capture_until`. Firm 0/types 0,1 remain proposed until explicitly confirmed. Backend origin is exactly `https://hishob-dev.onrender.com`; the client binds this origin in DPAPI-protected state and accepts HTTPS only. Existing synthetic settings remain independent; real enablement does not alter them. Production refuses real enablement during Settings validation and on every route.

No destructive migration, SQL mutation or backfill. Backend startup creates new collections/indexes:

- `radiosoft_real_integrations`: unique sparse credential and pairing hashes, approved binding, stream fence, audit, health.
- `radiosoft_real_inbox`: immutable envelope per source/generation/sequence, durable acceptance receipt; `_id` supplies uniqueness.
- `radiosoft_real_bills`: source-scoped key, source versions, frozen attribution; separate `events`/`settlements` retained on updates. Scope/date indexes.
- `radiosoft_real_people`: installation-scoped directory, worker-membership mapping and revisioned audit. Scope index.

Existing synthetic bills/collections, customer dues and cashbook are untouched. Stop on index creation errors; do not drop collections to fix them. Real-preview writes require majority acknowledgement and journal durability. Mongo single-document atomic operations plus a durable stream fence support standalone Mongo; no replica-set migration is required. Keep inbox/history for pilot audit; no automatic destructive retention.

## Account and narrow SQL provisioning (administrator, separately authorized)

1. Create a dedicated local non-administrator Windows account, e.g. `<SHOP-PC>\HishobDevReader`. Give it **Log on as a service** through Local Security Policy. Review nested groups; it must not inherit Administrators, any privileged SQL group, database ownership or broad roles. Set a managed password outside scripts/chat/config and coordinate password rotation with SCM.
2. On `.\SQLEXPRESS`, create a Windows login for that exact account, a mapped user in `RsDB`, CONNECT SQL/CONNECT as needed, and only the column SELECT grants below. Do not use LocalService, RadioSoft's application login, inspection sysadmin, `db_datareader` or SQL passwords.
3. Review effective inherited/public/server/database/object/column permissions. No INSERT/UPDATE/DELETE/ALTER/CONTROL/IMPERSONATE, ownership, write procedure EXECUTE or administrative roles. Do not execute live write-denial probes. Validate denials in an agreed disposable database.
4. Grant only object-scoped metadata visibility if INFORMATION_SCHEMA requires it; no server-state or database-wide metadata grants merely to satisfy a checker. The reader now checks each required column with `HAS_PERMS_BY_NAME` and does not require object-wide SELECT. Preflight is defense in depth, not an inheritance/security audit.

Example DBA script (replace the account identifier, review before execution; **not executed by this task**):

```sql
USE [master];
CREATE LOGIN [SHOP-PC\HishobDevReader] FROM WINDOWS;
USE [RsDB];
CREATE USER [HishobDevReader] FOR LOGIN [SHOP-PC\HishobDevReader];
GRANT CONNECT TO [HishobDevReader];
GRANT SELECT (InvoiceNo,FYear,InvoiceType,FirmCode,InvoiceDate,Time,TotalAmt,DiscAmt,IDisc,GSTAmt,IGSTAmt,TaxAdditional,NetAmt,RoundAmt,ExchangeAmt,AdvAmt,CoupenDisc,LPDiscAmt,CardPayCharges,SLNo,ESLNo,UserID) ON OBJECT::dbo.Invoice TO [HishobDevReader];
GRANT SELECT (InvoiceNo,FYear,InvoiceType,FirmCode,InvoiceDate,Num,SrNo,BarCodeID,ItemName,Qty,Mrp,SaleRate,Amount,GST,GSTAmt,IGSTAmt,NetAmt,SLNo,HLNo) ON OBJECT::dbo.InvoiceDetails TO [HishobDevReader];
GRANT SELECT (SLNo,SLName) ON OBJECT::dbo.Salesman TO [HishobDevReader];
```

Connection is fixed to local `.\SQLEXPRESS` / `RsDB`, Windows integrated authentication and x64 SQL Server Native Client 10.0. No inbound SQL firewall exception, remote SQL endpoint, vendor procedure or schema modification is needed. The read-only connection hint is not authorization.

## Build and qualification on disposable Windows x64

Use Python 3.12 x64. From the clean reviewed checkout:

```powershell
py -3.12 -m venv .connector-build
$python = (Resolve-Path .connector-build\Scripts\python.exe).Path
& $python -m pip install -r connector\windows\requirements-build.lock
& $python -m pip install -e 'connector[test,local-probe]'
& $python -m pytest -c connector\pyproject.toml connector\tests -q -ra
.\connector\windows\Build-Release.ps1 -Python $python -RealDev
```

Mongo-backed tests require an isolated test Mongo URI via `CONNECTOR_TEST_MONGODB_URI`; do not point them at DEV or production. Backend requirements are also required for API contract/integration tests. Explicitly document skipped tests. Run PowerShell parser checks for **all** install/build/verification scripts. The default build without `-RealDev` remains synthetic. New artifact folder is `HishobConnector-0.1.0-real-dev-windows-x64`; executable `HishobConnectorDev\HishobConnectorDev.exe`. Distribute an independently reviewed manifest hash; sign the executable/package before trust-sensitive distribution. Internal hashes alone do not authenticate the publisher.

Qualify under the actual dedicated identity: driver loading, column-only grants/schema visibility, bounded query timing, DPAPI decrypt after administrator initialization, and no state/binary access by ordinary users or unrelated service accounts. Installer resets inherited/explicit child ACLs, rejects unexpected payload files/duplicate unsafe paths/reparse components and verifies staged payload before execution. Machine-scope DPAPI relies on the restricted ACL; local administrators remain trusted.

Test install failure recovery, SCM start/stop/restart, delayed network, logout/reboot, two workers, kill during queue/ack commits, disk full/corrupt state, clean same-version staging, binary upgrade preserving queue bytes, and uninstall retention. A new generation or empty directory is **not** recovery from lost or stale state. Server continuity rejects skipped/newly reused sequences; no automated restore/migration endpoint exists. Stop and preserve state if recovery is required.

## Owner setup and pairing

1. Deploy DEV settings with approved nonsecret IDs/dates. Sign in to DEV as the supplied owner. Open **Dashboard → Live RadioSoft bills & collections (DEV)**, then open **Connection settings**. The server verifies `shops.created_by` **and active OWNER membership**, and exact configured owner/shop/source/generation/scope on setup and each subsequent access. This is where the supplied ownership is verified; it has not been verified against live DEV in this task.
2. Read the displayed source, generation, firms/types and tracking/capture dates. Confirm association with the actual qualified local database. The server cannot cryptographically identify an arbitrary legacy SQL database: this local-to-server association is an explicit administrator/owner attestation. Tick confirmation; optionally delegate manager view/mapping/collection; choose **Confirm DEV setup**. Collection records are stored in the separate `radiosoft_real_collections` DEV register, never written to RadioSoft and never posted to Hishob cashbook/galla or customer dues. Full/partial receipts use the explicitly entered method; “mark paid” records an unspecified method. Only positive, unchanged bills on/after `tracking_from` are eligible. Source edits require review; previous collection history is retained and is never silently adjusted.
3. Save a local **nonsecret** `binding.json` matching the server binding. It contains all fields from `scope`, plus `version:2`, `synthetic_only:false`, `next_action:"SEND_REAL_REVIEW_OBSERVATIONS"`. The owner screen’s **Show nonsecret PC binding** button displays this JSON for copying. It must exactly match the response from `/api/radiosoft/real-connector/pair`; do not put a pairing code or credential in it. Setup UI displays scope; an authorized operator can use the authenticated status response to export it.
4. On Windows, elevated PowerShell, install **stopped**:

```powershell
$reader = Get-Credential "$env:COMPUTERNAME\HishobDevReader"
.\Install-DevService.ps1 -ServiceCredential $reader
$exe = "$env:ProgramFiles\HishobConnectorDev\0.1.0\HishobConnectorDev\HishobConnectorDev.exe"
& $exe configure --binding .\binding.json --origin https://hishob-dev.onrender.com
& $exe pair
```

5. In owner UI choose **Create five-minute pairing code**, enter it at the hidden console prompt. Codes expire after five minutes, creation is rate-limited to once per 30 seconds; one proof claims a code. The client saves random proof before exchange, including retries after a lost response. Never pass secrets on command line. Start `HishobRadioSoftDev` only after qualification and authorization for the real display pilot. Pairing/delivery run under that account:

```powershell
Start-Service HishobRadioSoftDev
& $exe status
```

The returned binding must exactly match the locally confirmed file; changes stop pairing. Changing origin, installation or generation requires reviewed recovery, not a fresh queue. Re-pairing/rotation preserves sequence and pending envelopes. If a pending code has expired or a pairing response was incompatible, stop the service, run `& $exe cancel-pair`, obtain a fresh owner code and run `& $exe pair`; this preserves all queued observations and sequence state and does not restore use of an old credential. Revoke fences credentials; creating a new code does not reset stream state.

## Verify the pilot

- Confirm queue drains and last successful **source read**, last delivery and contact are distinct. Heartbeats never make source data fresh. A Render sleep/outage must retain exact encrypted queued bytes and retry with backoff; authorization/schema/ack conflicts visibly stop delivery without skipping a head.
- Compare approved sample full keys `(InvoiceNo,FYear,InvoiceType,FirmCode)`, header payable once, complete duplicate item rows and item SLNo/name. `SLNo=0` resolves normally. NULL is absent; missing lookup remains unresolved. Directory reads include people without bills and do not claim activity status.
- Confirm negative `NetAmt=-61` displays signed payable -61, ₹61 owed to customer, **UNSETTLED**, without a refund/credit/receipt/debt. Zero remains ineligible. A positive in-period unchanged bill can receive a Hishob DEV test collection; this does not assert a RadioSoft payment or update its customer balance. Exchange already affects NetAmt and is never subtracted again.
- Source edits retain the separate collection register and source versions. Changes after a receipt require review; new collection actions are blocked for changed bills. No action writes to the RadioSoft SQL database.
- Map only to an existing active worker membership. No name matching, user/login creation or membership grant occurs. Mapping requires owner or explicitly delegated manager permission; optimistic revision prevents lost updates. Audit records actor, old/new worker and reason. Mappings apply only on a bill's **first observation**. Already imported/unmapped bills and newly appearing references on an existing bill stay historically unmapped; no backfill/reassignment UI exists.
- Worker reporting returns only that authenticated worker's frozen-attribution item rows. Managers need delegated view; owners may view all. Duplicate item rows remain separate. Header adjustments appear once per bill for managers/owners, never repeated into item sales. Collections are excluded from worker reports; no exact net-sales total is published. Workers do not receive whole bills, other workers' lines or customer-liability totals.
- Poller prioritizes the PC's current local business date in a recent pass, separately from bounded historical day/key pages, and reads up to five bill keys per minute; each query has timeout/throttle. The header and items are reread, but stability does not prove final save or transaction coherence. Capture bounds are explicit/exclusive. The state exposes cursors and no complete-history claim. Unstable/partial/failed pages retain their cursor, do not infer deletion and do not stop delivery of already queued records. Large/invalid structural cases require operator review; negative/zero bills are expected accepted cases. Benchmark CPU/query load on the legacy server before unattended use.

## Stop, revoke and recovery

Use owner UI **Stop and revoke DEV connector**, then `Stop-Service HishobRadioSoftDev`. Revocation disables upload immediately on subsequent authentication; an already-authorized in-flight request may finish. Stop local service first if an absolute read stop is required. For retirement, after confirming revocation, `sc.exe delete HishobRadioSoftDev` removes SCM registration only. Retain ProgramData state/DPAPI anchor/outbox and audit until reviewed retention approval. Do not use the synthetic uninstall script for the real service. Do not delete queues, overwrite state from stale backup or change generation to bypass conflicts. Remove SQL grants/login and Windows account only through the authorized administrator after retirement review.

## Remaining blockers and unavailable features

Windows executable build, PowerShell execution, signing, SCM/ACL/DPAPI identity qualification, restricted pyodbc/SQL performance, actual DEV ownership check/deployment and actual sample comparison remain unperformed here. RadioSoft final-save/cancellation/deletion/return lifecycle and restore semantics are unverified. Polling cannot guarantee every intermediate event. Production enablement is unavailable.

Refund/store-credit issuance/redemption/accounting are deliberately unavailable. See [settlement and attribution rules](RADIOSOFT-REAL-BUSINESS-RULES.md) for the required journal, authorization and accounting gates. Source sync and directory/mapping/item reporting can be qualified as a display-only DEV pilot independently of those financial features.

Each real capture cycle also stops before issuing another query after 100 reader queries or 20 elapsed seconds (one in-flight query can add its 10-second timeout). An exhausted budget is an incomplete page, not a deletion or successful full scan. Dense/problematic pages can remain pending and need source/performance review; this limit is not evidence of complete historical coverage.
