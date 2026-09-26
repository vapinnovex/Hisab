# Password accounts and recovery

Mobile numbers remain the login identifier for all roles. Staff do not need email addresses. Owners must provide a name and verify a unique recovery email when registering. SMS login and the `/auth/otp/request` and `/auth/otp/verify` endpoints have been removed. Old clients must update.

## Owner

1. Choose Owner, enter the mobile number and Continue.
2. For a new account, enter name and email; verify the email code and set/confirm a password.
3. Create a shop as before. On later visits, enter the mobile number and password.
4. **Forgot password?** sends a code to the registered email. Verification sets a new password, signs out other devices and preserves the account and all shops.
5. **Account → Password & security** changes a known password, after checking the current password.
6. **Account → Change mobile number** checks the current password and a code sent to the recovery email. It changes the login identifier; it does not prove possession of the new phone. No SMS is sent. The number must be unused, and other sessions are revoked.

## Worker or manager

1. Owner adds their name and mobile number. A manager may add workers if permitted.
2. In **Team → Password access · [name]**, choose **Generate setup code**. Give the displayed code directly to that person after confirming their identity. It is shown once, expires after 24 hours, and can be regenerated if lost.
3. The staff member selects their role, enters the added number, then supplies that code and a new password/confirmation. The server checks active membership and the issuer's live authority before accepting setup.
4. Subsequent logins show the password field.
5. **Forgot password? → Request password reset** flags the account in Team. A request alone does not change the password or end sessions.
6. Owner opens Password access, approves or declines the request, and shares the new code after approval. Approval immediately invalidates old sessions and blocks the old password. The staff member uses the code to set a new password.

Checking that a number exists does not authenticate its holder. The owner-issued code prevents someone from claiming an account simply by knowing the number. It is an invitation/approval code, not an SMS OTP or a permanent password. Never put it in group chats. Its hash, expiry, issuer, shop, membership and account version are stored; the raw code is not.

**Shop settings → Managers can approve worker password resets** defaults off. Enabled managers may reset workers only; they cannot reset themselves, peers, owners, or accounts with active manager memberships elsewhere. Managers allowed to add workers can issue initial setup codes for workers without an existing password. Owner accounts cannot be reset through a staff membership, even if the account also works in another shop; use owner email recovery instead.

Passwords belong to the global User, not individual shops. Changing one signs out all that user's sessions across shops. Existing login limits remain: one worker/manager session, three owner sessions. Membership activation and live shop permissions still gate access.

## Existing accounts: no data deletion or automatic takeover

- A signed-in legacy owner without a password is guided through recovery-email verification and password setup before continuing. Their user ID, shops, staff, attendance and cashbook remain unchanged.
- Legacy staff use the same owner-issued setup flow. Issuing the code revokes any legacy sessions for that account.
- A logged-out legacy owner without a recovery email cannot safely claim the old account using only its mobile number. The operator must verify their identity separately, then run this **only for the verified legacy owner** from `backend/`:

```sh
source .venv/bin/activate
python -m app.enroll_owner --mobile +919876543210 --email owner@example.com --identity-checked
```

This links a recovery email for an owner without a password/verified email; it does not set a password, send mail, or log them in. They must then complete **Forgot password?** by verifying the email code. The command refuses staff-only accounts and already-migrated owners. Do not run it against an unverified request.

## Email configuration

Install the updated backend dependencies (`pip install -r requirements.txt`) and restart the backend. No mobile environment changes are required.

Development:

```dotenv
EMAIL_PROVIDER=dev
DEV_OTP=123456
```

The development email code is shown in the app; no email is sent. Staff setup codes remain random, even in development. `OTP_PROVIDER` is obsolete and ignored.

For real email, register with an SMTP mail service and configure its authenticated sender/domain and credentials:

