# One cashbook, three ways to record sales

Choose **Hishob → Choose Hishob method** before starting a day, or **Account → Shop settings**. The setting applies to new days only. Existing shops and older records default to **Enter sales** to preserve their calculations. A day keeps its method even when the owner changes the shop setting later.

| Method | Best for | Owner records | Result |
| --- | --- | --- | --- |
| Count cash | A shop without independent sales records | Opening cash, expenses, other cash movements, end-of-day cash count, digital/credit sales if any | Estimated cash sales; cash difference is **not measurable** |
| Enter sales | A notebook or simple daily sales register | Individual sales or one net daily total for each payment type, plus expenses and other cash movements | Expected cash compared with counted cash |
| Use billing totals | A shop with a POS/billing report | Expenses and other cash movements during the day; grand total or payment breakdown at closing | Recorded sales; cash difference only when cash sales can be determined |

The billing mode is manual entry of report totals, not an automatic POS integration. No separate shops/apps or duplicate cashbooks are required.

## Billing reports with only a grand total

At closing choose **Billing report → Total sales only** and enter the report's sales total. UPI and card amounts do not need separate fields. Leave **Non-cash sales → Not known** if you do not have payment totals: Hishob saves the sales total, counted cash, expenses and bank/home transfers. Cash/digital/credit sales and the cash difference stay **unknown**, rather than becoming zero or treating every sale as cash.

If you know non-cash sales from another reliable record, choose **I know the totals**. Enter combined UPI/card sales and unpaid credit sales, explicitly entering zero where none occurred. Hishob calculates `cash sales = total sales − UPI/card sales − unpaid credit sales`. For example, ₹10,000 total with ₹3,000 digital and ₹500 unpaid credit means ₹6,500 cash sales. Non-cash amounts cannot exceed total sales. Payments for older dues and owner funds are not today's sales.

**Payment breakdown** remains available for reports that provide cash, combined UPI/card and unpaid-credit totals. Owners can reopen a total-only closing to add known payment totals later; the previous closing remains preserved.

While a day is open the balance is labelled **Current Galla**, based on recorded cash movements. Billing and cash-count days do not know sales until closing, so they show an unavailable balance with an explanation. **Expected Galla** is used for closing reconciliation.

## The important distinction

Opening cash, expenses and a final cash count alone cannot reveal an independent shortage. Unknown sales and missing money cannot both be solved from the same count. Count cash therefore shows **estimated sales** and an unavailable difference, never a misleading zero difference. An unrecorded withdrawal or expense can make this estimate wrong.

When sales are recorded independently:

```
Expected cash before closing transfers
  = opening cash + cash sales + other cash in
    − cash expenses − cash supplier payments
    − bank/withdrawal entries already recorded

Difference = counted cash − expected cash before closing transfers
```

In the Count cash method:

```
Estimated net cash sales
  = counted cash − opening cash − other cash in
    + cash expenses + cash supplier payments
    + bank/withdrawal entries already recorded
```

UPI/card sales are recorded separately and never increase physical cash. Unpaid credit sales contribute to recorded sales, but not cash. Collection of older customer dues or owner top-ups is **Other cash in**, not today's sales. Digital expenses and supplier payments are recorded with **Paid from → UPI / bank / card** and do not reduce the galla.

Enter customer sale amounts after returns, **including any tax charged**, using the same convention consistently. For cash, use money received for today’s sales; for digital, use the customer sale amount rather than a payout net of fees. Do not use a tax-exclusive revenue figure to reconcile tax-inclusive cash receipts. Sales values are nonnegative; negative-net-sales days, itemized refunds, GST reports, credit balances and payment-settlement reconciliation are outside this cashbook change. These summaries are not profit calculations or statutory revenue reports.

## Count first, then remove cash

At closing:

1. Enter the physical cash count **before** removing any additional money.
2. Review the sales estimate or cash difference. Recorded-sales methods require a note for a shortage/surplus.
3. Enter cash actually being removed for the bank and/or taken home now. Do not repeat transfers already entered during the day. A future plan remains zero until the money is removed.
4. Hishob shows **cash kept for next day** and carries that remaining amount into the next opening.

