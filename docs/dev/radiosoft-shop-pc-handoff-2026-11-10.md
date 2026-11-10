# RadioSoft shop-PC findings and next steps — 10 November 2026

## Evidence retained from revision 2

All ten files matched their manifest SHA-256 hashes. Reviewed the report, status/metadata, archived and current index evidence, collector scripts and execution screenshot. The supplied repository evidence folder was removed at the user's request after recording this summary. Original PC files are unaffected.

- At approximately 20:16 IST, HishobRadioSoftDev was RUNNING, source health OK, no source error, queue empty, sequence and acknowledgement both 8802. This sequence is not a bill count.
- The running executable is **0.1.0**, verified against the archived release manifest, source revision `f92677255cfa4454a74ca144020c6175add83b99`. It runs under the existing dedicated local HishobDevReader account with delayed automatic startup. The prepared 0.3.0 candidate is not installed.
- Old reads are spaced by at least 60 seconds and cycle through scopes/dates. Recent cursor was 8 November and history cursor 2 November; these do not establish complete imports for 10 November. A fresh heartbeat/read timestamp is not proof of current-day completeness.
- The installed old engine does not post the command request. The later repository command-path defect therefore does not establish a cause of this installed service's behavior. Its nine-key checkpoint was accepted; it was not blocked by HEALTH_HTTP_422. Do not run resume-health.
- Public DEV OpenAPI still showed coverage maxProperties=10 at inspection. The compatibility patch deployment is not established. Recheck the actual deployed revision and schema before upgrading Windows.
- SQL Server 10.50.4000.0 Express, compatibility 100, Native Client 10, Windows 11 x64. Existing reader has column-level SELECT grants; no new grants are indicated. Current and archived index metadata each contain 49 rows. Existing lookup timings are not a benchmark of the new latest-five workload.
- RadioSoft showed “Query timeout expired” during printing an existing bill while Hishob refresh was attempted. No contemporaneous blocker/wait evidence establishes the cause. Three later samples at 20:32:40–44 IST showed sleeping RadioSoft/reader sessions, no active matching requests or transactions. This does not rule out earlier contention. Read-only queries can still interfere with printing.
- Header/item final-save transaction boundaries and end-to-end save-to-screen latency remain unknown. Approximately 17.75 seconds between one captured observation and its acknowledgement is not a SQL-query or cashier-save latency measurement.
- Windows Time reported unsynchronized. One public HTTP Date sample was approximately 0.66 seconds behind the PC, so this does not establish a large clock error. Clock repair is a separate task.

Preserve the existing service account, credentials, DPAPI/state files, queues, sequence numbers and exact server binding: source `shop-pc-radiosoft-dev`, generation `rsdb-dev-generation-1`, RsDB, firm 0, invoice types 0/1, capture dates `[2026-11-01, 2026-12-01)`. The capture window needs an explicitly authorized review before December; do not silently widen it.

## What is prepared, and what it solves

The local 0.3.0 source changes repair command transport, health compatibility, concurrent refresh requests, faster ordered uploads, current-day rollover and visible refresh failures. They add rotating latest-five reads, while keeping the background sweep. The app checks imported bills every three seconds while active. Existing authentication and binding checks remain.

