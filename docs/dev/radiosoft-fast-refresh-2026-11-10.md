# RadioSoft refresh repair and faster daily reads

Reviewed against `5b1a7f3` after the Copilot changes. This patch preserves the new UI, DEV collection behavior, authorization, shop/source bindings, credentials and durable connector stream. No shop PC, SQL permissions, live service, deployment or production data was modified.

## Shop-PC evidence update (10 November 2026)

The inspected PC is running healthy **0.1.0**, not this candidate. Its engine does not request commands, and its nine-key health checkpoint was accepted. The command-path and oversized-health defects below describe the later repository source; they are **not established causes of the installed PC symptoms**. The public DEV schema still advertised a ten-key limit at inspection. A separate RadioSoft printing timeout remains unexplained. **Do not install the faster polling build until printing/load qualification is reviewed.** See [the evidence findings and ordered handoff](radiosoft-shop-pc-handoff-2026-11-10.md).

## Confirmed repository defects

1. `RealEngine.tick` posted `command`, but `HttpTransport` rejected that path before making an HTTP request. The uncaught `ValueError` could stop the Windows service. The real transport now explicitly allows command; synthetic transport still refuses it.
2. Health uploaded the entire expanding checkpoint. The backend limited coverage to ten keys; recent-scan state could exceed that and return HTTP 422, moving the connector to INCOMPATIBLE. The new connector sends a small diagnostic summary without fingerprint maps; the backend also accepts legacy checkpoints up to 32 keys.
3. Background reads were spaced by 60 seconds. Manual refresh checked only the single newest invoice per scope. Bills then waited for 15-second app polling. Multiple new invoices or edits behind the newest invoice could remain missing from the active view.
4. Refresh issuance used a read followed by an unconditional update, allowing concurrent callers to replace each other's request. It now uses compare-and-set and returns the shared pending request.
5. The app's initial Today date never changed at midnight. Today now tracks the shop timezone; explicitly selected dates and open forms are retained.
6. The synthetic backend had also switched to numeric pairing codes while its connector store still required 32 characters. The store now uses the existing shared short/legacy-code normalizer.

## New behavior and limits

Connector **0.3.0** checks the five newest bills in one firm/type scope per fast pass, with a five-second pause after a pass. Scopes rotate; an owner refresh starts a complete rotation. Both header/item rereads and strict source qualification are retained. Stable records are fingerprinted; unchanged windows do not continually fill the outbox. A three-sale burst and an edit to the second-newest bill are covered by tests. Older invoices and backlog beyond this window still depend on the bounded background sweep, which runs separately at a one-minute cadence. No missing row is interpreted as deletion.

A fast pass allows at most 100 reader queries / ten seconds before another query is refused; one in-flight query can add its existing ten-second timeout. Connection establishment and permission checks precede that reader budget. Background reads retain their original 20-second budget. Connection/source failures back off up to 60 seconds. The source remains SELECT-only; no NOLOCK, trigger, schema, permission or vendor database changes were added. **Actual SQL timings/load still require PC qualification before this build is installed.**

Delivery drains a bounded ordered burst (up to ten observations, stopping at failure/backoff or a two-second between-request budget). One in-flight HTTPS request retains its existing eight-second timeout. Exact bytes, sequences, durable receipts and queue order are preserved. A refresh is completed only after its captured observations have been acknowledged. It is a latest-window check, not proof that the full day/history is imported or a bill is final.

The focused app polls imported bills every three seconds and status every five seconds. Manual PC refresh displays arriving server data during its bounded wait and reports a source failure promptly. Connection settings show connector version and a redacted source error/SQLSTATE. The app does not infer a live PC is offline from an old status before attempting the authorized request.

This is faster bounded polling, **not an instantaneous or perfect/final event feed**. Total latency includes RadioSoft's save boundary, scope rotation, SQL time, queue backlog, HTTPS/server availability, and app polling. Do not promise a fixed end-to-end SLA before measuring these on the real PC. Same-Wi-Fi membership is neither required nor sufficient: SQL stays local to the PC, and the connector/app communicate through the authenticated HTTPS backend. Never expose SQL Server to phones/the internet to reduce this delay.

## Compatible DEV rollout

