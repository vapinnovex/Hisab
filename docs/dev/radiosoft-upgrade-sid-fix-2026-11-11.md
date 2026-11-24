# DEV upgrade SID lookup repair — 11 November 2026

Base reviewed commit: `50056fe6df5f71724c511d8b7fc9b7a6649f982c`.

The upgrade accepted `.\HishobDevReader` but passed it directly to NTAccount.Translate. The repair expands only a leading `.\` to the local computer name for SID lookup. Already machine-qualified names are preserved; nonlocal identities remain rejected. StartName is never assigned or passed to an SCM account-change command. Credentials, queues, sequences, source/generation and pairing are untouched.

The original failure occurs before staging and service stop. Recheck actual PC state before retrying; another attempt may have made changes.

## Tests and CI

`connector/tests/Test-UpgradeDevAccount.ps1` extracts only the production lookup function through the PowerShell AST. It checks shorthand/qualified/case-preserved identities, unchanged service properties and foreign/builtin/unqualified rejection. On Windows it also resolves both forms of an existing local account to its known SID. It never executes the installer or creates accounts. Windows CI runs it under Windows PowerShell.

Other supplied CI failures are repaired: Windows uses Python 3.12.10 x64 (3.12.14 has no Windows entry in the official Actions inventory); two backend tests receive formatting-only changes; synthetic-demo health probes now use their isolated TestClient and correct localhost port instead of an unrelated server. Production demo behavior is unchanged.

Official inventory checked: https://raw.githubusercontent.com/actions/python-versions/main/versions-manifest.json

## Provenance and package retry

This is a source repair, not a Windows artifact built on this Mac. No new commit, CI run or archive hash exists from this local review. Version remains 0.3.0; distinguish repaired packages by exact source SHA and hashes.

1. Commit/push the reviewed patch to dev. Record the new full SHA and wait for required CI, including the SID regression and Windows builds.
2. Download `unsigned-preview-windows-packages` from that exact successful workflow run. Select `HishobConnector-0.3.0-real-dev-windows-x64.zip`. Record repository, SHA, run ID/attempt, artifact identity and archive SHA-256; compare against the included SHA256SUMS.txt from the trusted run.
3. MANIFEST.json must show the new SHA, source_dirty=false, version 0.3.0 and mode REAL_DEV_DISPLAY_ONLY. Builds now also record python_version, github_run_id and github_run_attempt. Verify all payload hashes, including the upgrade script. Internal hashes detect changes but do not authenticate an unsigned publisher.
4. Extract the complete new package into a fresh directory. Do not edit the old package in place or attribute it to the new SHA. If an existing staged 0.3.0 directory differs, preserve and inspect it rather than bypassing verification or deleting connector state.
5. Retain the actual old service binary path and follow the existing qualification/maintenance procedure. Run the new package's Upgrade-DevService.ps1. SCM must retain the original account configuration. No reinstall, init, re-pair or state reset is needed.
6. Verify actual running binary, same account/binding, acknowledgement progress and ordinary bill/printing behavior. This SID repair does not diagnose or fix the separate RadioSoft SQL timeout.

Reviewed local upgrade-script SHA-256: `28a9d22c21c0a8dcd70f18f31ad577497d344d725288549daeb60c047db4e704`. This identifies the script only, not a built package.

## Local validation

- Connector suite with isolated loopback MongoDB: **92 passed, 3 Windows-only skips**.
- Backend CI regression selection: 113 passed; one test had loaded the initial wrong-port assertion before its correction. After correction, the entire affected RadioSoft test file passed: **39 passed** (including both demo tests). The complete 114-test selection was not rerun after that correction.
- Ruff check/format (100 files), diff whitespace and workflow YAML checks passed. Formatting-only test changes have identical Python ASTs to the base revision.
- PowerShell/SID execution, Windows packaging and GitHub CI have not run locally. The new Windows regression must pass before artifact use. No commit, push, deployment or shop-PC changes were performed.
