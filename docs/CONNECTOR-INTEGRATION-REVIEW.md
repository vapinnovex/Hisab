# Connector development integration review

Reviewed 2–3 November 2026 on macOS. This integrates development source, tests, runbooks and CI only. No commit, push, deployment, production configuration change, Windows installation, RadioSoft connection or data modification was performed.

## Foundation, inputs and preservation

The actual repository HEAD was exactly `64e3c8d26bab3e8b44773fccb89703f6fd638f33`, matching the handoff foundation. The initial tracked/untracked worktree was clean. No applicable root/ancestor AGENTS.md was present; the existing mobile-only instructions were outside the touched scope. Downloads access was denied by macOS; the user then copied both ZIPs into the repository. Those input ZIPs are retained locally and now ignored by Git.

| Input | SHA-256 |
| --- | --- |
| Hishob-Connector-Source-Handoff-2026-11-02.zip | `8a1590370ffccd09363b18b61b306ebbd2f57b0584775abd7d911fac1b718fa4` |
| Hishob-Windows-Connector-0.1.0-Synthetic-2026-11-02.zip | `43c744db08f0fc8ad7a072ee69e1b93c22dea5fd39c6d47b6bf0639b5e5c12a5` |

Archive paths were checked for absolute/traversal/symlink entries before extracting review material outside the repository. All 43 source-manifest entries and 3,092 Windows-manifest entries matched their lengths and hashes. The Windows archive was read for integrity and documentation/script comparison; its executable/runtime files were not installed or executed. Both packaged install/removal scripts match the supplied source bytes. These hashes establish consistency with the supplied artifacts, not publisher authenticity.

`git apply --check` passed. The patch added 37 new files only; after applying, every file matched the source archive's corresponding file byte-for-byte. There were no merge conflicts and no pre-existing file was overwritten. Subsequent repository integration changes are confined to ignore rules, documentation, CI and connector tests. Backend, mobile, existing schema/evidence and local configuration remain unchanged.

## Integrated behavior and review findings

- `connector/` includes the synthetic worker, standalone Windows service/status/local-inspector entrypoints, DPAPI storage, encrypted SQLite outbox, exact-envelope retry and bounded local SQL reader/reconciliation library. Runtime code remains as handed off.
- Real SQL snapshots remain `REAL_LOCAL_ONLY`, upload-ineligible and mapping-unvalidated. The worker imports the artificial generator, not the reader. Queue admission requires a `SyntheticScan` with existing true synthetic provenance. Neither the reader nor its local reconciliation journal has an upload adapter.
- The shipped network transport accepts only literal loopback HTTP with an explicit port, disables proxy environment inheritance and redirects, and only calls pair/observations/health. Remote HTTPS is intentionally unavailable in this release.
- Pairing persists client proof before exchange, accepts authoritative server binding, and refuses a changed binding. The server rechecks the approved owner/shop/source configuration and binds ingestion to the credential. Observation sequencing, exact replay, schema rejection, revocation and retained queue-head conflicts are exercised against the actual API.
- Both schema copies agree with the executable backend `Observation` model. Lifecycle validation also exists in backend model validators; schema equality alone is not a claim that JSON Schema expresses every backend semantic check.
- Item numbers/names use `InvoiceDetails.SLNo` and `Salesman.SLNo/SLName`. Tests retain two people, duplicate rows, renamed/reassigned/missing references and the raw fiscal-year string. The distinct `Invoice.UserID` test value remains billing operator evidence. Header value is recorded once and worker filtering does not multiply it. The full salesperson directory has no upload endpoint; summaries/commissions remain deferred.
- Source changes preserve collection events, SETTLE receipts, NOTE content, CREDIT designation, method allocations and waivers. Source tenders/collection fields are rejected. Cancellation/missing/return evidence does not imply money collection or refunds. Existing manual cashbook, dues and closed-day behavior remain untouched.

The imported `.github/workflows/connector.yml` now triggers for backend contract/auth/config/dependency changes as well as connector/evidence changes. It has Mongo readiness checks, explicit test environments, pinned backend dependency installation, dependency checks, timeouts and concurrency cancellation. Linux runs connector integration plus the selected financial regressions. Windows runs non-integration DPAPI/process/source tests, parses PowerShell scripts without installing, builds an unsigned synthetic artifact and retains it for seven days. **This workflow has not been executed on GitHub in this review.** The Windows job has no Mongo-backed packaged HTTP/GUI test; that remains a separately provisioned Windows gate, not silently counted as covered.

