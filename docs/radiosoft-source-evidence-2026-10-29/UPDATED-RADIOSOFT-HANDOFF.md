# Updated RadioSoft handoff — Hishob owns collections

Inspection: **29 October 2026**, Asia/Kolkata (UTC+05:30). Exact start/end UTC timestamps and file hashes are in `MANIFEST.json`. Scope: read-only discovery on the shop PC, existing document/template inspection, and a small redacted evidence export. No connector was implemented/installed. No RadioSoft business records, schema, users, settings, Change Tracking, network exposure or test sales were changed. No database backup or database files are included.

**This document supersedes the payment-authority and payment-import recommendations in the 27 October handoff.** RadioSoft owns bill identities, source amounts, items, salesperson attribution and source lifecycle. Hishob owns actual collection events, including method-unspecified paid acknowledgements. RadioSoft cash/card/tender/receipt fields MUST NOT create Hishob collections or prove money was collected.

## 1. Findings and their confidence

| Finding | Evidence | Confidence / limit |
|---|---|---|
| Local source is RnD RadioSoft, `RsDB` on `.\SQLEXPRESS` | Executable metadata, running processes, successful SELECTs, attached file metadata | Confirmed at inspection |
| Bill key is `(InvoiceNo,FYear,InvoiceType,FirmCode)` | `PK_Invoice` metadata; observed repeated bill number in different years | Confirmed; namespace additionally by source installation and Hishob shop |
| Type 0 = source cash-sale series; type 1 = source credit-sale series | `Salesreg.rpt` selection and `GetCashInvoiceNo`/`GetCreditInvoiceNo` definitions | Confirmed source series meanings; neither implies a Hishob collection status |
| Main saved sales live in Invoice + InvoiceDetails | Sales register uses Invoice; numbering procedures reference Invoice; current rows/items and existing printed bill agree | Strong evidence; exact atomic save/draft behavior still needs vendor confirmation |
| Invoice1/InvoiceDetails1 feed printing | `SalesBill`, `Sales`, `SalesView`, report references and PrintDate | Demonstrated print role; complete refresh/retention lifecycle unknown |
| Invoice1.Deleted is not a reliable business cancellation flag | All 221 flagged rows in the inspected set also existed in Invoice | Demonstrated counterexample |
| InvoiceDel is not a list of only currently cancelled/deleted bills | 75,763 of 75,767 rows matched current Invoice keys; many amounts differ | Demonstrated coexistence; full edit/renumber/archive lifecycle unknown |
| Actual salesperson attribution can be per item | Sample bill with two different InvoiceDetails.SLNo references and header SLNo=0 | Demonstrated |
| NetAmt agrees with printed payable in the verified PDF | OBS-PRINT: 1,199.00 printed and stored | Demonstrated for one printed document; exceptions noted below |
| Returns are separate source documents with original-sale references on lines | SalesReturn + SalesReturnDetails + QSalesReturn definition; observed original bill still exists | Demonstrated coexistence/linkage; no before/after proof that original never changes |
| No usable complete change feed was established | No rowversion columns found; CT/CDC off; no triggers on inspected tables; no modified field in bill tables | Confirmed inspected metadata; cannot guarantee every lifecycle event with polling |

## 2. Installation, operating system and authentication

- Application: `D:\RadioSoft\RadioSoft.exe`; product/file version metadata `1.00`; publisher string identifies **RnD Software Solutions**. Two RadioSoft processes/windows were present. This coarse file version should not be assumed to be a full vendor release identifier.
- OS: **Microsoft Windows 11 Pro**, `10.0.26100`, 64-bit.
- SQL: **10.50.4000.0**, **Express Edition with Advanced Services (64-bit)**; database compatibility level **100**.
- Instance/database: `.\SQLEXPRESS` / `RsDB`. The attached files were confirmed as `D:\RadioSoft\RsDB.mdf` and `D:\RadioSoft\RsDB_1.ldf`. Files were not copied or opened as database files.
- Installed SQL ODBC drivers: **SQL Server** and **SQL Server Native Client 10.0**, each in both 32-bit and 64-bit variants. No modern Microsoft ODBC Driver 17/18 appeared in that enumeration. These are availability findings, not a deployment certification.
- Inspection used .NET `System.Data.SqlClient`, `Integrated Security=True`, local shared-memory transport. SQL reported `auth_scheme=NTLM`. No SQL password was supplied or extracted.
- The current Windows-authenticated session has **sysadmin** and **db_owner** privileges and can view definitions. It was used only for SELECT/metadata reads. This is NOT evidence that a restricted future connector identity is already configured.
- SQL permits mixed authentication (`IsIntegratedSecurityOnly=0`). The application's actual SQL connection credential/mode was not inspected. No config credentials, password values, hashes, OTPs or tokens were retrieved.
- RadioSoft has an application `Users` table with application UserID/UserType and a Password column (metadata only inspected). Successful SQL access came from Windows authentication without using a RadioSoft UI login. Thus application authorization and SQL connection authorization are separate layers. This does not prove the exact login implementation inside RadioSoft or how its shared connection is configured.

