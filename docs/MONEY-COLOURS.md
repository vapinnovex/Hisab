# Money colours

Financial direction is consistently **from the shop's perspective**, including worker-visible payment history. Colour is accompanied by a sign and/or explanatory text; colour alone never conveys the meaning.

| Meaning | Colour | Examples |
| --- | --- | --- |
| Money received | Green `#145C45` | Cash/digital sales receipts, customer dues collected, staff money returned, purchase payments |
| Money paid out | Red `#A53535` | Expenses, suppliers, salary/advance paid, other money given, withdrawals |
| Pending / unpaid | Amber `#795611` | Customer credit, staff purchases awaiting payment, pending RadioSoft balances |
| Transfer | Blue `#245A91` | Galla cash moved to bank; this is not an expense |
| Reference only | Grey `#53615A` | Notes and reference salary; neither creates a payment |

Selected transaction chips, amount inputs, save actions, transaction/history cards and relevant cash summaries use these meanings. Closing bank/home inputs retain transfer/outflow colours. Deleted/cancelled records use neutral amount styling and explicit cancellation text. A red staff salary entry means the **shop paid**, not that the worker owes money. Unknown balances and total sales are not falsely represented as verified money received. Existing calculations and accounting permissions are unchanged.

Sign out is a red action throughout the app. The Add salary switch uses a white thumb, a distinct grey off track and green on track, with its accessible switch label and checked state preserved. These changes use existing React Native components, without new native dependencies.
