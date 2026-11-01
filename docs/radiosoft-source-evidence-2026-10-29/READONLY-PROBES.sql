/*
RadioSoft read-only discovery probes — reviewed 29 October 2026.
Target: approved local SQL instance / RsDB. No credentials in this file.
Run ONE chosen query at a time with a SELECT-only identity, client timeout (e.g. 15s),
and suitable row/date scope. This is a query catalogue, not a deployment script.
Parameters such as @InvoiceNo are placeholders to bind in the client, not secrets.
No source procedures are executed. SELECTing their definitions is metadata only.
No NOLOCK, CT enablement, DDL, DML, log reading, database backup or schema change.
Empty successful results differ from timeout/error/incomplete results.
Do not infer a deletion from a failed or partially completed probe.
Column names referencing payment/credentials in metadata are not their values.
Do not extend projections to authentication secrets or unnecessary customer fields.
*/

-- P01: identity/version/access; the caller may have more privileges than a future service.
SELECT DB_NAME() AS database_name,
       CONVERT(varchar(50), SERVERPROPERTY('ProductVersion')) AS product_version,
       CONVERT(varchar(100), SERVERPROPERTY('Edition')) AS edition,
       CONVERT(int, SERVERPROPERTY('IsIntegratedSecurityOnly')) AS windows_only,
       IS_SRVROLEMEMBER('sysadmin') AS caller_sysadmin,
       IS_MEMBER('db_owner') AS caller_db_owner,
       HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'VIEW DEFINITION') AS view_definition;

-- P02: own connection only; server permission may be required on this old SQL version.
SELECT auth_scheme, net_transport
FROM sys.dm_exec_connections WHERE session_id=@@SPID;

-- P03: attached database and consistency settings. File paths are metadata, not file reads.
SELECT name, compatibility_level, is_read_committed_snapshot_on,
       snapshot_isolation_state_desc, is_cdc_enabled
FROM sys.databases WHERE database_id=DB_ID();

SELECT type_desc, physical_name FROM sys.database_files;

-- P04: metadata for relevant base tables, excluding secret-bearing columns.
SELECT s.name AS schema_name, t.name AS table_name, c.name AS column_name,
       ty.name AS data_type, c.max_length, c.precision, c.scale,
       c.is_nullable, c.is_identity, c.is_computed
FROM sys.tables t
JOIN sys.schemas s ON s.schema_id=t.schema_id
JOIN sys.columns c ON c.object_id=t.object_id
JOIN sys.types ty ON ty.user_type_id=c.user_type_id
WHERE t.name IN ('Invoice','InvoiceDetails','Invoice1','InvoiceDetails1',
                 'InvoiceDel','InvoiceDetailsDel','SalesReturn','SalesReturnDetails',
                 'InvoiceSL','Salesman','Firms','CounterMF','LastBill','InvoiceLogs')
  AND c.name NOT IN ('Api_Pwd','Api_Uid')
ORDER BY t.name,c.column_id;

-- P05: keys/indexes. Nonunique indexes are not proof of immutable row identity.
SELECT t.name AS table_name, i.name AS index_name, i.type_desc,
       i.is_primary_key, i.is_unique, i.is_disabled, i.has_filter, i.filter_definition,
       c.name AS column_name, ic.key_ordinal, ic.is_included_column, ic.is_descending_key
FROM sys.tables t JOIN sys.indexes i ON i.object_id=t.object_id
JOIN sys.index_columns ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id
JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id
WHERE t.name IN ('Invoice','InvoiceDetails','Invoice1','InvoiceDetails1',
                 'InvoiceDel','InvoiceDetailsDel','SalesReturn','SalesReturnDetails','Salesman')
ORDER BY t.name,i.name,ic.key_ordinal,ic.index_column_id;

-- P06: rowversion, CT and relevant triggers. Missing metadata under restricted permissions
-- is not conclusive; inspection used a caller with VIEW DEFINITION/sysadmin.
SELECT OBJECT_NAME(object_id) AS table_name, name AS column_name
FROM sys.columns WHERE system_type_id=189;

