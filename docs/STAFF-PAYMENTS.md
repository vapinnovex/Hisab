# Staff payments and notes

## Simple workflow

Team cards open a dedicated staff page. Attendance, password access and profile editing keep their existing permissions. Owner manages all staff; a manager can manage workers' payment books only when the owner enables that permission, never their own or another manager's. Workers and managers can read their own complete history. Inactive staff retain records but cannot log into the shop.

The optional reference salary is a monthly or daily amount, recorded at creation or changed from the staff page with a reason and audit history. It does not calculate earned pay, outstanding salary, deductions or attendance-based amounts. Actual payments can be split into any number of instalments on any open Hishob date.

## Financial behavior

| Staff action | Hishob entry | Cash impact |
| --- | --- | --- |
| Salary, advance, other money given | Expense, with staff identity and purpose | Cash reduces drawer; digital does not |
| Money received, e.g. advance returned | Other receipt, not sales | Cash increases drawer; digital is tracked separately |
| Shop goods taken without payment | Credit sale associated with this person | No cash moves |
| Receive purchase payment | Existing due collection for that exact purchase | Cash/digital receipt; reduces purchase due |
| Dated note | Separate shared staff note | None |

An advance repayment does not automatically settle a shop purchase. Select Receive purchase payment on that purchase, or use Customer dues. Partial receipts cannot exceed the remaining purchase due. Cash and digital receipts appear in staff history even when collected from Customer dues.

Hishob must already be open for the chosen payment date. Existing owner-only missed-day creation and reopening rules apply. Purchase collections follow the existing dues rule: record them in today's open day. A prior closed day is never silently changed. Backfilled payments do not rewrite later days' saved opening balances.

Closing lists staff names, amounts, methods and notes already included in totals. These amounts must not be entered twice. All three Hishob sales methods use the same financial entries. Digital non-sale receipts do not increase cash or sales.

## Notes and correction

Notes have a date and text, are visible to the worker, and can be added without opening Hishob. Managers can add worker notes with worker-edit or worker-payment permission, without finance access. Notes-only access does not expose payments or reference salary.

Owners can cancel notes with a reason. They can cancel financial entries only on an open day, preserving the entry and audit and recalculating Hishob. Collected purchases and payment receipts retain the existing no-cancellation protection. Staff financial entries cannot be edited into unrelated transactions; cancel and re-enter an incorrect entry. Workers cannot create, modify or cancel records.

## Storage, privacy and retries

Financial entries live only in `hishob_days.transactions`, tagged with staff membership ID. Staff history derives from those entries, including cancellations. Closing, transaction history and the staff payment book cannot diverge through a partial second write. Optimistic day revisions, unique staff request keys and frozen retry payloads prevent duplicate/lost writes. Uncertain saves offer a read-only Check saved result action.

Notes use deterministic request IDs and immutable content, with audited cancellation. Reference salary changes use membership revisions and request receipts. History is paginated across notes and payments and projects only the selected person's fields, never shop totals or other people's transactions. Live membership and owner-controlled permissions are checked on every request.

Old salary-book amounts and entries are retained as reference salary and clearly labeled earlier records. No previous salary entries are automatically posted into Hishob, since an owner may already have manually entered the cash movement. The former salary calculation routes and screens are removed. The new manager-payment permission defaults off; the former salary permission does not silently grant financial access.

## Validation

Backend coverage includes cash/digital reconciliation, all closing modes, concurrency, duplicate requests, closed and backdated days, cross-shop access, own-history privacy, live manager permissions, note-only access, partial purchase collection, cancellation, reference updates and legacy preservation. Browser coverage exercises the dedicated staff page, worker read-only view, purchase settlement, closing review and recovery after a saved response is lost.
