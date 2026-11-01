# Try RadioSoft preview in local Hishob

This tests Hishob with fake bills. It does not connect to RadioSoft or start a Windows service. The existing manual cashbook and accounting stay separate.

1. Start the normal local API and web app and sign in as **Owner** at `http://localhost:8081`. In Account, choose **Create another shop** and create **RadioSoft Demo**. Use this separate shop rather than your actual shop's records.
2. Get the IDs from your local database. On this Mac, run:

   ```sh
   cd /Users/prajwalmac/Documents/GitHub/Hisab/backend
   ~/.local/share/hishob/backend-venv/bin/python scripts/radiosoft_demo.py ids
   ```

   On Windows, from the backend directory, use `.\.venv\Scripts\python.exe scripts\radiosoft_demo.py ids`.

   The helper prints shop names and a ready-to-copy `RADIOSOFT_PILOTS=...` line for each shop. Copy the line belonging to **RadioSoft Demo**. `shop_id` is the Hishob shop ID; `owner_id` is its creator/owner's Hishob user ID. Neither comes from RadioSoft. The other values are synthetic test settings, not a verified real source mapping.

   Alternatively, while logged in locally, visit `http://localhost:8001/api/auth/me`: use `user.id` as the signed-in owner's ID and the demo entry's `memberships[].shop.id` as shop ID. Do not use the membership's own `id` as shop ID.

3. In **`backend/.env`**, set these values, replacing any existing lines for the same keys:

   ```dotenv
   APP_ENV=development
   RADIOSOFT_SYNTHETIC_ENABLED=true
   RADIOSOFT_PILOTS=[{"shop_id":"COPY_DEMO_SHOP_ID","owner_id":"COPY_OWNER_USER_ID","source_id":"synthetic-installation","firm_codes":[0],"tracking_from":"2026-11-01"}]
   ```

   Use the IDs printed by the helper. There must be **no leading `#`**. `.env.example` is only an example; changing it does not configure the running backend. Keep the rest of your `.env`, including your existing JWT secret, unchanged.

4. Restart the backend, even if it uses `--reload`: environment changes require a fresh process. From `backend` on Mac:

   ```sh
   ./start-local.sh --port 8001
   ```

   Refresh the web page and select **RadioSoft Demo** using the shop switcher. Home should now show **RadioSoft pilot setup**. Open it, select **Enable synthetic preview**, then **Create pairing code**.

5. In another terminal, from `backend`, run:

   ```sh
   ~/.local/share/hishob/backend-venv/bin/python scripts/radiosoft_demo.py demo --api http://localhost:8001
   ```

   Paste the pairing code when prompted. Input is hidden; press Enter after pasting. The code expires after five minutes. The helper pairs with the local API and sends three fake bills for ₹1,000, ₹750 and ₹1,500. Their references are printed in the terminal. Open **Bills & Collections** in the app and allow about 10 seconds for its next refresh.

6. Try the workflow:

   - On the ₹1,000 bill, choose Cash, enter `200` under Receiving now and choose **Record payment**. Outstanding becomes ₹800.
   - Expand the bill and choose **Mark paid without method**. Find the bill in **Settled** afterward. Outstanding becomes zero; the remaining receipt is explicitly unspecified.
   - Choose **Assign payment method** on the unspecified receipt, select UPI, enter a correction reason, and choose **Assign entered methods to this receipt**. The receipt amount is reused automatically. Collected stays ₹1,000; no second receipt is added.
   - In the helper, type `+` then Enter. The first bill becomes ₹1,200 and shows ₹200 outstanding without losing receipts.
   - Type `-`. The bill becomes ₹800 and shows ₹200 excess requiring review. No refund is invented.
   - `m` flags the first bill as missing; `c` simulates cancellation; `u` restores its source status. These are fake lifecycle examples, not validated RadioSoft detection.
   - `h` reports a source outage. `r` resends fresh observations and a healthy heartbeat.
   - Automatic synthetic sync runs every 30 seconds while the helper stays open. Type `p` to pause, then wait more than two minutes to test stale/offline warnings. `r` resumes. `h` also pauses automatic sync so the outage remains visible.