SELECT database_id,is_auto_cleanup_on,retention_period,retention_period_units_desc
FROM sys.change_tracking_databases WHERE database_id=DB_ID();

SELECT OBJECT_NAME(parent_id) AS table_name,name,is_disabled
FROM sys.triggers
WHERE OBJECT_NAME(parent_id) IN ('Invoice','InvoiceDetails','Invoice1','InvoiceDetails1',
                                 'InvoiceDel','InvoiceDetailsDel','SalesReturn','SalesReturnDetails');

-- P07: exact relevant view definitions. Do not use reporting views as the base bill feed.
SELECT s.name AS schema_name,v.name,m.definition
FROM sys.views v JOIN sys.schemas s ON s.schema_id=v.schema_id
LEFT JOIN sys.sql_modules m ON m.object_id=v.object_id
WHERE v.name IN ('SalesView','vwBillSeries');

-- P08: READ definitions only. GetCashInvoiceNo/GetCreditInvoiceNo write to Firms
-- if executed. NEVER EXEC these procedures in discovery or the connector.
SELECT o.name,o.type_desc,m.definition
FROM sys.objects o JOIN sys.sql_modules m ON m.object_id=o.object_id
WHERE o.name IN ('SalesBill','SalesBillMF','Sales','SalesMF','QSalesReturn',
                 'GetCashInvoiceNo','GetCreditInvoiceNo','HSNInvoice')
ORDER BY o.name;

-- P09: source series/firm profile. Full-table aggregate; run off-peak if needed.
SELECT InvoiceType,FirmCode,COUNT_BIG(*) AS rows_count,
       MIN(InvoiceDate) AS first_date,MAX(InvoiceDate) AS last_date
FROM dbo.Invoice GROUP BY InvoiceType,FirmCode ORDER BY InvoiceType,FirmCode;

SELECT FirmCode,Status,GSTType FROM dbo.Firms ORDER BY FirmCode;

-- P10: bounded candidate bill headers. Bind @StartDate/@EndDate datetime (end exclusive),
-- @FirmCode int. Example values are deliberately not filled in. No tender/payment filter.
-- A TOP limit bounds exported rows, not necessarily database execution cost.
SELECT TOP(50) InvoiceNo,FYear,InvoiceType,FirmCode,InvoiceDate,Time,
       TotalAmt,DiscAmt,IDisc,GSTAmt,IGSTAmt,TaxAdditional,NetAmt,RoundAmt,
       ExchangeAmt,AdvAmt,CoupenDisc,LPDiscAmt,CardPayCharges,SLNo,ESLNo,SectionID
FROM dbo.Invoice
WHERE InvoiceType IN(0,1) AND FirmCode=@FirmCode
  AND InvoiceDate>=@StartDate AND InvoiceDate<@EndDate
ORDER BY InvoiceNo,FYear,InvoiceType,FirmCode;
-- Intentionally no customer fields or source payment allocation. UserID can be
-- added locally when needed for billing-operator mapping; mask before sharing.

-- P11: exact bill. Bind @InvoiceNo int, @FYear varchar(100), @InvoiceType smallint,
-- @FirmCode int. InvoiceDate is not part of the main PK.
SELECT InvoiceNo,FYear,InvoiceType,FirmCode,InvoiceDate,Time,
       TotalAmt,DiscAmt,IDisc,GSTAmt,IGSTAmt,TaxAdditional,NetAmt,RoundAmt,
       ExchangeAmt,AdvAmt,CoupenDisc,LPDiscAmt,CardPayCharges,SLNo,ESLNo,SectionID
FROM dbo.Invoice
WHERE InvoiceNo=@InvoiceNo AND FYear=@FYear
  AND InvoiceType=@InvoiceType AND FirmCode=@FirmCode;

-- P12: complete item set for ONE bill. Source IDs require masking before sharing.
-- This reads no ItemName/free-text/customer columns. A future connector can read
-- approved item descriptions under the agreed data contract.
SELECT InvoiceNo,FYear,InvoiceType,FirmCode,InvoiceDate,Num,SrNo,BarCodeID,
       Qty,Mrp,SaleRate,Amount,GST,GSTAmt,IGSTAmt,NetAmt,SLNo,HLNo