0. Investigate the reported printing timeout and qualify the candidate read workload before enabling faster polling on the shop PC. After-the-fact idle SQL samples do not clear this gate. Backend/mobile preparation can proceed separately.
1. Deploy the backend schema/refresh fix **first**. It accepts existing and new connector health bodies. Existing credentials remain valid; no data migration or re-pairing is needed.
2. Deploy the mobile update through the existing dev project (`hisab-mobile`, branch `dev`). This alone cannot update the installed Windows reader.
3. Build **0.3.0** on qualified Windows x64/Python 3.12 using the locked dependencies and `connector/windows/Build-Release.ps1 -Python $python -RealDev`. Run the Windows/DPAPI/SCM tests and PowerShell parser checks there; this macOS task cannot certify them.
4. Review/sign the release manifest and run the packaged `Upgrade-DevService.ps1` during an agreed DEV maintenance window. It stages versioned binaries, updates only the existing service binary path, preserves account/delayed startup/ProgramData state, and restarts only if previously running. Retain the previous executable path for rollback. Do not use init, reinstall, cancel-pair, revoke or re-pair on a working installation.
5. **Skip recovery on the inspected PC: it is RUNNING with no health error.** If a different/later inspection shows the old connector is specifically stuck at mode `INCOMPATIBLE`, error `HEALTH_HTTP_422`, stop the service and run the new executable's `resume-health` command, then start the existing service. This explicit recovery confirms the new health payload with the server before clearing that one blocked mode; it refuses other failures or changed bindings and leaves credentials/queue/sequence untouched. An actual SQL, observation or acknowledgement error requires diagnosis, not this command.
6. Check the installed service's version (`0.3.0` in app connection diagnostics), queue drain, error state and source-read timestamp. Measure several ordinary, authorized sales/edits against their appearance in Hishob. Compare full bill keys and values without modifying vendor data for a test. If load/timings are unacceptable, stop and review the read plan/index evidence; do not weaken reads or reset state.

Rollback: stop the service, restore its previously recorded binary path, retain all ProgramData files, then restore the previous running/stopped condition. The older UI/backend can be rolled back independently only after accounting for the new optional health fields; keep the compatible backend while a 0.3.0 connector runs.

## Prompt for the shop-PC assistant

Inspect the working HishobRadioSoftDev installation read-only. Do not reinstall, re-pair, restart services, change SQL permissions, or delete/edit connector state. Report:

- Running executable path, manifest/package version, service state, startup type, Windows account and recovery settings.
- Redacted status: mode, source_error/SQLSTATE, pending observations, last source read, last upload, acknowledged sequence and cursors. No codes, credentials, customer data or bill contents.
- SQL Server/ODBC versions, PC timezone/clock accuracy and existing HishobDevReader qualification/permission evidence.
- Existing evidence of ordinary RadioSoft save-to-read latency and whether header/items are committed together. State unknowns; do not invent final-save guarantees.
- Existing redacted errors around Refresh from shop PC, distinguishing SQL permission/timeouts from HTTP 422. Existing query timing/index evidence for the reviewed Invoice key/date queries is useful; do not run broad/heavy scans or change indexes.

Return findings and unknowns without making changes. Record timestamp and timezone with observations. The initial inspection has now been received; use the linked handoff for the remaining printing/load investigation instead of repeating it.

## Validation performed

- Backend real RadioSoft + usability tests: **19 passed** against isolated loopback MongoDB.
- Full connector suite: **91 passed, 3 Windows-only tests skipped**. After adding read-duration/query metrics and version metadata, real/fast tests passed again (**18 passed**); the additional automatic-cadence test brings the focused fast-refresh file to **6 passed**.
- Real RadioSoft browser workflows: **3 passed**. Includes arrivals without navigation, DEV collection regression, access rejection, owner refresh acknowledgement, source failure diagnostics, shop-midnight rollover and retention of an explicitly selected date.
- Mobile TypeScript, ESLint, repository formatting, and Hindi/Marathi translation coverage: passed. Deployment-config tests: **53 passed**. Development PWA export prepared locally; no publication.
- Python lint and changed-file formatting: passed. Whole-tree Python formatting also reports pre-existing formatting differences in `backend/tests/test_flow.py` and `backend/tests/test_staff_profiles.py`; those unrelated edits were left intact.
- A first browser attempt was interrupted across a long machine/session suspension; another stale test still navigated to Account after the entry had moved to Home. The updated tests passed on the isolated rerun. The initial connector regression run also exposed the synthetic short-code validator mismatch, now repaired and covered by the full-suite pass.

Not performed: Windows executable build/signing/PowerShell execution, live SQL timing, service installation, live connector recovery, actual cashier save-boundary validation, deployment, or production testing. Local status now records `last_capture_seconds` (including connection/qualification) and `last_capture_queries` (reader queries only) to support PC-side measurement.
