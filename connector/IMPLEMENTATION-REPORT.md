# Windows connector implementation report — 2 November 2026

## Foundation verified

Working branch: `feat/radiosoft-windows-connector`. Original clean checkout lacked the foundation; it was advanced to `f13c9cd`, then the user's newer `dev` was fetched and fast-forwarded to **64e3c8d26bab3e8b44773fccb89703f6fd638f33**. Existing connector work was preserved. No push, merge to a remote branch, deployment, production setting or source-database change was performed.

Read executable schemas/ingest/pairing/health, foundation report, local demo/helper, fixtures/tests and supplied RadioSoft evidence (now under `docs/radiosoft-source-evidence-2026-10-29`). November 2 SETTLE, NOTE, CREDIT, item attribution and source-worker filters are present. The observation/pairing/health v1 contract is unchanged. The copied observation JSON schema is tested for exact semantic equality with the repository schema. Early paragraphs in the foundation report describe the original release; executable code and appended November 2 updates govern current compatibility. This connector does not edit backend/mobile code.

## Implemented

Separate Python package under `connector/`; Windows-specific packaging under `connector/windows/`. SCM host, LocalService/SID install/removal scripts, independent Tk pairing/status UI, separate no-network local-source inspector, DPAPI credentials/state, transactional encrypted outbox, sequence/checkpoint persistence, exact retries, restart recovery, revocation/conflict blocking, synthetic scenarios, bounded read-only extractor with numbered salesperson lookup and a local-only resumable reconciliation library.

The synthetic path calls only the existing three connector endpoints. It never sends owner collection requests in shipped code. Tests act as a fake owner separately to establish that source updates preserve collections and waivers. There is no accounting activation, actual-sales source adapter, remote API option or production deployment path.

## Verification status

The final delivery includes a generated validation result file with exact test counts/build results. Tests are run on this Windows 11 Pro 10.0.26100 x64 PC, Python 3.12.14, against the actual unchanged development API and isolated MongoDB 7.0.16 bound to 127.0.0.1:27189. Mongo and test dependencies are in the task workspace, outside RadioSoft. Test shop/owner IDs, seller numbers/names and bills are artificial; disposable test databases are removed by fixtures.

Standalone runtime testing identified a bundled-Python certificate-policy data dependency that source tests did not expose. Packaging now includes that public policy file when the build runtime uses it; certificate verification is not disabled. The minimal build environment excludes backend development/ML dependencies from the shipping runtime. A Windows process-lock release delay is handled with a bounded two-second acquisition retry; it still refuses a second live worker.

Performed checks include Windows DPAPI roundtrip/tamper and encrypted-at-rest payloads; exact schema compatibility; persistent pairing proof/lost response/expiry; actual backend idempotency and lost acknowledgement; queue ordering/outage/re-pair; stale source versus heartbeat; 409 stop without skipping; synthetic-only/accounting rejection; per-item assigned numbers/names, missing lookups, duplicates/order independence; collection/settlement-waiver preservation on source changes; evidence-based extractor schema; failed/partial read handling; subprocess crash rollback, OS single-worker lock and restart; a separate real Tk status window closes while an HTTP-backed worker continues. Packaged-runtime smoke results are reported separately after build.

**Not performed:** live RadioSoft connection or grant changes, live SELECT-only benchmark, actual save/edit/delete/return sequence, production call, remote TLS, SCM installation/start/recovery under LocalService, least-privilege ACL validation as another account, logout/physical reboot, power failure/storage durability, clean-machine installer, automated upgrade/reinstall, signed release/SmartScreen or code-signing validation. This session is not elevated. No admin/service permission prompt, reboot or SQL mutation was attempted.

## Supported environment and limits

Built/tested runtime target: Windows 11 x64; Python embedded into standalone release. Available SQL drivers rechecked: SQL Server and SQL Server Native Client 10.0, both x86/x64. Earlier evidence reports SQL Server 2008 R2 Express 10.50.4000.0 x64. The local inspector uses optional pyodbc and defaults to Native Client10; exact live handshake and effective SELECT-only permission checks remain untested. Windows10/Server/x86/ARM64 support is not certified. Linux unit tests may use an explicit test-only vault; shipped runtime has no plaintext fallback.

Machine-scope DPAPI permits the elevated setup UI and service to share state; confidentiality depends on the installer restricting state to SYSTEM, Administrators and this service SID. Local machine administrators are trusted. The installer is deliberately conservative, refuses an existing service or differing staged files, preserves state on removal and has no automatic migration. Same-version reinstall can reuse hash-matching binaries and the existing state. A same-machine stale backup can retain a valid anchor while rolling back sequences; no general rollback detection or server recovery endpoint exists. Stop and review rather than silently reset.

See README.md for operations and SOURCE-MAPPING.md for salesperson/amount/lifecycle gaps and the separately reviewed Lalpotu release gates. Source/binary archives are development deliverables; a built EXE does not certify the unperformed SCM/hardware tests.