Git exclusions cover the supplied ZIPs, release/build outputs, executable/DLL/PYD runtimes, `_internal`, virtual environments, SQLite state/journals, DPAPI blobs, worker locks, local configuration, credentials/key files, queues and logs. Only source, tests, public synthetic schema/fixtures, documentation and build configuration are proposed for version control.

## Tests actually run in this integration

Tests used a newly created temporary MongoDB 7.0.2 process, bound only to `127.0.0.1` on an ephemeral port, with a new temporary dbpath. The normal local MongoDB/store and application `.env` files were not used. Backend fixtures use random `hisab_test_*` databases; connector fixtures use random `hishob_connector_test_*` databases. HTTP integration uses a temporary loopback Uvicorn server and synthetic records. macOS tests inject the explicit test-only vault; **they do not validate DPAPI or encrypted-at-rest behavior on Windows**.

The final test environment is an isolated temporary Python **3.12.15** venv with `backend/requirements.lock.txt`, `backend/requirements-dev.txt` and editable `connector[test]`. The earlier baseline backend run used the existing Python 3.9.6 environment against the same disposable MongoDB instance.

| Check | Result |
| --- | --- |
| Original connector tests before repository-specific additions | 55 passed, 3 Windows-only skips |
| Final connector suite (including six additional cases) | 61 passed, 3 Windows-only skips; 17.21 seconds |
| `backend/tests/test_radiosoft.py` | 38 passed |
| `backend/tests/test_financial_reliability.py` | 4 passed |
| `backend/tests/test_cashbook_modes.py` | 23 passed |
| `backend/tests/test_dues.py` | 9 passed |
| `backend/tests/test_hishob.py` | 24 passed |
| Selected backend total in Python 3.12 | 98 passed; 126.93 seconds |
| Connector Ruff lint and formatting | Passed; 29 Python files formatted |
| Isolated environment `pip check` | Passed |
| Archive manifests, patch applicability and initial source-tree comparison | Passed |
| Git exclusion probes | All 19 representative archive/runtime/secret/state paths ignored |
| CI configuration and whitespace | Workflow YAML parsed; job/trigger/test-environment structure and new-file whitespace checked |

After testing, no disposable fixture databases remained. The temporary MongoDB process was gracefully shut down with exit code 0 and its port confirmed closed. The normal local database/process was not stopped or modified.

The final additional cases compare the packaged schema to executable backend code; pair two shops with both equal and different source labels and reject source/generation/firm/header/query tampering and allowlist drift; retain CREDIT/NOTE/waiver/receipt records through source changes; and reject a real local-reader snapshot at queue admission. Existing multi-salesperson integration assertions now check the exact number/name pairs as well as totals. The new event-preservation test was corrected to compare persisted GET results on both sides because MongoDB normalizes datetime precision to milliseconds; no backend behavior was changed to satisfy it.

Reproduction with a separately provisioned disposable loopback MongoDB (set `TEST_MONGODB_URI` and `CONNECTOR_TEST_MONGODB_URI` to that instance, not a shared or live database):

```sh
python3.12 -m venv /tmp/hishob-connector-test-venv
/tmp/hishob-connector-test-venv/bin/python -m pip install \
  -r backend/requirements.lock.txt -r backend/requirements-dev.txt -e 'connector[test]'
/tmp/hishob-connector-test-venv/bin/python -m pytest \
  -c connector/pyproject.toml connector/tests -q -ra
cd backend
/tmp/hishob-connector-test-venv/bin/python -m pytest -q \
  tests/test_radiosoft.py tests/test_financial_reliability.py \
  tests/test_cashbook_modes.py tests/test_dues.py tests/test_hishob.py
```

The HTTP test emits two existing Uvicorn/websockets deprecation warnings. Full backend, mobile/browser, Windows execution/build/PowerShell parsing, actual SQL and remote TLS suites were **not** run here. No claims are made about those platforms from the macOS test results.

## Tests reported by the handoff, not repeated here