```dotenv
EMAIL_PROVIDER=smtp
SMTP_HOST=smtp.your-provider.example
SMTP_PORT=587
SMTP_USERNAME=your-username
SMTP_PASSWORD=your-secret
SMTP_FROM=Hishob <noreply@your-domain.example>
SMTP_SSL=false
```

Port 587 uses STARTTLS with certificate verification. If your provider requires implicit TLS, use its port (typically 465) and `SMTP_SSL=true`. Credentials stay in backend environment variables, never `EXPO_PUBLIC_*`. `APP_ENV=production` rejects the development email provider and placeholder JWT secret. SMTP delivery errors return a retryable error and invalidate the unsent challenge. Actual delivery requires valid provider credentials; automated checks use a fake SMTP transport, not a real mailbox.

`OTP_EXPIRE_SECONDS` (300), `OTP_RESEND_SECONDS` (30) and `OTP_MAX_ATTEMPTS` (5) now apply to **email** codes. Codes are generated randomly for SMTP, stored as keyed hashes, single-use and purpose/account scoped. Explicit expiry checks do not rely on MongoDB's TTL cleanup. Login, setup, recovery and sending are rate-limited in MongoDB. Passwords use Argon2id (19 MiB, two iterations, one lane), following [OWASP's storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html). Passwords support 12–128 characters and internal spaces; mismatches, common/repeated passwords, surrounding whitespace and use of the account mobile/email are rejected. User responses and validation errors exclude password hashes, setup hashes and submitted secrets.

## API changes

Paths are prefixed with `/api`. Public endpoints still require the web-origin/custom-header checks for browser requests. Native uses bearer JWTs; web uses the existing HttpOnly cookie.

| POST path | Body / purpose |
| --- | --- |
| `/auth/password/options` | `{mobile, role}`; returns PASSWORD, REGISTER, SETUP, OWNER_RECOVERY or OWNER_MIGRATION |
| `/auth/password/login` | `{mobile, role, password}` |
| `/auth/owner/register/request` | `{mobile, role: OWNER, name, email}`; email challenge |
| `/auth/owner/register/confirm` | `{challenge_id, code, password, confirm_password}` |
| `/auth/owner/recovery/request` | `{email}`; generic recovery challenge response |
| `/auth/owner/recovery/confirm` | `{challenge_id, code, password, confirm_password}` |
| `/auth/owner/enroll/request` | `{email}`; authenticated legacy owner only |
| `/auth/owner/enroll/confirm` | `{challenge_id, code, password, confirm_password}`; authenticated legacy owner |
| `/auth/password/change` | `{current_password, password, confirm_password}`; authenticated |
| `/auth/staff/reset-request` | `{mobile, role}`; active staff only |
| `/auth/staff/password/setup` | `{mobile, role, setup_code, password, confirm_password}` |
| `/shops/{shop_id}/team/{staff_id}/password-access` | Authenticated, authorised initial setup / reset approval; returns one-time code |
| `/shops/{shop_id}/team/{staff_id}/password-deny` | Authenticated, authorised denial of a pending reset |
| `/auth/mobile-change/request` | `{mobile, role: OWNER, password}`; authenticated owner, recovery-email verification |
| `/auth/mobile-change/confirm` | `{challenge_id, code}`; authenticated owner |

A partial unique index on `users.email` allows existing users without emails. Password updates use atomic account-version comparisons; concurrent code consumption cannot create two password changes. An approval issued by a manager stops working if their authority is revoked before use. No membership, attendance or financial-history migration is required.

## Validation and manual check

From `backend/`, run `.venv/bin/pytest -q`, `.venv/bin/ruff check .`, and `.venv/bin/ruff format --check .`. From `mobile/`, run `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run test:e2e`, and `npm run test:pwa` with MongoDB available on port 27018.

Test registration, second-device login limits, first staff setup, wrong/reused/expired codes, reset request and denial/approval, manager permission on/off, inactive and other-shop staff, owner recovery, known-password changes and mobile changes. Repeat owner login on a real phone and installed PWA with your SMTP provider before onboarding real accounts.
