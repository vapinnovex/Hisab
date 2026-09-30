# Languages

Hishob supports English (`en`), Hindi (`hi`) and Marathi (`mr`).

- Choose a language on the sign-in screen or during owner registration.
- Each shop has a default language, set at creation and editable in Shop settings.
- Everyone can change their personal language under Account → Language. A personal choice overrides the selected shop's default. Choose **Use shop default** to clear that override.
- Existing accounts without a personal preference inherit the selected shop's language; older shops default to English. No database migration is required.

## API and email

The frontend sends `Accept-Language` and the selected `X-Hishob-Shop`. Authenticated requests use the saved personal language first, then the path/selected shop's language after checking active membership. Unauthenticated requests use the supported language with the highest `Accept-Language` quality; unsupported languages fall back to English.

API errors, validation messages and user-facing success messages are translated. API responses include `Content-Language`; API responses remain non-cacheable. JSON field names, IDs, enum codes and user-entered content are unchanged. OTP emails use the registration choice or the request's resolved language. Development email mode still does not send email.

## Maintaining translations

Use `t('English source', [parameters])` for display copy and numbered `{0}` placeholders. Add the same source key to `mobile/src/locales/hi.json` and `mr.json`. Components subscribe with `useLocale()`; module-level label collections use `localized(() => ...)` so switching languages updates them too. Never translate values used in API requests, comparisons, navigation route names, or user data.

Backend messages live in `backend/app/locales/messages.tsv` as `English|Hindi|Marathi`. Named placeholders must match in all languages. The central exception handlers translate errors while retaining HTTP status, validation locations and error types.

Checks:

```powershell
# From mobile
npm run test:i18n
npm run typecheck
npm run lint
npm run test:e2e -- languages.spec.ts

# From backend, with test MongoDB on port 27018
.\.venv\Scripts\python.exe -m pytest tests/test_i18n.py -q
```

Browser tests use isolated test databases and test email delivery, not production accounts or SMTP.
