# Remaining questions — priority order

Inspection: 29 October 2026. Payment authority is settled: Hishob records collections; no RadioSoft payment field proves money collected.

## For the owner

1. **Scope and cutover:** Confirm that source FirmCode 0's type-0 and type-1 bills both belong to the intended Hishob shop. Which business date starts Hishob collection tracking, and how should older bills be treated so already-paid history is not shown as new outstanding debt? FirmCode 1 exists as a lookup but had no Invoice rows.
2. **Existing examples for amount exceptions:** Identify one already-existing printed bill using nonzero source charges, rounding, advances/coupons/loyalty if these occur in your business. We verified one ordinary printed bill and SQL discount/exchange cases. No source payment mapping is required. If these features are unused, explicitly constrain phase one to the validated amount cases.
3. **Corrections/refunds:** Confirm who may record collection reversals/refunds or resolve excess money after a reduced/cancelled bill. The default must preserve collection history and require explicit review. Method-unspecified paid events remain a separate total until classified; they cannot yield an exact cash reconciliation automatically.

## For RnD RadioSoft support/vendor

4. **Saved bill contract:** Are persisted Invoice types 0 and 1 the supported bill sources, and what is the -1/InvoiceNo=0 record? Are drafts/holds/quotations elsewhere? At what point are Invoice and InvoiceDetails complete and committed together? We must import saved bills without requiring tender/payment completion. Confirm InvoiceDate/Time timezone, precision and whether Time changes on edits.
5. **Payable and return contract:** Is customer payable NetAmt or NetAmt plus CardPayCharges for the configured print format? Explain ExchangeAmt, DiscAmt versus IDisc, advances/coupons/loyalty and rounding exceptions. Are returns linked by SalesReturnDetails' full original bill key, and when is the original bill/payable also changed? How are exchange credits tied to returns so Hishob does not deduct them twice? A source return is never presumed to be an actual refund.
6. **Change/deletion contract:** What is the supported meaning/retention of InvoiceDel/NewInvNo/Newinvtype/NewFirmCode and Invoice1/InvoiceDetails1.Deleted? Is there an existing API/export or durable sequence/tombstone feed for committed header/item/staff edits, cancellation, deletion, restore and renumbering—including old bills? Does a bill have an immutable ID across rekeys or same-key reuse? If none exists, can the vendor provide the smallest durable transactional change feed plus a coherent bill snapshot? A modified timestamp alone is insufficient for deletion.

## Precisely missing before/after evidence

Ask the vendor for redacted results from an approved **non-production** database covering one saved bill, an amount/item/staff edit, cancellation, physical delete, restore/recreate, and an old-year bill edited now. For each state provide the full composite bill key, relevant header/item rows, Invoice1/InvoiceDel rows and any event IDs/timestamps; include a return and exchange with source payable before/after. Document transaction boundaries and whether key values change. Include two same-number bills in different years/types/firms to verify scope. No customer names, contact details, passwords or full backup are needed.

If no supported feed or non-production lifecycle evidence is available, phase one can display current source snapshots with explicit missing-source/review states and historical rescans. It must not promise every intermediate edit/delete event or auto-cancel from printing flags.