7. Type `q` to exit. In pilot setup, choose **Disable preview and revoke connector** when finished. Test history remains in the separate pilot ledger. A later demo run needs a new pairing code and creates new bill references. Credentials remain in memory and are never saved by this helper.

## Troubleshooting

- **No setup button:** confirm the selected demo shop, exact IDs in `backend/.env`, Owner login, flag enabled, and backend restarted. `RADIOSOFT_PILOTS=[]` enables no shops.
- **401 while pairing:** create a new code. Expired/revoked codes cannot be used. If an earlier helper run consumed a code, use a newly issued code.
- **API unavailable:** check `http://localhost:8001/health`. Start MongoDB and the backend before the helper. Use the port configured for your local web app; pass it explicitly with `demo --api http://localhost:8001`.
- **Stale/offline:** keep the helper open, or type `r` to resume after pausing. Page polling refreshes backend data; it cannot restart a stopped helper.
- **Demo cannot reach a remote API:** intentional. This helper accepts only loopback HTTP endpoints for local synthetic testing.

The API, local web dev server and this interactive helper are development processes. The future Windows connector will be separately installed and start automatically; this script is not that connector.

## Counter workflow

Pending is the starting queue. Search by all or part of the bill number, switch to Settled to find completed bills, or use Needs review for source/amount exceptions. Date & worker filters apply across the entire preview, including paginated records. Latest bill dates and newly received bills appear first; automatic rescans do not reorder old bills. Source worker names appear on each card and per item in details.

Choose Cash, UPI, Card or Split payment and enter **Receiving now**. Use full balance fills the remaining amount explicitly. Any unpaid difference stays pending. For a short payment, owners and managers granted correction permission can choose **Discount remainder**; the amount is calculated automatically and the counter reason is optional. Otherwise keep the remainder pending or mark it as customer credit. For example, on a ₹1,000 bill, collect ₹900 and waive ₹100: the result is collected ₹900, waived ₹100, pending ₹0. The source bill remains ₹1,000. Reverse waiver in bill details requires a correction reason and restores the balance.

Totals are live **synthetic preview** totals for matching observed bills, across all tabs and pages. They do not populate production galla or financial reports. Cancelled/missing/historical/unmapped bills and their retained collections are disclosed separately. Totals are based on bill dates; daily payment evidence is based on receipt dates.

On this Mac, the working Python environment is outside Documents to avoid offloaded dependency files. If a backend is already running, do not start a second copy; stop that process before using `./start-local.sh --port 8001`. This helper is not the Windows connector and still needs its terminal running.

### Updated payment entry

On a ₹1,000 pending bill, enter `900` as Receiving now. Choose **Discount remainder** and record payment (a reason is optional): one atomic save records ₹900 received and ₹100 discounted. Alternatively choose **Customer credit**, enter a customer reference and optional note: ₹100 remains owed. Enter `0` and choose Customer credit to defer the entire bill. **Keep pending** makes no discount and does not explicitly classify the balance as customer credit.

Use the Customer credit tab to record later payments against the same bill. Search now accepts a bill number, customer name or saved note. Open bill contains an additional Bill note field for follow-ups; saving a note does not alter any financial totals. Generic Cash/UPI/Card amount fields no longer appear there. Assign payment method is available only for an unspecified receipt; split inputs appear only on request.

On tablets/desktops the bill queue uses two or three columns when space permits. Use full balance is inside the Receiving now input. Enter an amount or use that shortcut; the 0.00 hint is not a saved/entered payment. Notes and counter discount reason are optional. Customer credit needs a customer/reference, marked Required. If SETTLE or CREDIT is rejected as an unsupported value, restart the backend with the updated code, then refresh the page.