The original [VALIDATION-RESULTS.json](../connector/handoff/VALIDATION-RESULTS.json) content is preserved, with CRLF normalized to LF. It reports Windows 11/Python 3.12.14/MongoDB 7.0.16 results: 58 connector tests, 38 existing backend RadioSoft tests and three repeated packaged-runtime checks. Its counts overlap; they must not be added together as distinct connector cases. The three packaged invocations repeat the Windows test module; inspection shows its HTTP/GUI test uses `CONNECTOR_TEST_EXE`, while its crash/lock helpers use the source Python interpreter.

The handoff also reports DPAPI, build, lint/format, PowerShell parsing and in-memory ACL construction success. Those are historical claims, not Windows validation performed during this integration. Its report already excludes SCM install, LocalService/other-user ACL tests, logout/reboot/power loss, clean-machine maintenance, live restricted SQL, live lifecycle evidence, remote HTTPS and signed production release.

## Windows installation and recovery review — release blockers

The scripts quote the executable path, request administrator rights, use a distinct LocalService/SID, configure delayed start/restarts and protect ProgramData. Existing service replacement is refused. State initialization requires a new empty directory; corrupt/missing state is not silently reset. Uninstall retains binaries, credentials, identity and queue, and does not revoke the backend token. Same-version reinstall requires matching staged files. These are reviewed source behaviors, not tested service guarantees.

Before any approved install, address these concrete hardening gaps:

1. **Exact payload inventory and path handling:** the installer hashes manifest-listed files but copies entire application directories. Require all copied payload files to be listed, required EXEs to be present, unique normalized safe paths, and rejection of unexpected files. Check every source/staged path component for reparse points, not only listed leaf files and selected roots. Repeat verification on staged payloads before executing `init` or `status`; otherwise unlisted content or a nested reparse point is not covered by current checks.
2. **Existing program-file ACLs:** explicitly validate/reset existing version and child executable/runtime ACLs, not only the base directory. Test denial for ordinary users and unrelated LocalService processes and access for the actual service SID. Machine DPAPI confidentiality relies on those ACLs; it is not a substitute for them.
3. **Service qualification:** install/start/stop and SCM failure behavior under the actual account, startup before login, GUI closure, logout/reboot, kill/restart and delayed-network startup; installer failure at each step; clean reinstall/uninstall/upgrade; preserved exact pending request after binary upgrade. Parser success and a foreground worker test do not establish these results.
4. **State continuity:** disk-full/corruption/power interruption and backup recovery need validation. A stale same-machine backup can retain a valid identity while rolling sequences back. There is no server continuity/recovery endpoint. Stop and preserve state on loss; never delete the queue, roll back state or silently create a new generation. Uninstall must be paired with explicit owner revocation when retiring the connector.
5. **Release authenticity:** review/sign the package and test clean-machine trust/SmartScreen. A ZIP's internal manifest alone is not publisher authentication. The supplied unsigned binary is retained as a review input, not endorsed for installation.

The installer scripts are preserved from the handoff; these findings are explicit release blockers, not silently waived by development integration.

## Source validation and bill edit/delete work remaining

No SELECT-only RadioSoft identity has been validated. Check actual service-account grants, role inheritance, column/object scope, denied writes/DDL/EXECUTE and driver/legacy SQL behavior with the administrator. Current preflight rejects privileged/non-read permissions but is not a complete audit: broad SELECT access elsewhere can still exist, and narrow column grants may not satisfy its object-level SELECT requirement. Do not attempt live writes to prove denial.

Confirm the exact Lalpotu shop/source/firm/type/cutover mapping, schema types, item salesperson lookup, save finality and monetary exceptions against approved existing source evidence. Two identical reads only establish momentary stability. No live mapping, query performance, amount exceptions or real staff names were independently validated here.

The local reconciler is a disabled scheduling library, not a production feed. Add fair recent/historical scheduling and visible scan coverage, benchmark bounded reads, and validate old-bill/item/name-only edits, rekeys, physical deletion/reappearance, same-key reuse, restores and returns with vendor-approved non-production evidence. Failed reads must never infer disappearance; missing/date-moved review is not cancellation. Invoice1/InvoiceDel are not established deletion feeds. Prefer coherent vendor versions/tombstones; polling cannot promise every intermediate event. Hishob collection history must survive every source lifecycle transition.

See [the concrete Lalpotu HTTPS implementation plan](CONNECTOR-HTTPS-PLAN.md) for the next disabled server contract/pairing work, separate real mapper, TLS harness, continuity protocol and approval gates. No real shop IDs or production credentials are invented or embedded by this integration.
