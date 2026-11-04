# Real-preview financial and attribution policy

The owner-confirmed 4 November rules supersede the 3 November handoff's zero-salesperson uncertainty. SLNo 0 is a normal source identity; absence and unresolved lookup remain different states. Source identities are shop + installation + database generation + source reference. Never identify a worker by name.

## Implemented display semantics

NetAmt is the signed source payable, preserved as a decimal string. No float arithmetic, clamp, exchange subtraction, invoice-type payment inference, receipt, new debt or store-credit issuance occurs. Source monetary raw fields remain visible. SQL `real` is inherently approximate: serializing the observed value preserves what the driver returned and cannot recover precision the source did not store. All imported bills, including historical/zero/unvalidated amounts, remain review-only. Negative values show the absolute customer-owed amount and initially UNSETTLED. Store credit is a liability to the customer, not customer dues or the synthetic ledger's CREDIT remainder designation.

## Authorized settlement design — disabled pending accounting implementation

Future endpoint must require owner or an explicit settlement permission distinct from view/mapping. It must revalidate the live membership, bound bill/customer and source revision on the server. A note or source update cannot invoke settlement. Proposed actions:

| Action | Required intent and evidence | Financial effect |
|---|---|---|
| LEAVE_UNSETTLED | actor, bill, reason, request ID, reviewed source revision; amount acknowledged | Audit only, remaining liability unchanged |
| REFUND_NOW | actor, bill, customer reference, positive exact amount, CASH/UPI/CARD/bank method, external payout reference where applicable, reason, request ID, expected liability revision | Only after confirmed authorized payout: reduce customer liability and record balanced refund/payment accounting |
| ISSUE_STORE_CREDIT | actor, bill, identified customer, amount, reason, request ID, expected liability revision, credit-system authority | Transfer the same outstanding liability into the **one authoritative** store-credit system; no second spendable balance |

Use an immutable settlement journal with source bill/version/digest, actor, timestamp, amount, method, action, idempotency key and linked accounting entry. Atomically enforce `authorized_amount <= remaining_unsettled` with compare-and-swap/transaction on liability revision, unique `(shop, request_id)` and payload digest. Exact retries return the same result; changed payload with the same ID conflicts. Concurrent refund and issuance cannot consume the same amount. External payout is a separate pending/confirmed/failed state machine with provider idempotency and reconciliation; an uncertain timeout cannot be retried as a new payout. Reversals append compensating audit/accounting events; never delete settled history.

Source edits must append source versions without altering settlements. Recompute the proposed customer obligation separately and flag any changed source amount after settlement for reconciliation; do not automatically refund more, reduce issued credit or create customer debt. If source liability falls below settled value, block further actions until authorized reconciliation. The current ingestion already preserves separate settlement/event arrays and flags edited bills with retained settlement history; there is no real settlement writer yet.

Before implementing credit issuance/redemption, obtain vendor/owner evidence whether RadioSoft owns customer credit, its stable customer/account identifiers, issuance/reversal/redemption records, concurrency rules and reconciliation/export API. If RadioSoft is authoritative, Hishob must reference its balance and confirmed transactions; if Hishob is chosen, explicitly disable/coordinate parallel vendor spending first. The present handoff does not establish this. Do not probe additional live tables without authorized narrow scope.

Acceptance gates: payout journal and accounting tests, idempotency/concurrency/dropped-response tests, source edit after partial/full settlement, reversal handling, customer identification, one-authority credit/redemption reconciliation, access tests, and owner accounting review. **None of these financial actions are enabled by this display pilot.**

## Item reporting and allocation

Reports expose each source item row with resolved salesperson and frozen worker mapping. Identical item rows are retained. Multiple people do not multiply header totals. Owner/authorized manager receives one separate adjustment record per bill. A worker sees only their own item attribution; no shared header/customer-owed amount is returned. Collections are excluded entirely.

Current allocation policy is deliberately **UNALLOCATED / UNVALIDATED** for bill DiscAmt, RoundAmt, ExchangeAmt, advances and coupon/loyalty fields. Item NetAmt is labeled a source item amount, not exact net sales or commission basis. Do not publish sums as exact net sales. Exchange reduces the customer payable already; do not charge it to a replacement item's salesperson. Missing numeric inputs remain unknown, not zero. Tests assert duplicate preservation, adjustment separation and absent exact-net-sales totals.

Before exact net sales: establish which item amount includes tax/discount; allocate only validated bill discounts using exact decimal arithmetic, a documented eligible-line weighting basis and deterministic largest-remainder paise rounding. Preserve duplicate rows using an observation-local ordinal (not a claimed stable source line ID). Prove allocated sums plus explicit unallocated adjustments equal the validated bill basis. Returns/exchanges need links to original transactions/salespeople; without them retain an unallocated adjustment. Validate zero/negative eligible bases, all-return bills, mixed salespeople, line edits and historical mapping behavior against vendor evidence. No speculative allocation implementation is activated now.
