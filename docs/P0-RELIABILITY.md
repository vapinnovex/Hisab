# P0 reliability

## Loading and recovery

History days, monthly summaries, missed-day context, customer dues, and today's
payment context have named loading states and explicit Retry buttons. Requests
still time out after 15 seconds. A failure stops initial loading; a failed refresh
keeps data from the same query and labels it as potentially outdated. Data from a
previous month or search is not presented as the current result.

History pull-to-refresh updates both the days and monthly summary. Reconnect and
app-resume events skip requests already in flight. Automatic reconnect refreshes
are limited to once per five seconds when an endpoint is unavailable, preventing
mixed successful/failed endpoints from triggering a request loop. A real offline
to online transition still triggers recovery immediately. Explicit retries and
normal polling remain available.

## Save recovery

New transaction, customer payment, and closing forms offer **Check saved result**
after an error. This performs a GET request, not another write:

- Transactions and payments look for their original request ID on the saved day.
- Closing checks the day's current status and opens its details if it is closed.
- If the change is not confirmed, the form remains open with guidance.
- Closing also provides **Review latest day**, useful after a revision conflict.

Payment forms retain their original receipt date and target day while open, so
background polling across midnight cannot move a retry to another day.

Existing protections remain authoritative: the UI blocks overlapping submissions;
the backend checks revisions, transaction/payment request IDs, actor identity,
and payload reuse. Transactions/payments can retry the same request ID without
creating another entry. Concurrent or repeated closing cannot create two closing
snapshots. No automatic replay of financial writes or offline write queue was added.
A network failure is reported as an unconfirmed result, never a successful save.

## Regression checks

- `mobile/e2e/reliability.spec.ts`: failed and stale reads, late month responses,
  request timeout, failure before saving, lost responses after committing,
  duplicate payment retries, double taps, reload, and conflicting day edits.
- `mobile/e2e/connection-reliability.spec.ts`: bounded reconnect notifications and
  immediate recovery from offline state.
- `mobile/e2e/missed-day.spec.ts` and `cashbook.spec.ts`: older-day closing guidance,
  retained cash, unknown payment splits, corrections, and dues.
- `backend/tests/test_financial_reliability.py`: September 30 closed on October 2
  in entries, counted, billing, and unknown-split billing modes; failed validations
  preserve state; duplicate closing, monthly attribution, and opening carry-forward.
- Existing backend Hishob, cashbook-mode, and dues suites cover concurrent updates,
  duplicate payment/transaction references, permissions, and cash calculations.

Tests use isolated databases and injected network failures. Production hosting and
real-device network behavior still need observation after deployment.
