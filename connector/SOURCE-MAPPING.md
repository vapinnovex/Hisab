# RadioSoft source and contract mapping — no real ingestion enabled

Evidence: `docs/radiosoft-source-evidence-2026-10-29/` (inspection timestamp 2026-10-29T14:37:39Z). This implementation reads the supplied metadata and redacted examples; it has not repeated live SQL discovery. The newly verified desktop OS/driver inventory matches that evidence.

## Source and identity

Reported RadioSoft from RnD Software Solutions: `D:\RadioSoft\RadioSoft.exe`; local `.\SQLEXPRESS`, `RsDB`, SQL Server 2008 R2 Express 10.50.4000.0 x64. Windows 11 Pro build 26100 x64 and SQL Server Native Client 10.0 (both bitnesses) are available. This build is x64, Python 3.12 + pyodbc for the local inspector; it does not require upgrading legacy SQL. ODBC Driver 18 is not installed and its legacy-server encryption compatibility is untested. SQL's and Windows' support lifecycles are separate from whether a test query can connect.

Earlier SQL read access used Windows integrated NTLM/shared memory with sysadmin/db_owner. RadioSoft's application-admin login is separate from that authentication and is never reused. A future administrator must provision a dedicated Windows/service identity and database user, with CONNECT and SELECT only on approved Invoice, InvoiceDetails, narrow Salesman columns and any separately approved lifecycle views. Do not grant sysadmin/db_owner/db_datawriter/db_ddladmin, broad db_datareader, write/DDL/EXECUTE permissions or access to customer/authentication tables. Verify effective permissions with metadata and a non-production test database. Do not test write denial by attempting destructive live writes. This package never creates permissions/users or exposes SQL/network ports.

The local opener accepts only a named local instance, allowlisted driver, simple database name and Windows integrated authentication. It refuses elevated server/database roles or unknown role checks, non-read database permissions, and approved objects without SELECT or with additional non-read rights. These metadata checks are defense in depth, **not a complete audit of every permission/inheritance path in the database**; administrator-reviewed effective grants remain required. The separate local inspector is intentionally not a service-account impersonation mechanism. Run it under the restricted identity; the current overprivileged identity will be refused.

## Source bill and money

Candidate bill ledger: Invoice + InvoiceDetails. Full key `(InvoiceNo,FYear,InvoiceType,FirmCode)` is retained; date is not a key and FYear is not normalized. Types 0/1 are candidate source series, not payment methods. Firm 0 was observed; deployment scope still requires owner/vendor approval. Type -1/invoice 0 remains excluded. Invoice1/InvoiceDetails1 are print working tables. InvoiceDel contains coexisting historical versions; it is not a proven deletion feed. No tender flag is required for extraction.

Explicit header fields preserve NetAmt, TotalAmt, source discounts, GST/IGST, rounding, exchange, advance, coupon/loyalty and CardPayCharges observations. Item fields preserve quantity/rate/MRP, Amount/NetAmt, GST and salesperson references for later validation. No universal amount formula, per-item discount allocation, commission split or Hishob adjustment is invented. One ordinary printed bill matched NetAmt; exceptional charge/rounding/advance/discount cases still require before/after vendor examples. Exchange was already reflected in the sampled payable and must not be deducted again.

The v1 backend accepts only `synthetic-net-v1` decimal-string fields. The local snapshot is a **different type**, tagged `REAL_LOCAL_ONLY`, upload-ineligible and mapping `UNVALIDATED`. It does not silently quantize source SQL real values to fit the schema. Conversion/range approval for real values belongs in a later reviewed mapper. More than 200 item rows stops with an explicit oversize result; no truncation. Unknown finalization boundaries and incomplete item saves stop/review. Two matching reads only establish momentary stability, never finality.

## Salespeople: assigned number and display name

The evidence identifies `dbo.Salesman.SLNo` (int PK) and `SLName` (nvarchar). `InvoiceDetails.SLNo` is the proven item reference. The local reader fetches only the number/name; no address, telephone, birthday, salary, fingerprint or commission data. There is no FirmCode in this lookup, so directory identity is source-installation-scoped; do not merge people between installations based on equal number or name. StopMark/SLTypeID semantics and active/inactive filtering remain unknown.

Each item retains `salesperson_ref` as the source number string and `salesperson_name` when resolved. Zero/null is explicitly an unverified sentinel/unassigned case. Missing/blank lookup retains the number and blank name with an unresolved status. `Invoice.UserID` remains billing operator; Hishob's authenticated actor remains collector. Header SLNo/ESLNo and item HLNo are kept distinct, with unverified roles. No Hishob membership/account is created by this connector.

