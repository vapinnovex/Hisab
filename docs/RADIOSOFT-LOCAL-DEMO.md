# Try RadioSoft preview in local Hishob

This tests Hishob with fake bills. It does not connect to RadioSoft or start a Windows service. The existing manual cashbook and accounting stay separate.

1. Start the normal local API and web app and sign in as **Owner** at `http://localhost:8081`. In Account, choose **Create another shop** and create **RadioSoft Demo**. Use this separate shop rather than your actual shop's records.
2. Get the IDs from your local database. On this Mac, run:

   ```sh
   cd /Users/prajwalmac/Documents/GitHub/Hisab/backend
   .venv/bin/python scripts/radiosoft_demo.py ids
   ```

   On Windows, from the backend directory, use `.\.venv\Scripts\python.exe scripts\radiosoft_demo.py ids`.

   The helper prints shop names and a ready-to-copy `RADIOSOFT_PILOTS=...` line for each shop. Copy the line belonging to **RadioSoft Demo**. `shop_id` is the Hishob shop ID; `owner_id` is its creator/owner's Hishob user ID. Neither comes from RadioSoft. The other values are synthetic test settings, not a verified real source mapping.

   Alternatively, while logged in locally, visit `http://localhost:8000/api/auth/me`: use `user.id` as the signed-in owner's ID and the demo entry's `memberships[].shop.id` as shop ID. Do not use the membership's own `id` as shop ID.

3. In **`backend/.env`**, set these values, replacing any existing lines for the same keys:

   ```dotenv
   APP_ENV=development
   RADIOSOFT_SYNTHETIC_ENABLED=true
   RADIOSOFT_PILOTS=[{"shop_id":"COPY_DEMO_SHOP_ID","owner_id":"COPY_OWNER_USER_ID","source_id":"synthetic-installation","firm_codes":[0],"tracking_from":"2026-11-01"}]
   ```

   Use the IDs printed by the helper. There must be **no leading `#`**. `.env.example` is only an example; changing it does not configure the running backend. Keep the rest of your `.env`, including your existing JWT secret, unchanged.

4. Restart the backend, even if it uses `--reload`: environment changes require a fresh process. From `backend` on Mac:

   ```sh
   .venv/bin/python -m uvicorn app.main:create_app --factory --reload --host 127.0.0.1 --port 8000
   ```

   Refresh the web page and select **RadioSoft Demo** using the shop switcher. Home should now show **RadioSoft pilot setup**. Open it, select **Enable synthetic preview**, then **Create pairing code**.

5. In another terminal, from `backend`, run:

   ```sh
   .venv/bin/python scripts/radiosoft_demo.py demo
   ```

   Paste the pairing code when prompted. Input is hidden; press Enter after pasting. The code expires after five minutes. The helper pairs with the local API and sends three fake bills for ₹1,000, ₹750 and ₹1,500. Their references are printed in the terminal. Open **Bills & Collections** in the app and allow about 10 seconds for its next refresh.

6. Try the workflow:

   - Open the ₹1,000 bill. Enter `200` under Cash amount and choose **Record payment**. Outstanding becomes ₹800.
   - Choose **Mark paid without method**. Outstanding becomes zero; the remaining receipt is explicitly unspecified.
   - Enter `800` under UPI amount, enter a correction reason, and choose **Assign entered methods to this receipt**. Collected stays ₹1,000; no second receipt is added.
   - In the helper, type `+` then Enter. The first bill becomes ₹1,200 and shows ₹200 outstanding without losing receipts.
   - Type `-`. The bill becomes ₹800 and shows ₹200 excess requiring review. No refund is invented.
   - `m` flags the first bill as missing; `c` simulates cancellation; `u` restores its source status. These are fake lifecycle examples, not validated RadioSoft detection.
   - `h` reports a source outage. `r` resends fresh observations and a healthy heartbeat.
   - Leave the helper idle for more than two minutes to see stale/offline warnings. The helper deliberately sends only on a menu action, not automatically in the background.

7. Type `q` to exit. In pilot setup, choose **Disable preview and revoke connector** when finished. Test history remains in the separate pilot ledger. A later demo run needs a new pairing code and creates new bill references. Credentials remain in memory and are never saved by this helper.

## Troubleshooting

- **No setup button:** confirm the selected demo shop, exact IDs in `backend/.env`, Owner login, flag enabled, and backend restarted. `RADIOSOFT_PILOTS=[]` enables no shops.
- **401 while pairing:** create a new code. Expired/revoked codes cannot be used. If an earlier helper run consumed a code, use a newly issued code.
- **API unavailable:** check `http://localhost:8000/health`. Start MongoDB and the backend before the helper. It defaults to port 8000; for another local port use `demo --api http://localhost:8001`.
- **Stale/offline:** type `r` in the helper. Page polling refreshes backend data; it cannot make an idle simulated source send new data.
- **Demo cannot reach a remote API:** intentional. This helper accepts only loopback HTTP endpoints for local synthetic testing.

The API, local web dev server and this interactive helper are development processes. The future Windows connector will be separately installed and start automatically; this script is not that connector.