### What an administrator would configure later (nothing changed now)

1. A dedicated Windows/service identity suitable for this local PC and the connector's service startup, with an SQL login mapped to a user in RsDB. If the vendor requires SQL authentication instead, establish a separately managed restricted credential; do not reuse the shop app's credential or an owner account.
2. Grant connection and **SELECT only on approved objects/columns or vendor-approved read views**. Start with Invoice, InvoiceDetails, SalesReturn, SalesReturnDetails and narrowly selected Salesman/Firms references. Avoid db_owner, sysadmin, broad db_datareader, write/DDL permissions, or blanket access to customer/authentication tables.
3. Grant scoped VIEW DEFINITION only if the deployed connector genuinely needs schema validation. No EXECUTE permissions are required for the extraction plan. Some existing numbering procedures WRITE to Firms; they must never be called by discovery or extraction.
4. Confirm driver/process bitness, service identity access, resource limits, local outbox ACLs and startup behavior. The connector sends outbound HTTPS to Hishob; no inbound SQL internet access is needed.
5. Test that the identity can read only approved source data and cannot modify data or execute write procedures. This permission test remains future work. Do not create users/grants during this read-only task.

## 3. Bill eligibility, dates and source scope

Observed Invoice groups during inspection:

| InvoiceType | FirmCode | Rows | Latest InvoiceDate | Interpretation |
|---|---:|---:|---|---|
| 0 | 0 | 234,118 | 2026-10-29 | Cash-sale number series, eligible candidate |
| 1 | 0 | 1,727 | 2026-08-06 | Credit-sale number series, eligible candidate |
| -1 | 0 | 1 | 2025-08-11 | Unclassified, InvoiceNo=0; quarantine/exclude pending vendor explanation |

Firms has codes 0 and 1, both Status=0 at the separate lookup check, but only code 0 appeared in Invoice. Do not interpret Status=0 as disabled or invent a shop mapping. Start with owner-approved **FirmCode=0, InvoiceType IN (0,1)** and preserve the original type. Future codes need explicit review. Historical data starts as early as 2010 and must not all be presented as newly unpaid debt.

The standard sales-register report filters by InvoiceDate, type 0/1 and selected firm. Neither it nor the numbering routines require `isTender` for a bill to exist. Many older Invoice rows have isTender NULL. **Do not require a tender/payment flag to import a bill.** Hishob determines collection independently.

No posted/draft/quotation/cancelled status field was established on Invoice. The anomalous -1/zero-number row cannot be called a quotation or draft from metadata alone. The exact save boundary—when header and all lines become a committed complete bill—and any separate quotation/hold workflow remain vendor questions. A stable header/item reread is useful, but is not proof of finality while an operator may still be saving.

All 235,846 InvoiceDate values checked were midnight date values. `Time` is a separate string; one row had empty/NULL Time. OBS-PRINT's date and `11:53` matched the PDF. Use InvoiceDate as source business date; retain raw Time and its precision. Do not manufacture seconds, timezone or edit time. Treat local wall time as Asia/Kolkata only after shop confirmation. TenderDate/TenderTime and Invoice1.PrintDate are not a verified bill-modification cursor. PrintDate is not the original transaction timestamp.

Full source identity is `{source installation, InvoiceNo, FYear, InvoiceType, FirmCode}`; map it to the authorized Hishob shop server-side. Preserve FYear verbatim in real extraction (masked in examples). InvoiceNo is demonstrably reused across financial years. The key also supports reused numbers across firms/types; do not deduplicate across those dimensions. Date is NOT part of the Invoice PK, so a changed business date must update the same source bill version. Same-key deletion/recreation between observations cannot be distinguished reliably without a vendor lifecycle ID/feed.

## 4. Payable amount, discounts, taxes and rounding

### Verified comparison and bounded examples

