# Connecting a customer's RadioSoft to Hishob (production)

This is the complete runbook for one new shop. It starts from a shop PC that has **never**
had the Hishob connector, and ends with RadioSoft bills appearing in the owner's Hishob app.

| Who | Does what |
| --- | --- |
| **You** (Hishob team) | download the package, approve the shop, set up the PC |
| **Owner** | registers in Hishob, confirms setup in the app, creates the pairing code |
| **Shop PC** | runs RadioSoft (SQL Server Express + `RsDB`) and the Hishob connector service |

**Production addresses:**
- Backend: `https://hishob-anuj.onrender.com`
- App: `https://hishob-blond.vercel.app`

The production connector can only talk to that backend. There's nothing to type for the server address.

**Time needed:**
- About 15 minutes of your own preparation.
- About 45 minutes at the shop, most of it on the PC.

---

## Part A: one-time setup, before your first customer

Do these once only. Skip this part if they're already done.

1. **The backend switch is on.** On Render, open the prod service (`hishob-anuj`) and go to **Environment**. It must have
   `RADIOSOFT_REAL_ENABLED=true`. It must **not** have `RADIOSOFT_REAL_PILOTS`: if that's
   set, prod refuses to start.
2. **The scope command works from your Mac.** In the repo:
   ```bash
   cd backend
   .venv/bin/python -m app.radiosoft_real_scope --help
   ```
3. **Keep the prod database values in your password manager** (from the Render prod service):
   - `MONGODB_URI`
   - `MONGODB_DATABASE` (`Prod-Hishob`)
   - `JWT_SECRET`
   - `BREVO_API_KEY`
   - `BREVO_SENDER_EMAIL`

   You need them in step C1. Never save them in a file in the repo.

---

## Part B: before the shop visit

### B1. Collect the facts

Fill this in for the customer and keep it in your private records (not in Git):

| Item | How to get it | Example |
| --- | --- | --- |
| Shop name and owner's email | ask the owner | Lakshmi General Store |
| PC is Windows 10/11 **64-bit** | on the PC: Settings → System → About → "System type" | 64-bit operating system |
| RadioSoft uses SQL Server Express | on the PC: Services list shows **SQL Server (SQLEXPRESS)** | yes |
| Firm codes to track | ask the owner; most shops have one firm | `0` |
| Bill types | `0,1` unless the owner says otherwise | `0,1` |
| `source_id` | **you choose**: one per PC, lowercase, never changed later | `lakshmi-pc1` |
| `generation` | **you choose**: one per RadioSoft database, never changed later | `lakshmi-rsdb1` |
| Tracking start date | the date the owner wants Hishob to start tracking from | `2026-12-01` |

### B2. Owner creates their Hishob shop

1. Send the owner the app link: `https://hishob-blond.vercel.app`. They open it on their
   phone and tap **Install** / **Add to Home Screen**.
2. They register with their email, create the shop, and add their Managers and Workers.
3. **Each RadioSoft salesperson must already exist as a Worker** in Hishob. Bill mapping
   never creates staff.

### B3. Find the shop ID

1. Open MongoDB Atlas and go to the prod cluster → **Browse Collections** → `Prod-Hishob` → `shops`.
2. Filter with `{"name": "Lakshmi General Store"}`.
3. Copy the `_id`, a long ID like `14559e70-…`. This is `<SHOP_ID>`.

### B4. Download the Windows connector package

1. On GitHub, open the repository's **Actions** tab, then the **Windows connector preview checks** workflow.
2. Click **Run workflow**, choose the branch **`prod`**, and click **Run workflow**. Wait for it to turn green (about 10 minutes).
3. Open the finished run. Under **Artifacts**, download **`unsigned-preview-windows-packages`**.
   - GitHub deletes this after **7 days**, so save a copy in your own Google Drive / company storage.
4. Unzip it. You need two files from it:
   - `HishobConnector-0.3.0-real-prod-windows-x64.zip`. Use the **real-prod** file, not real-dev or synthetic.
   - `SHA256SUMS.txt`
5. Put both on a USB stick, or share them to the shop PC through Google Drive.

---

