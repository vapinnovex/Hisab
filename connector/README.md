> Real DEV display-only implementation is now available through the separate `real_entry.py` / `-RealDev` build. Follow [SHOP-PC-DEV-SETUP.md](../docs/SHOP-PC-DEV-SETUP.md). The original synthetic service below remains independent; this is not Windows qualification or production enablement.

# Hishob Windows connector 0.1.0 — synthetic preview only

Repository integration review: [tests actually run on macOS and remaining release blockers](../docs/CONNECTOR-INTEGRATION-REVIEW.md). The original [Windows validation results](handoff/VALIDATION-RESULTS.json) and IMPLEMENTATION-REPORT.md below are handoff reports, not Windows checks repeated during integration. The [Lalpotu HTTPS plan](../docs/CONNECTOR-HTTPS-PLAN.md) is future work; it enables no real syncing. Resolve the installer's package/ACL hardening findings before approving a Windows installation.

This separately packaged component uses the existing Hishob RadioSoft foundation. It does not replace the backend, mobile counter or terminal demo. The background worker has no ChatGPT, VS Code, browser or terminal dependency when installed as a Windows service. **SCM installation, logout and physical reboot validation are still release gates; see IMPLEMENTATION-REPORT.md.**

## Two separate paths

| Component | Data and destination | Credentials |
| --- | --- | --- |
| HishobConnector service + HishobConnectorStatus | Built-in artificial bills only, to a fixed `http://127.0.0.1:<port>` isolated development API | Client-generated proof persisted using machine DPAPI before pairing; service-SID/admin-only state ACL |
| HishobLocalInspector | Existing local RadioSoft rows, shown locally; no HTTP, pairing, synthetic queue or ingestion adapter | Current Windows identity, provisioned separately with SELECT-only rights; privileged SQL identities refused |

Real records cannot be selected as a synthetic source in setup. The service does not import the extractor. Remote endpoints, including remote HTTPS endpoints, are deliberately unavailable in this test release. A later reviewed remote release must require HTTPS with certificate verification, fixed authorized origin and explicit migration; never relax verification or allow redirects. Loopback HTTP here is only for artificial data on a trusted development PC. Do not pair a real shop or reuse real IDs in a synthetic allowlist.

## Build

Use Windows 11 x64 and Python 3.12 x64 with Tk. Build dependencies belong in a separate environment, not RadioSoft's directory. From repository root:

```powershell
py -3.12 -m venv connector/.venv-build
connector/.venv-build/Scripts/python.exe -m pip install -r connector/windows/requirements-build.lock
connector/.venv-build/Scripts/python.exe -m pip install --no-deps --no-build-isolation -e ./connector
powershell -NoProfile -File connector/windows/Build-Release.ps1 -Python (Resolve-Path connector/.venv-build/Scripts/python.exe)
```

The script creates three standalone folders, installation/removal scripts, documentation, SHA-256 manifest and ZIP in `connector/dist`. Keep each EXE alongside its `_internal` directory. Python is embedded; an end user does not install Python. Build scripts do not install/start a service. Existing release directories are refused to avoid silent overwrite. Start a new clean build directory for another release. Versions/dependencies are pinned; byte-identical reproducibility and code signing are not claimed. Do not commit executables, runtime databases, DPAPI blobs, logs or release ZIPs.

## Install for an isolated synthetic Windows test

1. Provision a **dedicated local test Hishob API and fake shop**, following the repository's `docs/RADIOSOFT-LOCAL-DEMO.md`. Use the latest backend with SETTLE/NOTE/CREDIT support. Set the synthetic allowlist to fake test IDs only. Bind API and Mongo to loopback. No production `.env` or existing shop data is changed by this package.
2. Extract the release ZIP. Review its scripts/manifest and verify the separately supplied ZIP hash. The unsigned package is a development artifact; a manifest inside a ZIP is an integrity aid, not publisher authentication.
3. From elevated PowerShell in the extracted release: `powershell -NoProfile -File .\Install-Service.ps1`. The installer verifies included hashes, installs under `%ProgramFiles%\HishobConnectorSynthetic\0.1.0`, creates `HishobRadioSoftSynthetic` as LocalService with its own service SID, configures delayed automatic start and failure restarts, and protects `%ProgramData%\HishobConnectorSynthetic`. It creates no SQL users, SQL settings, firewall rules or vendor files.
4. Open `HishobConnectorStatus\HishobConnectorStatus.exe` as administrator. Enter the local test API and owner-issued five-minute pairing code. The proof is generated/persisted locally **before** the first exchange. Confirm the returned shop/source/generation/firm scope in status. The UI cannot edit that binding or redirect an existing credential to a new API.
5. Close the status window. The installed service remains responsible for sync. It sends three fake bill observations every 30 seconds; one ordered delivery is attempted per worker tick. Scenarios include amount changes, multiple salespeople, salesperson-only changes, missing lookup, duplicate/reordered lines, source outage and explicitly synthetic lifecycle changes.

The setup UI is a privileged local administration tool; cashier/manager permissions remain in Hishob. There is no local HTTP administration listener. For non-admin development only, the Python entrypoint supports `init`, `run`, `gui` and `status --state <new-isolated-directory>`; foreground `run` is a development harness, not the installed background-service experience.