FROM dbo.InvoiceDetails
WHERE InvoiceNo=@InvoiceNo AND FYear=@FYear
  AND InvoiceType=@InvoiceType AND FirmCode=@FirmCode
ORDER BY SrNo,Num;
-- SrNo/Num are NOT proven unique. Preserve all duplicate lines; do not LIMIT
-- a production bill's item set without an explicit incomplete flag.

-- P13: aggregate items separately; never sum header NetAmt over an item join.
SELECT COUNT_BIG(*) AS line_count, COUNT(DISTINCT SLNo) AS distinct_staff_references,
       SUM(CAST(Amount AS decimal(18,4))) AS taxable_sum,
       SUM(CAST(GSTAmt AS decimal(18,4))) AS gst_sum,
       SUM(CAST(Mrp*Qty AS decimal(18,4))) AS mrp_quantity_sum,
       SUM(CAST(SaleRate*Qty AS decimal(18,4))) AS rate_quantity_sum
FROM dbo.InvoiceDetails
WHERE InvoiceNo=@InvoiceNo AND FYear=@FYear
  AND InvoiceType=@InvoiceType AND FirmCode=@FirmCode;
-- Casting a precomputed real product does not remove source rounding artifacts;
-- this is a diagnostic, not the authoritative payable calculation.

-- P14: same exact bill's printing and history rows. No chronology is implied.
-- FYear is nvarchar(10) in Invoice1/InvoiceDel; bind @HistoryFYear nvarchar(10).
SELECT InvoiceNo,FYear,InvoiceType,FirmCode,InvoiceDate,PrintDate,Deleted,NetAmt
FROM dbo.Invoice1
WHERE InvoiceNo=@InvoiceNo AND FYear=@HistoryFYear
  AND InvoiceType=@InvoiceType AND FirmCode=@FirmCode;

SELECT InvoiceNo,FYear,InvoiceType,FirmCode,InvoiceDate,NetAmt,
       NewInvNo,Newinvtype,NewFirmCode
FROM dbo.InvoiceDel
WHERE InvoiceNo=@InvoiceNo AND FYear=@HistoryFYear
  AND InvoiceType=@InvoiceType AND FirmCode=@FirmCode;

-- P15: bounded print-flag counterexamples. No cancellation inference.
SELECT TOP(5) h.InvoiceNo,h.FYear,h.InvoiceType,h.FirmCode,h.InvoiceDate,
       h.PrintDate,h.Deleted,h.NetAmt AS print_net,i.NetAmt AS current_net
FROM dbo.Invoice1 h
JOIN dbo.Invoice i ON i.InvoiceNo=h.InvoiceNo
 AND i.FYear=CONVERT(varchar(100),h.FYear)
 AND i.InvoiceType=h.InvoiceType AND i.FirmCode=h.FirmCode
WHERE h.Deleted=1
ORDER BY h.InvoiceDate DESC,h.InvoiceNo DESC;
-- Verify encoding before using a Unicode-to-varchar cast on arbitrary future data.

-- P16: bounded same-key history/current amount differences.
SELECT TOP(5) d.InvoiceNo,d.FYear,d.InvoiceType,d.FirmCode,d.InvoiceDate,
       d.NetAmt AS history_net,i.NetAmt AS current_net,
       d.NewInvNo,d.Newinvtype,d.NewFirmCode
FROM dbo.InvoiceDel d
JOIN dbo.Invoice i ON i.InvoiceNo=d.InvoiceNo
 AND i.FYear=CONVERT(varchar(100),d.FYear)
 AND i.InvoiceType=d.InvoiceType AND i.FirmCode=d.FirmCode
WHERE d.InvoiceDate>=@StartDate AND d.InvoiceDate<@EndDate
  AND ABS(d.NetAmt-i.NetAmt)>0.005
ORDER BY d.InvoiceDate DESC,d.InvoiceNo DESC;

-- P17: scoped history keys without current row. Only a candidate exception;
-- no deletion time/reason is established. Do not automate cancellation from this.
SELECT TOP(5) d.InvoiceNo,d.FYear,d.InvoiceType,d.FirmCode,d.InvoiceDate,
       d.NetAmt,d.NewInvNo,d.Newinvtype,d.NewFirmCode