## Part C: approve the shop (you, on your Mac, about 2 minutes)

### C1. Create the shop's scope

1. Open Terminal in the repo and load the prod values. Paste them from your password manager;
   don't save them in a file:
   ```bash
   cd backend
   export APP_ENV=production MONGODB_DATABASE=Prod-Hishob
   export MONGODB_URI='<paste prod MONGODB_URI>'
   export JWT_SECRET='<paste prod JWT_SECRET>'
   export EMAIL_PROVIDER=brevo BREVO_SENDER_NAME=Hishob
   export BREVO_API_KEY='<paste>' BREVO_SENDER_EMAIL='<paste>'
   ```
2. Preview the scope. This writes nothing yet:
   ```bash
   .venv/bin/python -m app.radiosoft_real_scope create \
     --shop-id <SHOP_ID> --source-id lakshmi-pc1 --generation lakshmi-rsdb1 \
     --tracking-from 2026-12-01
   ```
3. Check what it prints:
   - `Database: Prod-Hishob (APP_ENV=production)`
   - the right shop name and owner email
   - the dates: by default, capture starts on the tracking date and ends **2 years later**
     (`capture_until` is exclusive). The end date can't be changed after pairing.
   - Add `--firm-codes 0,1` or `--invoice-types 0` only if the owner asked for something
     other than the defaults.
4. If everything is right, run **the same command again with `--yes`** at the end. You should see
   `Saved. The owner can now open Connection settings in the Hishob app.`
5. Check it:
   ```bash
   .venv/bin/python -m app.radiosoft_real_scope show --shop-id <SHOP_ID>
   ```
   It should show `"revoked": false` and `"paired": false`.

**If it refuses, here's why:**

| Message | Meaning |
| --- | --- |
| `No shop with that ID` | wrong ID, or you're connected to the wrong database |
| `not an active owner` | the shop's creator was removed as owner; fix that in the app first |
| `already has a scope` | this shop is already approved; use `show` to check it |
| `Dates must satisfy …` | the capture start is after the tracking date |

---

## Part D: at the shop, set up the PC

Do everything on the shop PC, signed in to **Windows as an administrator**. Keep RadioSoft
closed during steps D2 to D3 if possible, and avoid busy billing hours.

### D1. Copy and check the package