`redacted-lifecycle-examples.json` contains six small current-bill examples plus bounded lifecycle/linkage observations. Only **one existing printed bill PDF** was available and visually compared; the others are SQL examples cross-checked with source report-template logic, not independently verified printed bills. No report was refreshed and no production print/edit/save action was performed.

| Example | Observed facts |
|---|---|
| OBS-PRINT | Printed MRP total 2,100.00, discount 901.00, payable 1,199.00; taxable 1,141.90, CGST 28.55, SGST 28.55. Invoice: TotalAmt 1,141.90; IDisc 901; DiscAmt 0; GSTAmt 57.10; NetAmt 1,199; Time 11:53. Item sum agrees. |
| OBS-DISCOUNT | TotalAmt 4,209.51 + GSTAmt 210.49 − DiscAmt 20 = NetAmt 4,400.00. Stored IDisc 5,900.008 is not an amount to subtract again from this formula; it does not equal this sample's simple MRP-versus-sale subtotal difference. |
| OBS-EXCHANGE | Item/tax-inclusive value 6,495.00 − ExchangeAmt 4,960.00 = NetAmt 1,535.00. The amount still to collect is different from new-item value. |
| OBS-MULTI-STAFF | NetAmt 9,410.00, seven lines, two item salesperson references, header SLNo=0. |
| OBS-TYPE1 | Type 1 bill NetAmt 8,661.00; this source classification creates no collected/uncollected assertion in Hishob. |
| OBS-UNKNOWN-TYPE | Type -1 / zero-number record has lines and a monetary value. These facts alone do not make it an eligible saved customer bill. |

`Bill.rpt` and `BillTH.rpt` use `SalesBill`; their `{@NetAmt}` formula prints **NetAmt + CardPayCharges**, treating NULL charges as absent. Therefore NetAmt alone is not proven to be the universal printed payable. CardPayCharges is relevant here only as a potential **source charge included in the bill amount**, never as proof of collection. It was zero in all six examples and in the bounded October amount-field profile (1,687 type-0 bills at that time). Preserve the field and confirm its billing treatment before introducing any charge adjustment into Hishob.

The inspected `Salesreg.rpt` displays discount using `DiscAmt + IDisc` when IDisc exists, and has additional daily difference formulas. Do not blindly derive payable by subtracting every discount column: tax-inclusive prices, display discounts and persisted amounts can overlap. Likewise, do not recompute source payable from current product prices.

`RoundAmt` on Invoice is an integer; it was zero in sampled bills and the bounded October profile. No nonzero-rounding printed example was verified. InvoiceDetails.NetAmt is integer while many other amounts are SQL real. All tax/discount/rounding exceptions—including IGST, coupons, loyalty, advances and source charges—need targeted examples if they are used in this shop.

Recommended extraction: preserve authoritative raw header fields plus an explicitly versioned payable-mapping rule. NetAmt is the validated starting amount for the inspected cases; a nonzero exceptional charge/adjustment should be reviewed against the print/report convention. Store item value, tax, exchange adjustment and payable separately. Do not label net payable as statutory sales revenue or blindly subtract a separate return again when exchange credit is already embedded.

Normalize source floating-point amounts with a documented decimal-to-paise rounding rule matching printed source amounts. The examples deliberately retain observed floating artifacts, such as 4,419.9921 summed sale-rate values, to expose the issue. Do not use binary floating arithmetic for Hishob collection balances. Do not claim a universal bill formula: an attempted broader formula check timed out and produced no result.

## 5. Items, salesperson and billing operator

- Base item source: **InvoiceDetails**, joined to Invoice by all four PK components. Do not use SalesView/Sales() as the full persisted item source; they read printing tables.
- Item-level `SLNo` points to salesperson references; retain distinct `HLNo`/other attribution fields as unresolved roles unless vendor semantics are known. `Salesman.SLNo`/SLName are the candidate reference/display lookup. No staff names or contact data were exported.
- `Invoice.SLNo` and ESLNo also exist, but are zero in the sampled bills. In the bounded October join profile, 3,399 of 3,415 lines had nonzero SLNo and all 3,399 differed from the header reference. This is strong evidence to prefer line attribution for this installation.
- `InvoiceSL` was empty. Do not depend on it for actual bill attribution.
- `Invoice.UserID` is billing operator, not salesperson; the PDF cashier label corresponded to that source role. `SectionID` is a counter/section reference, NULL in the sampled headers. Mapping salesperson references to Hishob staff memberships must be explicit and shop-scoped.
- InvoiceDetails has nonunique indexes, but no declared primary/unique key in inspected metadata. Do not assume SrNo, Num or barcode is immutable/unique. Replace/version a complete line multiset atomically per bill; preserve duplicate rows and their multiplicities. Barcode is a floating-point source field, so canonicalize carefully without lossy identifier conversion.
- Read headers once, aggregate items independently, then associate them. Never sum header NetAmt after a one-to-many item, history or salesperson join. An item attribution change must trigger a source bill revision even when NetAmt stays identical.

