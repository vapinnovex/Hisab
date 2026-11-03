# Proposed Lalpotu HTTPS sync implementation

2 November 2026. Planning only: no production enablement, deployment, SQL change or real upload is part of this integration. The existing v1 synthetic schema, loopback-only transport, production guard and separate local reader remain intact. Salesperson summaries, commissions, full-directory upload and accounting activation are deferred.

## 1. Make authorization and scope explicit on the server

Create a separate, disabled-by-default real-preview configuration and endpoint family. Do not broaden `radiosoft_synthetic_enabled`, change `Observation.synthetic`, or relabel a `REAL_LOCAL_ONLY` snapshot. A new versioned contract must honestly identify real provenance and a validated mapping version.

The server configuration must contain the exact approved Lalpotu **owner ID, shop ID, source-installation ID, source database/generation identity, firm codes, invoice types, tracking/cutover date and mapping version**. Retrieve and review the explicitly configured identifiers with the owner; this review did not read production configuration. No ID is inferred from the name “Lalpotu”, a client shop selector, an invoice number or the inspection's example FirmCode 0. Missing, conflicting or changed configuration must fail closed. Confirm which historical bills are review-only so old paid bills do not become new collectible debt.

Use the existing pairing design as a starting point: an authenticated active owner of that exact allowlisted shop requests a short-lived, single-use pairing code. The connector persists a newly generated random proof in DPAPI **before** exchange. The server atomically claims the code and returns its authoritative shop/source/generation/firm/type/cutover/mapping binding. Same-proof retries recover a lost reply; a different proof cannot take over the code. Scope comes only from the credential, never a request header, query parameter or upload field. A client can display/verify the returned binding, not choose another shop. Require a reviewed association between the authorized source identity and the actual local database; a locally entered source label is not proof of installation identity.

Add expiry, throttling, audit, revocation and rotation tests. Revalidate owner membership, explicit deployment scope and credential status on each write. Stop on revoked credentials or scope drift. Define what happens to old generations and their existing collections before introducing resets: current bill IDs include generation, so silently minting a new generation could create apparent duplicates and hide prior collection history.

**Acceptance:** two shops with the same display name/source label and the same full bill key stay isolated; an unallowlisted shop, manager, foreign credential, altered source/firm/generation or changed owner cannot pair or ingest. No real production activation accompanies this code phase.

## 2. Define and test a real observation mapper before connecting it to delivery

Create an explicitly separate real observation type/mapper and isolated staging tests. Preserve `(InvoiceNo, FYear, InvoiceType, FirmCode)` verbatim where appropriate, source business date and raw source time. Header value is recorded once. Preserve every selected item, duplicate rows, item salesperson number and resolved display name. Use `InvoiceDetails.SLNo → Salesman.SLNo/SLName`; unresolved references retain the number and blank/unresolved name. `Invoice.UserID` stays a billing operator, and Hishob's collection actor remains separate. No automatic staff-account matching by name/number across sources.

Require reviewed examples for NetAmt, charges, rounding, exchange, advance, coupon/loyalty, taxes and returns. Define decimal precision, rounding, range and oversize handling explicitly. Do not recompute totals from modern catalogue prices, sum header totals after item joins, or deduct an exchange/return twice. Unvalidated monetary cases remain review-only and cannot become collectible by a fallback formula. Directory entries without observed bills need a later endpoint if required.

Source updates may only change the source snapshot/version/lifecycle review state. They must preserve Hishob receipts, method reclassification/reversal, SETTLE, NOTE, CREDIT and audited waivers. RadioSoft tenders/payment fields cannot establish a collection; missing/cancelled/returned bills cannot establish refunds. Keep real-preview accounting isolated until a separately reviewed accounting design exists.

**Acceptance:** source amount up/down, salesperson-only and name-only changes, multiple people, duplicated/reordered items, missing lookup, historical bills and lifecycle review all retain collection events exactly and count each header once.