## Pairing, freshness and recovery

- Pairing retries use the same encrypted pending code and proof. An expired uncertain exchange stops; cancel it, issue a new owner code, then re-pair. A new token for the **same exact binding** retains sequence/checkpoints/outbox. A changed binding stops for recovery review.
- SQLite FULL transactions commit all observations in a synthetic scan, monotonic sequence and capture checkpoint together. No HTTP precedes commit. Outbox payloads and settings are DPAPI encrypted. A successful receipt is durably stored and its queue head removed in the same transaction. Queue order is never skipped. Capacity is 5,000 pending observations; backpressure stops capture instead of dropping data. Transport receipts are capped to about 10,000; these are diagnostics, not financial audit.
- Retries preserve exact serialized bytes, capture timestamp and sequence. Transport errors, 408, 429 and 5xx back off. A 409 receives three brief exact retries for a possible concurrent backend revision; a continuing conflict stops visibly. A 401/403 stops sending until authorized re-pairing. Schema rejection or invalid acknowledgement retains the head for review. No later sequence is invented to bypass rejection.
- Status shows mode, pairing outcome, service tick, source health, last capture, last accepted sync, delivered source timestamp, pending count and sanitized error. A heartbeat is contact, not a new source observation. Old queued delivery remains stale; historical coverage is explicitly unvalidated. Closing the UI does not stop the worker.
- “Retry unchanged pending request” only advances a transient retry time; it cannot clear a hard conflict. “Export redacted diagnostics” omits codes, credentials, payloads and names; masks source/shop/generation IDs. Do not send state databases to support.
- If state, DPAPI keys or identity anchor are missing/corrupt, stop and preserve them. **Never delete state to repair a sequence error.** The backend has no sequence-recovery endpoint. Re-pairing cannot reconstruct lost checkpoints. Restoring an old same-machine backup can roll sequence back undetectably until a backend conflict; do not restore/resume automatically. Machine migration/backup recovery needs a separately reviewed backend continuity protocol.

## Upgrade and removal

Stop the service and verify it is stopped before a maintenance copy of encrypted state. Such a copy stays on the same protected machine and is not a general restore recipe. Stage a new signed/reviewed version alongside the existing version in Program Files. Verify state schema compatibility and preserve the exact ProgramData directory, machine DPAPI context, service name/SID, API, identity, generation, queue and sequence. Reconfigure the stopped service executable path to the new version, start it and confirm an unchanged pending request drains once. Roll back binaries only while state remains compatible; never roll back the state database.

The 0.1.0 installer refuses an existing service; it reuses an already staged version only when all payload files match the verified package hashes. Automated upgrades and migrations are **not implemented**. The same-version reinstall path is: run the removal script, retain state and binaries, then rerun the same reviewed installer; it validates existing state instead of initializing it. Installer failure may leave staged files or a stopped service: inspect those and resume under administrator review; it never “cleans up” by deleting the outbox. This procedure requires VM validation before deployment.

`Uninstall-Service.ps1` stops/deletes only this service. It retains state and program files, does not revoke a remote token or touch RadioSoft/SQL. Revoke the synthetic connector from the test owner's Hishob screen when retiring it. Delete retained files only under a separately agreed retention/retirement decision.

## Local RadioSoft inspection

Use the separate `HishobLocalInspector` app as a provisioned restricted Windows identity. Enter local instance/database/installed driver, approved firm/type/date range and full existing bill key; FYear is verbatim. One-bill inspection uses explicit bounded SELECTs and rereads the complete header/item multiset. Stable reread is **not** proof of a finalized save. The salesperson button shows the first bounded page of assigned numbers/names locally; the reader API supports keyset continuation. It does not export names, create staff, calculate commissions or upload anything. Connection choices remain in that window; they never configure the service.

No live inspection was executed for this implementation: the available earlier SQL access was sysadmin/db_owner, and no approved SELECT-only identity is present. Driver availability is checked, but live compatibility/performance remains untested. See SOURCE-MAPPING.md for required permissions and source gates.

## Tests

Use an isolated loopback Mongo instance and fake data. The tests create random `hishob_connector_test_*` databases and delete only those databases. Do not point at the real Hishob store.

```powershell
# In a separate test venv, install backend/requirements-dev.txt and connector[test].
$env:CONNECTOR_TEST_MONGODB_URI='mongodb://127.0.0.1:27189'
python -m pytest connector/tests -q
# Test embedded worker runtime after a build:
$env:CONNECTOR_TEST_EXE=(Resolve-Path 'connector/dist/HishobConnector-0.1.0-synthetic-windows-x64/HishobConnector/HishobConnector.exe').Path
python -m pytest connector/tests/test_windows.py -q
```

Tests use the actual unchanged FastAPI API and Mongo, plus a real loopback HTTP server. Windows tests use real DPAPI, abrupt child-process death, SQLite recovery, an OS worker lock, a separate Tk window, hidden worker restart and optional packaged EXE. This does not simulate power loss to storage hardware, SCM account/ACL behavior, logout or a physical reboot. See the report for performed and unperformed checks.