FROM dbo.InvoiceDel d
WHERE d.InvoiceDate>=@StartDate AND d.InvoiceDate<@EndDate
  AND NOT EXISTS (
    SELECT 1 FROM dbo.Invoice i
    WHERE i.InvoiceNo=d.InvoiceNo AND i.FYear=CONVERT(varchar(100),d.FYear)
      AND i.InvoiceType=d.InvoiceType AND i.FirmCode=d.FirmCode)
ORDER BY d.InvoiceDate DESC,d.InvoiceNo DESC;

-- P18: returns: header and original-sale line links separately. Bind @ReturnNo int.
SELECT ReturnNo,ReturnDate,InvoiceNo,FY,FYear,InvoiceType,FirmCode,Amount,isRG,Charges
FROM dbo.SalesReturn WHERE ReturnNo=@ReturnNo;

SELECT d.ReturnNo,d.InvoiceNo,d.InvoiceDate,d.FYear,d.InvoiceType,d.FirmCode,
       d.Num,d.BarCodeID,d.Qty,d.SaleRate,d.Amount,d.GST,d.GSTAmt,d.SLNo,
       i.NetAmt AS original_current_net
FROM dbo.SalesReturnDetails d
LEFT JOIN dbo.Invoice i ON i.InvoiceNo=d.InvoiceNo
 AND i.FYear=CONVERT(varchar(100),d.FYear)
 AND i.InvoiceType=d.InvoiceType AND i.FirmCode=d.FirmCode
WHERE d.ReturnNo=@ReturnNo
ORDER BY d.Num;
-- A return document does not prove a refund. The original row may have changed
-- at another time; this contemporaneous join cannot establish before/after behavior.

-- P19: inspect reused numbers without merging distinct fiscal/type/firm keys.
SELECT TOP(20) InvoiceNo,FYear,InvoiceType,FirmCode,InvoiceDate,NetAmt
FROM dbo.Invoice WHERE InvoiceNo=@InvoiceNo
ORDER BY FYear,InvoiceType,FirmCode;

-- P20: point check after a completed scan reports a previously known key absent.
-- Still not proof of cancellation, and NEVER run after a failed scan as a tombstone rule.
SELECT InvoiceNo,FYear,InvoiceType,FirmCode
FROM dbo.Invoice
WHERE InvoiceNo=@InvoiceNo AND FYear=@FYear
  AND InvoiceType=@InvoiceType AND FirmCode=@FirmCode;

-- P21: locate date/status candidates from metadata only; column names are not semantics.
SELECT t.name AS table_name,c.name AS column_name,ty.name AS data_type
FROM sys.tables t JOIN sys.columns c ON c.object_id=t.object_id
JOIN sys.types ty ON ty.user_type_id=c.user_type_id
WHERE t.name IN ('Invoice','InvoiceDetails','Invoice1','InvoiceDel',
                 'InvoiceDetails1','InvoiceDetailsDel','SalesReturn','SalesReturnDetails')
 AND (c.name LIKE '%date%' OR c.name LIKE '%time%' OR c.name LIKE '%modif%'
      OR c.name LIKE '%update%' OR c.name LIKE '%delet%' OR c.name LIKE '%cancel%'
      OR c.name LIKE '%status%')
ORDER BY t.name,c.column_id;

-- P22: metadata-only application-login separation; do NOT SELECT Users data/Password.
SELECT TABLE_NAME,COLUMN_NAME,DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME='Users' AND COLUMN_NAME IN ('UserID','UserType','Password','UID');

-- Parameters, suggested types (bind externally; no defaults imply production scope):
-- @StartDate datetime, @EndDate datetime (exclusive), @FirmCode int,
-- @InvoiceNo int, @InvoiceType smallint, @FYear varchar(100),
-- @HistoryFYear nvarchar(10), @ReturnNo int.
-- Probes establish current facts only. For complete change semantics obtain
-- vendor-supported non-production before/after examples and feed guarantees.