## 3. Implement an independently tested HTTPS transport and continuity protocol

Use an exact configured HTTPS origin with normal certificate and hostname verification, bounded requests/responses/timeouts and no redirects, environment proxies or arbitrary origin selection. Bind the origin into protected state with the pairing identity. Test certificates, wrong host, expiration, redirect, unavailable server and response-size limits against an isolated TLS server with an explicit test CA. Never set `verify=False` or add a production HTTP fallback. Keep this release's `local_api()` unchanged.

Retain encrypted transactional capture, global durable sequencing, exact serialized retry bytes, ordered queue heads and acknowledgement transactions. Validate acknowledgements against the expected sequence and full bound bill identity. Use bounded retry/backpressure for network errors/408/429/5xx, visibly stop on authorization/schema/binding failures, and never skip a rejected head or mint a new sequence to bypass conflict. Heartbeats must not advance source freshness.

Design a server-authorized recovery handshake before allowing reinstall/database restore or machine migration: fence the previous sender, compare durable accepted sequence/digests, resolve uncertain deliveries, and explicitly preserve/reconcile existing bill identities and collections. A new pairing code alone cannot reconstruct a lost queue. No automatic state deletion, sequence reset, stale-backup restore or generation change is a recovery procedure.

**Acceptance:** dropped pairing/acceptance responses, concurrent collection edits, crashes before/after commit, queue full, stale backups, duplicate workers, rotation/revocation and two-source tampering converge or stop without loss/duplication. No real data leaves the PC during these tests.

## 4. Validate source access and reconciliation locally

Have the administrator/vendor provision the dedicated identity and narrowly reviewed SELECT permissions. Review effective server/database/object/column/inherited grants, denied writes/DDL/EXECUTE and lack of access to credentials/customer fields. Verify denial using a non-production database, not attempted writes to live RadioSoft. The current metadata preflight is defense in depth, not a complete authorization audit; column-only grants also need compatibility work because it currently requires object-level SELECT.

Measure installed x64 ODBC/legacy SQL compatibility, timeouts, schema drift and bounded read cost under the actual service identity. Obtain vendor evidence for committed header/item save boundaries, old-bill edits, deletes, restores, rekeys, same-key reuse and return links. Prefer a durable vendor change/tombstone feed with coherent versions and adequate retention. Do not enable CT/CDC or add source columns/triggers without a separate vendor-approved task.

If only polling is available, implement fair recent/historical/known-key scheduling with durable scan scope/completion checkpoints and measured load limits. Failed/partial scans are never empty successful results. Two absent reads establish a review candidate, not cancellation. Record coverage limits explicitly: polling cannot guarantee intermediate edit/revert or create/delete events. Keep unknown lifecycle outcomes under review and preserve Hishob collections.

## 5. Complete Windows qualification, then seek explicit shadow-sync authorization

First harden the installer package inventory/reparse/ACL checks identified in [the integration review](CONNECTOR-INTEGRATION-REVIEW.md). In an authorized disposable Windows VM, validate clean install, actual LocalService SID and DPAPI access, another user's access denial, start before login, GUI closure, logout/reboot, SCM recovery, disk-full/corrupt state, upgrade/rollback of binaries, same-version reinstall and uninstall that retains state. Validate a signed release and independently distributed hashes. Never perform these tests by rebooting or installing on the shop PC without coordination.

Only after gates 1–4 and Windows qualification, prepare a concrete owner-reviewable shadow pilot: exact Lalpotu binding, trusted HTTPS origin, validated mapping cases, read budgets, cutover policy, monitoring, duration and stop/revoke procedure. Obtain explicit approval before installing or allowing real records off the PC. Compare approved existing bills in shadow mode first. Production syncing and accounting remain separate release decisions.

The next implementation slice is **the disabled real-preview server contract, explicit scope configuration and pairing/isolation tests**, followed by mapper tests and a local HTTPS harness. It should not connect the reader to an uploader or alter this synthetic release's guards.
