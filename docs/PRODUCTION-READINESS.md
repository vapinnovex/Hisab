# Production readiness review — 4 October 2026

This is a repository review, not a verification of deployed infrastructure. The changes in this branch do not make the application ready for an unattended public rollout.

## Implemented in this change

- Shop settings can disable attendance for the whole shop. The API rejects attendance reads and writes for every role, including the owner, and blocks station scanning/enrollment. Attendance tabs, dashboard counters, and team attendance links are hidden. Saved attendance, open shifts and face templates are retained. Re-enabling restores the previous face/manual configuration.
- Attendance settings show Manual attendance and Face scan. The manual choice switches off face mode immediately; ordinary settings use Save changes. Face scan opens the existing supervised-use setup and only becomes active after its explicit enable step. Switching methods requires saved settings.
- Face setup shows progress for enabling scanning, approving a device, and enrolling eligible active employees. Owners retain manual fallback in face mode; managers must use scans.
- Account → Help & support is available to all signed-in roles. Phone: +91 90224 45933. The requested hishob.support@gmail.com is displayed as inactive, with no email action, until the mailbox is created and tested. No ticket service or response-time promise is implied.
- New UI text has Hindi and Marathi translations.

## Release gates

| Priority | Finding/evidence | Required before release |
| --- | --- | --- |
| P0 | Face matching has no liveness/anti-spoofing or geographic enforcement (`docs/FACE-ATTENDANCE.md`). | Keep the station supervised. Complete a real camera/device pilot covering false matches, rejected matches, low light, duplicate enrollments, latency, cold starts and interruptions. Unattended face attendance needs additional verified controls. |
| P0 | Development email exists; production guards reject it (`backend/app/config.py`). | Verify deployed APP_ENV, strong JWT secret, Brevo sender/delivery, exact browser origins, HTTPS and face-template encryption/model configuration. Do not share secret values in issue reports. |
| P0 | No backup/restore runbook or restore-test evidence was found in the repository. | Define MongoDB backup frequency, retention, access and restore procedure; test a restore. Back up the face encryption key securely alongside recovery procedures. |
| P0 | No deployed alerting/error-monitoring evidence was found. `/health` checks MongoDB. | Add operational monitoring for errors, latency, database availability, email failures, inference capacity and storage. Redact credentials, codes, face images and sensitive financial data. Assign an incident owner. |
| P0 | Account screens contain no account-deletion or data-export workflow; no published privacy/retention page was found. | Define and publish privacy/biometric handling, retention and deletion policies; implement a verified request process. Review applicable release and store requirements before distribution. |
| P1 | PWA icon assets are both 1254×1254, while the manifest declares 192×192 and 512×512. | Export correctly sized assets and rerun PWA installation checks. See `docs/PWA-PILOT.md`. |
| P1 | Native JS bundling is documented, but signed native builds and real-device acceptance are unverified. | Build release binaries and test secure storage, calls to support, navigation, small screens, accessibility, offline recovery and session expiry on supported phones. |
| P1 | The proposed support mailbox does not yet exist. | Create and verify the mailbox, set availability/response expectations, and activate a tested mail action. Suggested spelling: hishob.support@gmail.com if available, or support at a domain you control. Neither address availability nor domain ownership was checked. |
| P1 | CI exists (`.github/workflows/ci.yml`) but no deployment/rollback evidence was found. | Establish staging, release ownership, deployment validation and rollback steps. Include translation and PWA checks in the release gate. |
| P2 | Attendance events accumulate in the attendance document (`docs/FACE-ATTENDANCE.md`). | Measure document growth and design archival before approaching MongoDB's document size limit. Load-test scan throughput on the chosen hosting plan. |

Existing strengths include live backend role/shop authorization, revocable sessions, Argon2 password hashing, HttpOnly web sessions with origin checks, encrypted face templates, revision checks and idempotent financial writes. These protections do not replace deployment and recovery validation.

## Validation for this change

- Full backend suite: **155 passed** against real MongoDB, including disabled attendance and paired-station recovery tests.
- TypeScript, ESLint, Prettier, Ruff lint/format and Hindi/Marathi translation coverage passed.
- Follow-up verification: all **6 focused browser tests passed**, covering the original Home layout at small/large widths, shop settings, attendance disable/re-enable, support contacts, enrollment and face scanning. Three backend attendance regression tests also passed, including the full settings form payload and new/legacy manual defaults. The initial browser run had been blocked by an Expo bundle timeout; the later focused run completed successfully.
- The local development API had been serving an old schema without `attendance_enabled`, causing extra-input validation errors. It was restarted and its live OpenAPI schema verified to accept the field with default `true`. The mobile app also defaults missing attendance settings to enabled.
- No deployed infrastructure, signed native release, physical-device behavior or live support mailbox was verified.