## 6. Updates, history and cancellation evidence

### Printing tables: Invoice1 / InvoiceDetails1

The `SalesBill` stored procedure joins Invoice1 to `Sales(...)` and filters `Invoice1.Deleted=0`. `Sales(...)` and `SalesView` read InvoiceDetails1 with its Deleted filter. Invoice1 also has PrintDate and a print-image field. These definitions demonstrate printing usage.

At inspection Invoice1 had 297 rows: 76 Deleted=false and 221 Deleted=true. **All 297 keys existed in Invoice**. Same-key NetAmt agreed for 72/76 unflagged and 175/221 flagged rows; other amounts differed. InvoiceDetails1 had 743 rows. This is a small printing-oriented working set, not the complete 235k-bill ledger. It may hold stale versions; exact regeneration/deletion mechanics were not observed. Do not import these as extra sales or map their Deleted flags to bill cancellation.

### InvoiceDel / InvoiceDetailsDel

InvoiceDel had 75,767 rows. 75,763 matched a current Invoice key; 26,279 had the same NetAmt. There were 13,467 duplicate composite-key groups, up to 19 rows per key. It has no verified unique event sequence, deletion time or modified time. `NewInvNo/Newinvtype/NewFirmCode` exist; 40,342 rows had NewInvNo=0 and only one row had the same old/replacement key in the checked fields. Meaning and replacement-FYear behavior are not documented by these values.

Four history rows lacked a current matching key; redacted examples are included. That is observed absence in a successful query, **not proof of when a physical deletion happened, whether it was a cancellation, or what happened to money**. Repeated historical versions and current-key coexistence show that this table cannot be treated as a clean tombstone feed. InvoiceDetailsDel is likewise history-shaped but lacks a verified ordered lifecycle contract.

### Change metadata

- No rowversion/timestamp columns were found anywhere in the database metadata query.
- SQL Change Tracking is off for RsDB; CDC is off.
- READ_COMMITTED_SNAPSHOT is false; snapshot isolation is OFF.
- No triggers or foreign keys were returned for the selected source tables. This does not describe all application-side writes or external audit systems.
- No generic ModifiedAt/UpdatedAt or business cancellation marker was established on Invoice/InvoiceDetails. InvoiceDate, Time, print/tender/packing dates do not solve this.
- Existing `isSynced`/`SyncID` fields have unknown vendor ownership. Do not write, reset or reuse them as Hishob checkpoints.
- InvoiceLogs and LastBill were empty at inspection; their presence does not provide a dependable mutation feed.
- `vwBillSeries` was also inspected: it selects `Cash AS Card`. Do not use that view as reliable payment evidence. Under the revised design no source payment view is authoritative anyway.

### Detection achievable with read-only access

| Event | Proposed observation | What can/cannot be concluded |
|---|---|---|
| New saved bill | New full key in a successful committed base-table scan | Can discover a retained eligible bill; needs vendor save-boundary contract to guarantee completeness at first observation |
| Changed amount/date/item/staff | Compare canonical header plus complete line-multiset digest for same key | Detects a retained changed state when revisited; digest is not a source event sequence |
| Explicit cancellation | Vendor-confirmed cancellation status/feed | No reliable marker demonstrated here; cannot assert cancelled solely from Invoice1/InvoiceDel flags |
| Physical deletion | Previously known key absent from an authorized, successfully completed scope scan and separately confirmed absent | Can flag missing-source/review; without consistent snapshot/lifecycle proof, do not automatically call it cancelled |
| Old bill edited later | Revisit old keys in a full historical sweep or vendor change feed | Recent-date polling alone cannot detect it; full sweeps only detect states still present at observation |
| Reused number | Compare full key including FYear/type/firm | Different-key bills remain distinct; same-key delete/recreate between polls remains ambiguous |

Complete detection of **every event** cannot be guaranteed with the present observed mechanism. A bill created and removed between scans, or edited and restored to its prior state, leaves no guaranteed evidence for a polling reader. Offline intervals, same-key reuse, changing pages during a scan and unretained history compound this limitation.