These changes have local automated validation, detailed in [the implementation report](radiosoft-fast-refresh-2026-11-10.md#validation-performed). They have not been deployed, built/qualified on Windows, or measured on live SQL. They do not establish a fix for the printing timeout, instant delivery, complete daily imports or final-save detection. Same Wi-Fi is not required: the app and local PC connector use the HTTPS backend.

## Ordered rollout

1. **Now, on the shop PC:** use the prompt below for the remaining print-timeout investigation. Keep healthy 0.1.0 unchanged. Ask for timestamped wait/blocker evidence during a naturally occurring slow print, if it recurs; do not manufacture load or repeatedly press Refresh. If it does not recur, report that and propose a bounded qualification plan rather than claiming resolution.
2. **Return that report here:** review whether the reader contributes to printing delays and whether the candidate SQL workload needs adjustment. Resolve any demonstrated contention before increasing cadence. Absence of a reproduced timeout alone is not a load qualification result.
3. **Repository/backend owner:** review the existing staged changes, retain unrelated work, and publish the reviewed revision through the existing DEV deployment workflow. Deploy the backend compatibility changes before Windows. Verify deployed revision, coverage maxProperties=32, new optional health fields, and the authorized refresh flow. A schema check alone does not verify authorization or the deployed implementation. Keep production untouched.
4. **App owner:** publish the prepared mobile update through the existing DEV app project/branch. Confirm initial-error retry, denied access without protected data, paired owner connection navigation, date rollover and bills arriving without navigation. Updating the app does not update the PC binary.
5. **Windows build owner:** use the reviewed source revision in a separate clean build checkout, Python 3.12 x64 and locked dependencies. Follow `docs/SHOP-PC-DEV-SETUP.md`; build with `connector/windows/Build-Release.ps1 -Python $python -RealDev`, where `$python` is the qualified build interpreter. Run Windows/DPAPI/SCM tests and PowerShell parser checks; verify package manifest, source revision and signing/release checks. Target package: **HishobConnector-0.3.0-real-dev-windows-x64**. Build preparation must not start a second live reader or share a service state directory.
6. **Before installation:** qualify latest-window query duration, complete connection/permission-check overhead, and ordinary printing under the proposed workload. Prefer a suitable nonproduction copy first. Agree a bounded shop maintenance trial with baseline, stop criteria and rollback. Do not treat SELECT-only as proof of acceptable load.
7. **Only after those checks pass:** record the current service configuration and binary path. From the verified extracted package, run `powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File .\Upgrade-DevService.ps1` in an elevated PowerShell during the agreed window. Use Upgrade, not Install/init/pair. The script preserves existing connector state and identity; no re-pairing is required. Do not run resume-health on the currently healthy installation.
8. **Acceptance:** verify actual running binary/version 0.3.0, same binding/account, healthy source, acknowledged queue drain and no sequence regression. Time several ordinary new bills and edits from cashier completion to matching app values; include printing and a small burst. Record median/worst delay and source-read duration. Check manual refresh completion and failed-refresh behavior. Do not create financial actions or vendor test transactions. If printing worsens, new timeouts occur or values mismatch, end the trial and investigate.

Rollback during the maintenance window: stop HishobRadioSoftDev, restore the recorded old service binary path, preserve all ProgramData files and restore its prior running/stopped condition. The inspected old executable was `C:\Program Files\HishobConnectorDev\0.1.0\HishobConnectorDev\HishobConnectorDev.exe` with the `service` argument; re-read configuration before relying on that path. Keep the compatible backend while any new connector runs. Do not restore an old queue/state snapshot over current state.

## Copy this prompt to the shop-PC assistant now

```text
Continue the Hishob RadioSoft investigation using your original 2026-11-10 revision-2 evidence. The Mac repo has prepared 0.3.0 changes, but they are not deployed/Windows-qualified. The actual PC was healthy on 0.1.0 (revision f92677255cfa4454a74ca144020c6175add83b99), empty queue, no HEALTH_HTTP_422. Its old engine does not request commands. Do not attribute later-source defects to that old binary.

First investigate the RadioSoft “Query timeout expired” when printing an existing bill around Hishob refresh. The three later idle SQL samples did not capture the incident. Give me exact numbered steps to obtain bounded, read-only wait/blocker/session/timing evidence during a naturally occurring slow print, using the existing collector if suitable. Recheck current PIDs/account mappings. Do not reproduce by hammering Refresh, run broad scans, export SQL text/customer data, or expose credentials. If it does not recur, state that and propose a bounded load qualification plan; do not claim it is fixed.

Keep the live service, SQL permissions/indexes/isolation/timeouts, pairing, credentials, queues, sequences, source and generation unchanged. No second live connector, reinstall, repair, re-pair, resume-health or faster polling installation at this stage. If observation requires new privileges or service changes, explain the missing evidence instead of making those changes.

Return a concise timestamped report: observed facts, unknown cause, whether any reader blocking was captured, and the proposed Windows 0.3.0 build/load qualification and rollback steps. The backend compatibility patch must be verified before a later upgrade; ordinary printing must be checked before enabling faster polling. Do not execute that upgrade yet. Keep original PC evidence locally; the duplicate evidence folder in the Mac repo has been removed after review.
```

## Final PC handoff received — 21:26 IST snapshot

Reviewed `FINAL-PC-HANDOFF.md` and its seven manifest-listed files; all hashes and sizes matched. The root Markdown copy matches the bundled report. These new local inputs are preserved and ignored by Git so they are not accidentally published with the release.

The service remains healthy on 0.1.0. Acknowledgement advanced from 8802 to 9032; four observations were pending, with sequence 9036. Recent/history cursors advanced to November 9/3. This establishes progress, not current-day completeness. No in-incident capture was obtained. The reported approximately 19:58 IST timeout time is recalled, not machine-captured. No evidence yet identifies a blocking session or establishes a SQL fix. The new bounded incident observer was reviewed as supplied source, not executed here or certified against live SQL.

### Decision

Proceed with DEV backend/app release checks and publication of the reviewed source. Do not treat that publication as clearance to install faster polling on the working PC. The existing runtime changes already address the demonstrated command/cadence gap; no additional SQL or runtime changes are justified by this report alone. Full phase-level timing (connection, permissions, schema, reads and delivery) remains a qualification task; current total capture/query-count metrics do not isolate all phases.

One release preparation defect was corrected: Windows CI installed only pytest beyond build dependencies, but schema tests import Pydantic and TLS tests require cryptography. The CI job and Windows build instructions now explicitly install the versions already pinned by the backend lock. This avoids failing schema tests or silently skipping TLS validation without installing Unix-only backend runtime dependencies on Windows.

### Owner's final sequence

1. Review and commit the intended source/docs/workflow changes on `dev`; preserve unrelated staged work. Do not commit either diagnostic input. No push/deployment was performed by this review.
2. Push the reviewed commit to `dev`. Wait for repository CI, especially the Windows connector job and isolated Linux API tests. Do not install artifacts from a failed run. Record the commit and existing DEV deployments for rollback.
3. In Render, confirm the DEV backend `hishob-dev` successfully deploys that exact commit. Verify the compatibility schema (coverage limit 32 and new optional health fields) and authorized refresh behavior. Preserve pilot settings and existing credentials. Do not change production.
4. In Vercel, confirm `hisab-mobile` builds the same `dev` commit and routes to `https://hishob-dev.onrender.com`, following `docs/VERCEL-ENVIRONMENTS.md`. Auto-deploys may overlap; do not begin acceptance until the backend is ready. Reopen the DEV app and verify the new build. Old Windows 0.1.0 will still import on its old schedule; app deployment cannot make it consume refresh commands.
5. Obtain the exact-commit 0.3.0 real-DEV Windows package from the successful workflow or qualified clean Windows build. Complete package/state compatibility and read-load checks first, preferably with isolated fixtures/SQL. Keep the live PC on 0.1.0 during preparation. If a natural timeout occurs, use the PC handoff's bounded observer and return the incident output; do not delay independent backend/app tests indefinitely waiting to reproduce it.
6. After qualification, agree a short maintenance trial with one reader, baseline printing timings and abort/rollback criteria. Use the package's Upgrade-DevService.ps1, never install/init/re-pair/resume-health for this healthy service. Preserve the old binary path and all current ProgramData. Do not run the new executable as an additional live reader.
7. Accept only after ordinary new bills/edits appear with matching values, queue acknowledgements progress, refresh reports completion/errors correctly, and ordinary billing/printing does not regress. Record actual delays instead of promising instant data. Abort the trial for a printing timeout, sustained reader-root blocking, clear baseline regression or loss of stream progress; restore the old binary using the reviewed rollback procedure and preserve current state.

### Prompt for the Windows assistant after DEV CI/backend are ready

```text
The Mac review of FINAL-PC-HANDOFF.md found no captured incident and no proven SQL cause. Current 0.1.0 was healthy. We have published the reviewed DEV commit; I will supply its SHA and successful CI run/package. First verify those exact identifiers, DEV backend compatibility, package manifest/hash and current service configuration. Do not substitute another commit or the synthetic package.

Prepare and report the remaining Windows 0.3.0 real-DEV qualification: DPAPI/service behavior, state upgrade/downgrade compatibility, complete connection/qualification/read overhead and printing baseline. Use isolated fixtures/SQL first; do not start a second live reader. Keep credentials, queue, sequences, source/generation, binding and capture window unchanged. Do not weaken permission checks, add NOLOCK, change SQL indexes/isolation/timeouts or enable financial actions.

Give me an exact maintenance-window upgrade and rollback procedure for this verified package. Explain any unperformed qualification. Do not install until qualification is reviewed and we start the agreed maintenance trial. Then use Upgrade-DevService.ps1 on the existing service, with one reader only, and verify version, same binding, ordered acknowledgement progress, ordinary bill arrival and printing. Stop the trial for a printing timeout, sustained reader-root blocking, clear baseline regression or stalled/incompatible stream. Never reset/re-pair or restore an old queue snapshot to bypass an error. No resume-health is indicated.
```

Validation after this review: connector non-integration suite **76 passed, 2 Windows-only skips, 17 integration tests deselected**; focused real/fast suite **18 passed, 1 integration skip**. Workflow YAML parsing and `git diff --check` passed. No live SQL, Windows execution, deployment or new backend integration run was performed in this review.
