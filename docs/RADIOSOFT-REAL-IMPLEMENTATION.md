# Real DEV implementation and validation

4 November 2026. Base revision `7e3737e50434b8802f8bab89cf705357db9ca1ff` plus the accompanying working-tree changes. Existing user changes in `backend/scripts/radiosoft_demo.py`, `mobile/.env.example` and `PC.md` were retained. No production/Render change, live SQL access, shop-PC install, commit or Windows build was performed.

Implemented:

- Separate v2 real-preview schema and `/api/radiosoft/real-connector/{pair,observations,health}`. Explicit deployment scope, authenticated ownership verification, exact setup confirmation, short-lived single-proof pairing, source/generation/firm/type/date checks, revocation and production guards. Real and synthetic credentials/storage are independent.
- Immutable source/sequence inbox with durable pending fence, idempotent materialization and replayable receipts. Source updates append history without replacing event/settlement history. Same labels/full bill keys across shops remain isolated.
- Real mapper, narrow full salesperson-directory read, durable encrypted SQLite queue, exact-byte retry, bound HTTPS origin, certificate/hostname verification, no redirects/environment proxy inheritance, bounded responses, source-read versus contact freshness, fair bounded recent/historical/directory polling with query/time budgets. Negative, zero, NULL and large finite payables remain review-only and do not poison subsequent delivery. SLNo 0 resolves normally.
- Account → RadioSoft DEV screen for owner scope confirmation/pairing/revocation, source health, signed amounts and customer-owed display, explicit worker mapping/audit, and item attribution reporting. Owner or delegated manager may map existing worker memberships. Worker filtering happens on the server; collections and exact net-sales totals are excluded. Mapping is frozen at first accepted bill observation; subsequent mapping changes affect future bills only.
- Separate real executable/service/state path, dedicated local Windows account installer, strict payload inventory and reparse checks, staged revalidation, recursive program/state ACL reset, column SELECT permission checking and real/synthetic build modes. CI now includes real backend tests and a separate real Windows build; CI execution is not claimed here.

Financial settlement design is in [RADIOSOFT-REAL-BUSINESS-RULES.md](RADIOSOFT-REAL-BUSINESS-RULES.md). Refund/credit issuance/redemption and accounting posting remain unavailable. There are no real financial-action routes. RadioSoft's authoritative credit/redemption workflow is not established. Source finalization, deletion, return linkage, restricted-account performance and Windows service qualification remain gates.

## Validation performed

Tests use artificial fixtures and a disposable MongoDB 7.0.2 process bound only to `127.0.0.1:27193`, with random fixture database names. No application `.env`, normal local database, DEV database or live source was used by these tests. Python source checks ran in the existing macOS Python 3.9.6 backend environment; this is **not** qualification of the Python 3.12 x64 Windows package. Connector non-Windows tests use an explicitly test-only vault; they do not prove Windows DPAPI confidentiality or ACL enforcement.

- Backend initial combined run: **102 passed**. Final expanded combined run: **104 passed, one fixture-startup error** (`pymongo._OperationCancelled`, before the existing coupon-discount test body ran). That exact case passed on targeted retry together with seven real tests (**8 passed**). After adding manager-only mapping permission coverage and fixing worker-profile display names, the final real suite passed **8 tests**. These runs overlap and are not additive.
- Final complete connector run: **71 passed, 3 Windows-only skipped**. Includes actual local TLS trusted/untrusted/expired/wrong-host handshakes, lost pairing/acceptance reply recovery with exact bytes after reopening durable state, source/generation isolation, duplicate item retention, zero/absent lookup, query-budget refusal and unchanged failed-page checkpoints.
- Browser workflow: **1 passed (11.6 seconds)** on supported Node 22.23.4 in the isolated temporary source copy. Exercises owner scope confirmation, pairing, negative signed payable and UNSETTLED display, zero-person mapping to an existing named worker, financial-button absence and revocation. It caught a worker-profile lookup defect and a busy-button timing defect; both were fixed before the successful run.
- Ruff lint/format and Git whitespace checks passed. Mobile TypeScript, ESLint and Prettier checks passed on the final mobile source.
- Existing full connector HTTP tests emit two upstream Uvicorn/websockets deprecation warnings.

Windows-only DPAPI/process tests, PowerShell parser/execution, SCM/ACL/driver qualification and package build/signing were not run; `pwsh` is unavailable on this host. See [SHOP-PC-DEV-SETUP.md](SHOP-PC-DEV-SETUP.md) for exact settings, new indexes, build/revision requirements, account provisioning, pairing, verification and stop/revoke steps.

Reproduction (use a separately provisioned disposable Mongo instance, never DEV/production):

```sh
TEST_MONGODB_URI=mongodb://127.0.0.1:27193 python -m pytest -c backend/pyproject.toml \
  backend/tests/test_radiosoft_real.py backend/tests/test_radiosoft.py \
  backend/tests/test_financial_reliability.py backend/tests/test_cashbook_modes.py \
  backend/tests/test_dues.py backend/tests/test_hishob.py -q
CONNECTOR_TEST_MONGODB_URI=mongodb://127.0.0.1:27193 PYTHONPATH=connector:backend \
  python -m pytest -c connector/pyproject.toml connector/tests -q -ra
```

The original repository's Expo startup failed while reading offloaded (`dataless`) node_modules files, with filesystem `ETIMEDOUT`. Browser validation uses a temporary copy of mobile source, fresh `npm ci` dependencies and supported Node 22.23.4. Repository dependencies and application configuration were preserved. All browser API calls use the disposable local fixture server, not Render.