Closing transfers are cash movements, not expenses, and cannot exceed the counted cash. The saved expected/actual closing cash both represent cash **remaining after** these closing transfers; their difference is unchanged. The original count and both transfers are saved separately with the closing snapshot and audit.

Example: opening ₹1,000, cash expenses ₹500, count ₹5,500 means estimated cash sales ₹5,000. Digital sales ₹2,000 and credit sales ₹300 bring the day's sales to ₹7,300, including the cash estimate. Removing ₹3,000 for the bank and ₹500 for home leaves ₹2,000 for tomorrow. None of these transfers reduces sales or becomes an expense.

## Monthly reports

Open **Hishob → Calendar & sales** and change the month. The report shows:

- Total sales, with **recorded sales** and **estimated cash sales** separate.
- Cash, UPI/card and unpaid-credit sales.
- Sales without a payment breakdown, included in recorded sales and the overall total but not assigned to any payment type. The report identifies how many billing days could not be reconciled. A missing breakdown is never interpreted as zero sales.
- Expenses, supplier payments, bank transfers and withdrawals.
- Closed days included, open days excluded and dates not started. Not-started dates may be shop holidays; they are not assumed to have zero sales.

Only the current version of each closed day counts. Reopening immediately removes that day from the report until it is closed again. Earlier snapshots remain accessible but are never counted twice. Business dates use the shop's timezone. A mixed month can contain all three methods; only the cash-sales portion of Count cash days goes into the estimated subtotal.

## Compatibility, permissions and APIs

- Settings: `hishob_mode = ENTRIES | COUNTED | BILLING` on the existing shop-settings API. Only the owner can change it.
- New days copy that setting. Historical records without a mode are read as `ENTRIES`; no bulk rewrite is required.
- Existing transaction API adds `DIGITAL_SALE`, `CREDIT_SALE` and `payment_method = CASH | DIGITAL` for expenses/supplier payments. Cash-sale entries are rejected in Count cash/Billing modes to prevent counting sales twice.
- Close API accepts `cash_sales` (Billing only), `digital_sales`, `credit_sales` (Count cash/Billing), `closing_bank_deposit`, and `closing_withdrawal`. `actual_closing_cash` in the request remains the physical count; the response's `actual_closing_cash` is the retained cash after closing transfers, with `counted_cash` preserving the input.
- Billing close additionally accepts `billing_input = SPLIT | TOTAL` (defaults to `SPLIT` for existing clients). `TOTAL` requires `total_sales`, forbids `cash_sales`, and optionally accepts **both** `digital_sales` and `credit_sales`. Omitting both preserves unknown payment amounts. `SPLIT` and non-billing methods reject `total_sales`. Responses/snapshots include `billing_input` and `unallocated_sales`; monthly summaries include `unallocated_sales` and `unallocated_days`.
- `GET /api/shops/{shop_id}/hishob/monthly-summary?month=YYYY-MM` returns decimal-string totals and coverage counts. Owners and managers with live Hishob access can read it; workers and other shops cannot.
- Transaction search cash-in/out totals exclude digital and credit movements. Search covers transaction entries; totals and transfers entered on closing are shown in day details and monthly reports.
- Integer-paise arithmetic, optimistic revisions, transaction idempotency, soft deletion, audit snapshots and owner-only reopening remain in place. Closing transfers replace the previous closing allocation on a correction; they are not appended again.
- Reopening preserves the last count/allocations for review and pre-fills sales from the preserved closing. New totals must be confirmed on close. Already-carried openings on later days are unchanged; correcting those still requires an explicit reason.

No new environment variables or database collections are needed. The existing unique shop/date index supports day and month queries.

## Files and validation

Calculation rules: `backend/app/cashbook.py`. API/schema updates: `backend/app/{financial_schemas,schemas}.py`, `backend/app/routers/hishob.py`. Mobile: shop settings, financial types, closing form, day overview, breakdown, calendar/monthly summary and search explanation. Tests: `backend/tests/test_cashbook_modes.py`, `mobile/e2e/cashbook.spec.ts`, plus existing regression suites.

Use the run commands in the root README. Select a method **before creating today's day**; the current open day intentionally keeps its original method. Test expenses paid by cash/digital, a cash shortage in billing mode, bank/home removals, monthly totals, and reopening/correcting a closed day.