1. Copy `HishobConnector-0.3.0-real-prod-windows-x64.zip` and `SHA256SUMS.txt` to
   `C:\HishobSetup\`.
2. Open **PowerShell as Administrator**: Start menu → type *PowerShell* → right-click →
   *Run as administrator*. Then:
   ```powershell
   cd C:\HishobSetup
   (Get-FileHash .\HishobConnector-0.3.0-real-prod-windows-x64.zip -Algorithm SHA256).Hash.ToLower()
   Get-Content .\SHA256SUMS.txt
   ```
   The two hashes for the real-prod zip **must be identical**. If they differ, stop and download it again.
3. Unblock and unzip it:
   ```powershell
   Unblock-File .\HishobConnector-0.3.0-real-prod-windows-x64.zip
   Expand-Archive .\HishobConnector-0.3.0-real-prod-windows-x64.zip -DestinationPath .
   cd .\HishobConnector-0.3.0-real-prod-windows-x64
   ```

### D2. Create the Windows reader account

The connector runs as its own small Windows user, which can only read RadioSoft.

1. In the same Administrator PowerShell:
   ```powershell
   $pw = Read-Host "New password for HishobReader" -AsSecureString
   New-LocalUser -Name HishobReader -Password $pw -PasswordNeverExpires -UserMayNotChangePassword -Description "Hishob RadioSoft connector (read-only)"
   ```
   Save this password in your password manager under the shop's name. **Don't** add this
   user to Administrators.
2. Allow it to run as a service:
   - **Windows Pro:** press Win+R, type `secpol.msc`, then go to *Local Policies* → *User Rights
     Assignment* → **Log on as a service** → *Add User or Group* → `HishobReader` → OK.
   - **Windows Home** (no `secpol.msc`): skip this. Step D4.5 grants it automatically.

### D3. Give the account read-only access to RadioSoft

1. Create the file `C:\HishobSetup\grant.sql` in Notepad. Replace `SHOP-PC` with this PC's name;
   the PowerShell command `$env:COMPUTERNAME` prints it:
   ```sql
   USE [master];
   CREATE LOGIN [SHOP-PC\HishobReader] FROM WINDOWS;
   USE [RsDB];
   CREATE USER [HishobReader] FOR LOGIN [SHOP-PC\HishobReader];
   GRANT CONNECT TO [HishobReader];
   GRANT SELECT (InvoiceNo,FYear,InvoiceType,FirmCode,InvoiceDate,Time,TotalAmt,DiscAmt,IDisc,GSTAmt,IGSTAmt,TaxAdditional,NetAmt,RoundAmt,ExchangeAmt,AdvAmt,CoupenDisc,LPDiscAmt,CardPayCharges,SLNo,ESLNo,UserID) ON OBJECT::dbo.Invoice TO [HishobReader];
   GRANT SELECT (InvoiceNo,FYear,InvoiceType,FirmCode,InvoiceDate,Num,SrNo,BarCodeID,ItemName,Qty,Mrp,SaleRate,Amount,GST,GSTAmt,IGSTAmt,NetAmt,SLNo,HLNo) ON OBJECT::dbo.InvoiceDetails TO [HishobReader];
   GRANT SELECT (SLNo,SLName) ON OBJECT::dbo.Salesman TO [HishobReader];
   ```
2. Run it with the SQL tool that ships with SQL Server:
   ```powershell
   sqlcmd -S .\SQLEXPRESS -E -b -i C:\HishobSetup\grant.sql
   ```
   - No output means success.
   - "Login failed" means this Windows admin isn't a SQL administrator. Sign in as the
     Windows user that installed RadioSoft, or ask the RadioSoft dealer to run the file.
3. This gives **read access to only these columns**. It never gives write access, `sa`, or
   `db_datareader`.

### D4. Install the connector service

1. In the Administrator PowerShell, still in the unzipped folder:
   ```powershell
   $reader = Get-Credential "$env:COMPUTERNAME\HishobReader"
   .\Install-Service-Prod.ps1 -ServiceCredential $reader
   ```
   - Type the `HishobReader` password when asked.
   - On success it prints `Installed stopped. …`.
   - Windows may show a **SmartScreen** warning because the package isn't code-signed yet.
     Choose *More info → Run anyway* only if the hash in D1 matched.
2. Remember where the program is:
   ```powershell
   $exe = "$env:ProgramFiles\HishobConnector\0.3.0\HishobConnector\HishobConnector.exe"
   ```
3. **Make it start automatically after every restart:**
   ```powershell
   sc.exe config HishobRadioSoft start= delayed-auto
   ```
4. **Common errors:**
   - `Existing service`: the connector is already installed on this PC. Stop here and
     read [Support](#support-what-not-to-do).
   - `Administrator account refused`: you used an admin account. Use `HishobReader`.
5. **Windows Home only:** press Win+R, type `services.msc`, and open **Hishob RadioSoft Connector**. Go to the
   **Log On** tab, re-type the `HishobReader` password in both boxes, and click OK. Windows replies
   "granted the Log On As A Service right".

---

## Part E: connect the shop (owner and you, together, about 10 minutes)

### E1. Owner confirms the setup in the app

1. The owner opens Hishob and goes to **Dashboard → Live RadioSoft bills & collections →
   Connection settings**.
2. Check the screen against your sheet from B1: source, generation, firms, bill types,
   tracking date and capture dates.
3. Tick the confirmation. Optionally allow managers to view, map or collect.
4. Tap **Confirm setup**.

### E2. Copy the PC binding to the PC

1. The owner taps **Show nonsecret PC binding**. It's a short block of JSON with IDs and dates
   only, and no passwords.
2. Send it to the PC by WhatsApp Web, email or the clipboard. Open Notepad, paste it exactly,
   and save it as `C:\HishobSetup\binding.json`. In the *Save as type* box choose **All files**,
   so Notepad doesn't add `.txt`.
3. Load it into the connector:
   ```powershell
   & $exe configure --binding C:\HishobSetup\binding.json
   ```
   No output means success. There's no server address to type, because the prod connector always uses
   `https://hishob-anuj.onrender.com`.