The smallest robust vendor-supported addition is an existing supported API/export if available, or a vendor-maintained durable, monotonically sequenced change/tombstone feed with the full bill identity, operation, source generation, timestamp and enough retention for offline recovery. It must cover header, item, salesperson and cancellation changes and provide a coherent snapshot/version for fetches. A modified timestamp alone does not detect physical deletion. Vendor-approved CT for both headers and child tables can support eventual current-state convergence within retention, but is not a full audit of every intermediate event. **Nothing was enabled or added during inspection.**

## 7. Returns and corrections

SalesReturn is a separate table with PK ReturnNo; SalesReturnDetails has ReturnNo and original-sale key fields. `QSalesReturn` joins header/details on ReturnNo, and `SReturn.rpt` labels cash/credit/voucher return documents based on source fields. Those document labels do not prove money was refunded.

OBS-RETURN-LINK shows a return for 420.00 with header InvoiceNo=0 and FY empty, while its detail identifies an existing type-1 original bill in an earlier financial year. Another return has three detail lines whose amounts add to its 3,556.00 header amount. The original bill remains present. This proves separate-document linkage and why the **detail key** matters; it does not prove the original bill stayed unchanged throughout its lifecycle. No before/after images were manufactured.

Normalize a return once by source ReturnNo and installation; associate its individual lines with their original full bill keys. Do not assume return FYear equals original bill FYear, header InvoiceNo is populated, one return only references one bill, or every line resolves. Quarantine unresolved links. Verify whether source return/exchange handling has already reduced the payable before applying any credit to Hishob, to avoid double reduction.

A source return, cancellation, deletion or lowered amount MUST NOT create a collection reversal/refund automatically. Preserve all Hishob collections and show a review-required credit/refund/reallocation situation. A separately authorized Hishob refund/reversal event is needed to record money actually returned. Do not infer a refund method from RadioSoft CshChq/isRG/PayOptID.

## 8. Hishob model required by the revised authority rule

This is design guidance for laptop Codex, not implemented changes. The earlier repository inspection was commit `57c6ece7d9358609b8a22d9521bc6bc28e3f5f93`; re-read the current laptop branch before changing code. Relevant prior files: `backend/app/cashbook.py`, `financial_schemas.py`, `routers/hishob.py`, `dues.py`, `routers/dues.py`, `db.py`, `shop_policy.py`, `docs/HISHOB-METHODS.md`, and `mobile/src/financial/*`. Current laptop changes were not inspected in this turn.

Keep independent dimensions:

1. **Source bill state/version:** eligible/current/changed/cancelled/missing-source/unresolved, raw source key, amount components, lines and salesperson references, source date, last successful observation, digest/version, and review acknowledgement.
2. **Collection ledger:** append-only Hishob events recording bill ID, amount in integer paise, method CASH/UPI/CARD/UNSPECIFIED, collector identity, shop, recorded/business time, idempotency key and bill revision used. Split payments are explicit method allocations. Authorized owners/managers only; enforce live shop permissions server-side.
3. **Derived balance/status:** pending, partially paid or paid from current approved obligation versus effective collection allocations. Changed/cancelled are additional source badges, not replacements for the collection history. Overcollection/credit balance requires an explicit display, not silently clamping away the excess.

“Mark outstanding paid without method” must create an explicit amount-bearing UNSPECIFIED collection event for the then-current outstanding amount, under optimistic concurrency. It is not merely a boolean paid flag. A retry must not add the amount twice, and a simultaneous source edit or another collector must cause revalidation. Later method classification amends/classifies the same event with audit, rather than recording a second receipt.

UNSPECIFIED counts toward recorded paid amount but **must not be allocated to cash, UPI or card**. Show it separately. A precise expected-galla reconciliation remains unresolved to the extent those receipts might be cash; do not silently treat unknown-method receipts as zero cash or digital. Even UPI/card chosen in Hishob is an authorized recorded collection, not independently bank-verified settlement.

If a 1,000 bill with 1,000 collected changes to 1,200, retain collections and show 200 outstanding plus Changed. If reduced to 800, retain 1,000 of history and show 200 excess requiring review. If cancelled, retain the bill tombstone/version and all events and request disposition; do not erase or fabricate a refund. Collections and source revision acceptance must have ordering/concurrency protection so a late batch cannot resurrect a voided bill or overwrite newer data.

Choose a source activation/cutover date and a policy for pre-existing bills. Historical bills must not all start “pending” as if never paid. For pre-cutover balances, collect owner-approved opening acknowledgements/import policy into Hishob; source CashPay/CardPay cannot silently backfill collections under this rule.