Multiple people on a bill are retained per item. Header payable is read once, never multiplied by a join. Complete selected item multisets preserve duplicate rows. Item, salesperson reference and lookup-name changes alter the local content digest; reordering identical lines does not. Future source-worker filters/analytics must not sum the same full bill once per person.

**Backend gap:** v1 observations already accept per-item reference/name, and the November 2 bills API/UI derives source-worker choices from observed items. There is no standalone directory upload endpoint. Local directory extraction is implemented, and synthetic numbered attribution is API-tested, but a complete RadioSoft staff directory (including people without bills) cannot yet appear in Hishob. A later contract must explicitly support that need. Extra source monetary/item identifiers are also not accepted by v1; they remain local evidence, not silently added JSON fields.

## Local reconciliation primitives and limits

`Reader` has parameterized full-key reads, date-scoped keyset pages (25/50 rows, hard max100), 201-row overflow detection, schema checking, a 50ms inter-query throttle, query timing diagnostics and a 10-second ODBC query timeout. No NOLOCK, numbering procedure, sync-field write, change-tracking enablement or cross-header join is used. Metadata and full-key reads must still be benchmarked with the shop's vendor-approved identity during a quiet window. No performance figures for live SQL are claimed.

`LocalReconciler` is an opt-in, local-only library, **not an enabled production scheduler**. It persists encrypted keys/content digests/page checkpoints in a separate directory; no amounts, names or item history. It includes recent-date passes, explicit older targets, resumable wider content passes and independent known-key checks. One step performs one bounded page or full-bill inspection; query failures retain pending work and mark incomplete coverage with backoff. Its initial serialized scan schedule is unbenchmarked: a large wider pass can delay recent passes. Fair scheduling, operator-visible progress and measured budgets remain live-service gates; do not claim the report's proposed polling intervals are achieved by this local library.

Only successful empty full-key queries can create absence candidates. A later independent absent read at least 30 seconds apart yields `MISSING_OR_DATE_MOVED_REVIEW_ONLY`, never cancellation/refund. A failed query is not an empty result. Known keys and scan checkpoints survive local-inspector restart; scope changes are refused. The synthetic service has its own independent outbox/checkpoints and never opens this journal.

No reliable source modified timestamp, rowversion, durable change/deletion feed or coherent save boundary was established. Even a completed wider scan cannot prove every edit/deletion: between-scan create/delete, edit/revert, same-key replacement and incomplete source transactions can be invisible. Missing rows can also reflect changed dates/scope. Invoice number reuse across years/types/firms is handled by the full key; **same full key reuse within one source generation remains unresolved**. A database restore/replacement needs an explicit generation/continuity decision.

The smallest robust vendor-supported solution is a supported API/export or durable change/tombstone feed covering headers, items, attribution and cancellation with full keys, coherent versions and adequate offline retention. Vendor-approved CT on headers/children could aid eventual current-state convergence within retention, but cannot recover every intermediate event. No such capability was enabled here.

Returns are not implemented as ingestion: supplied evidence shows SalesReturn/SalesReturnDetails and uncertain links/amount behavior requiring further examples. A return document, cancelled sale or missing row is never proof of a refund. Collections, SETTLE/NOTE/CREDIT and audited waivers remain Hishob-owned and are never created or overwritten by the connector.

## Gates for a separately reviewed Lalpotu live preview

1. Approved exact owner/shop/source installation, firm/type/date scope, source-generation/reset policy and SELECT-only identity; effective permissions and driver test locally without uploads.
2. Vendor-confirmed save boundary, amount exceptions, return links and lifecycle semantics; non-production before/after cases. No live test sales.
3. Measured bounded query cost and scheduling/backoff budget; verified incomplete/missing handling, older-content reconciliation and documented limits of event coverage.
4. Separately reviewed real-observation contract/mapper and real-ingestion backend release; per-item number/name support plus decision on a full salesperson-directory endpoint. Current `synthetic: false` and ACCOUNTING guards stay unchanged.
5. Authorized TLS endpoint, certificate verification, secure service identity, signed release, ACL testing under actual LocalService SID, clean-machine install/start-before-login, logout/reboot, outage, crash, disk-full, upgrade/reinstall and revocation tests. No shop-PC reboot without coordination.
6. Approved shadow comparison and explicit authorization before any real records leave the PC. Accounting/commissions remain separate projects.