### E3. Pair with the 5-minute code

1. On the PC, open the pairing window:
   ```powershell
   & $exe pair
   ```
   The window **"Connect your shop PC"** opens.
2. The owner taps **Create five-minute pairing code** in the app. They can only make a new one
   every 30 seconds.
3. Type the 8-digit code into the PC window and click **Pair / Retry**.
4. Wait for **"Connected — Pairing confirmed by the server"**, then close the window.

| Window shows | Do this |
| --- | --- |
| **Expired code** | the owner creates a new code; type it and click **Use replacement code** |
| **Connection failed** | check the PC's internet, then click **Pair / Retry** with the same code |
| `Configure the owner-confirmed binding first` | repeat step E2.3 |

### E4. Start the service

```powershell
Start-Service HishobRadioSoft
& $exe status
```

Within about a minute, `status` should show:
- `"scm_service_state"`: running
- `"mode"`: `"RUNNING"`
- `"worker_alive": true`
- `"source_error": null`
- `"pending_observations"`: going down towards 0 on repeated runs

In the app, the status line changes to **"PC read N min ago · last server upload …"**.

---

## Part F: check it works (before you leave the shop)

- [ ] The owner makes 2–3 normal bills in RadioSoft and **prints** them. Printing must be no
      slower than before. Watch for RadioSoft's *"Query timeout expired"*; if it appears, stop the service
      (`Stop-Service HishobRadioSoft`) and contact the Hishob team.
- [ ] The bills appear in **Live RadioSoft bills** with the same amounts. Note roughly how many
      seconds each took.
- [ ] Once catch-up finishes, the day's **RadioSoft bill total** matches RadioSoft's own day total.
- [ ] The owner maps each RadioSoft salesperson to their Hishob Worker. Mapping only
      affects **new** bills from then on.
- [ ] **Restart the PC.** Without signing in to Windows, wait 3 minutes, then check
      `& $exe status` shows the service running again.
- [ ] A Worker opens their app and sees only their own attributed sales.
- [ ] Delete `C:\HishobSetup\binding.json` and `grant.sql` (the package folder can stay).
- [ ] Write in your records: the date, package `0.3.0 real-prod`, `source_id`, `generation`,
      the PC name, and where the `HishobReader` password is stored.

The connector **only reads** RadioSoft. Collections recorded in Hishob never write back to
RadioSoft and never post to the galla or customer dues.

---

## Support: what not to do

- **Never** delete `C:\ProgramData\HishobConnector`, reinstall from scratch, re-pair, or
  change `source_id` / `generation` to "fix" an error. The queue and sequence must be
  kept. Stop the service and contact the Hishob team.
- **Stop a customer:**
  1. The owner taps **Stop and revoke connector** in the app, or you run
     `python -m app.radiosoft_real_scope revoke --shop-id <SHOP_ID> --yes`.
  2. On the PC: `Stop-Service HishobRadioSoft`.
  3. Bring it back later with `restore --shop-id <SHOP_ID> --yes`. The PC resumes from its queue.
- **Upgrade the connector** with `Upgrade-Service-Prod.ps1` from the new package, run as Administrator.
  Never use Install, `configure` or `pair` again on a working PC.
- **Changed the HishobReader password?** Update it in `services.msc` → *Hishob RadioSoft
  Connector* → *Log On*, or the service won't start.
- **New PC or reinstalled Windows:** this needs a reviewed move. Don't copy the
  ProgramData folder to the new PC yourself.
- **Before the capture window ends** (2 years by default), contact the Hishob team. The window
  can't be edited on a paired PC.

| Symptom | Check |
| --- | --- |
| App shows **PC is disconnected** | the PC is off, or has no internet; `Get-Service HishobRadioSoft` |
| `status` shows a `source_error` | SQL Server stopped, or grants missing; redo D3 |
| No RadioSoft card in the app | the shop isn't approved (`show`), it's revoked, or the owner isn't signed in to that shop |
| `pending_observations` keeps growing | internet or backend outage; it retries by itself, so don't delete anything |