Keep imported bill/item versions outside the existing large per-day transaction array; preserve audit and closed-day snapshots. Invoice value belongs to the sale business date; collection cash movement belongs to the collection date. An old-bill receipt is not a new sale. Existing cashbook logic that derives cash sales by subtraction from billing totals needs deliberate adaptation to actual collection events, unknown methods, returns and later receipts. Do not count both a collection and a manual cash-in entry.

## 9. Proposed read-only extraction strategy

1. Version an explicit extraction contract for this installation: source identity, approved firm/types, header amount fields, base item fields, salesperson references, return fields, and schema fingerprint. Fail visibly on incompatible schema changes.
2. Use dedicated SELECT-only access and explicit columns. Avoid reading customer/auth fields or the wide reporting stored procedures. Match parameter types to source types; Invoice.FYear is varchar(100), but Invoice1/InvoiceDel FYear is nvarchar(10). A naive implicit-conversion join caused a 15-second timeout; converting the small history-side year to the known compatible type allowed the successful overlap checks. Confirm encoding/length before adopting any cast.
3. For frequent discovery, page eligible recent bills and their items by full key, then canonicalize relevant header/line facts (including item/staff changes). Do not poll the whole ledger every few seconds. Query timeout/cancellation is a failed observation, never an empty successful result.
4. Add periodic historical full-key/content sweeps and explicit old-bill rereads. Keep scan scope, start/end, page completion and errors. Use full identities, deterministic ordering and persisted coverage; a new-number high-water mark or recent-date window is only an optimization, not a completeness guarantee.
5. Read committed data. Do not use NOLOCK/dirty reads. Snapshot isolation is currently off; do not enable it yourself. Cross-query consistency and save completeness need a vendor-supported snapshot/read version or a carefully validated stable-reread strategy. Even complete paginated read-committed scans are not an atomic snapshot of an active database.
6. Stage source versions locally and deliver replay-safe, ordered upserts over outbound HTTPS. A source observation digest detects change, but does not order it; persist connector sequence/generation and recover from reinstall/database restore explicitly. Show last successful sync and incomplete coverage.
7. Treat disappearance as a candidate exception, confirm key/scope/query success, and use an explicit source cancellation only when proven by vendor semantics. Never delete Hishob collections. Keep missing-source status distinct from confirmed cancelled.
8. Shadow-test with existing bills and compare safe exports to source reports before enabling collection workflows. Use approved non-production before/after examples for save/edit/cancel/delete/return/renumber tests. No live test bills are needed.

`READONLY-PROBES.sql` provides SELECT/metadata query templates with placeholders and bounded examples for these remaining questions. It contains no DDL, DML or stored-procedure execution. Do not run every probe in one batch on an active shop. Some broad checks timed out at the 15-second inspection limit; the package records no results for those failed checks. It does not claim global monetary-formula, global return-linkage or full module-search coverage from them.

## 10. Evidence scope, limits and next gates

- UI observation failed on both initial and refreshed RadioSoft window selection with a window-owner validation error. No UI input was performed. Existing PDF plus offline report-template definitions supplied independent evidence instead.
- Report templates were opened for definitions only using the already-installed 32-bit Crystal runtime. Connection credentials were not accessed and data was not refreshed. Application code can override template formulas/selections; this was not inspected.
- SELECTs against a live shop are separate observations, not one atomic snapshot. Counts are timestamped inspection evidence and can change with ordinary business activity. Metadata row counts are explicitly identified as such.
- No complete new→edit→cancel→delete→restore sequence was observed. Historical coexistence is not chronological proof. No immutable source lifecycle ID or cancellation contract was demonstrated.
- A production launch needs confirmation of bill eligibility/save boundary, amount exceptions, and lifecycle feed/limitations. Payment-method mapping in RadioSoft is no longer a blocking issue for this design because Hishob records collections.
- Required Hishob acceptance cases: cash/UPI/card/split/unspecified; duplicate/retried and concurrent collection; source amount up/down; item-only/staff-only edit; cancelled/missing bill with collections retained; return without refund; old bill/late collection; same number different years/types/firms; old edits and outages; cutover history; source reappearance/rekey; closed-day corrections and unknown-method cash reconciliation.

See `OPEN-QUESTIONS.md` for the smallest remaining owner/vendor decisions. The ZIP contains only these documents, metadata, redacted bounded examples and the manifest—not the original PDF, screenshots, bill history, backups or database files.
