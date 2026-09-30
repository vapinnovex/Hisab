"""Email delivery for owner registration, recovery and identity changes."""

import html
import json
from urllib.request import Request, urlopen

from .i18n import translate


def send_email(settings, recipient, code, language="en"):
    if settings.email_provider == "dev":
        if settings.app_env not in {"development", "test"}:
            raise RuntimeError("Development email is disabled")
        return
    subject = translate("Your Hishob verification code", language)
    text_content = translate(
        "Your Hishob code is {code}. It expires in {minutes} minutes. If you did not request this, ignore this email. Never share this code.",
        language,
        code=code,
        minutes=settings.otp_expire_seconds // 60,
    )
    payload = {
        "sender": {
            "name": settings.brevo_sender_name,
            "email": settings.brevo_sender_email,
        },
        "to": [{"email": recipient}],
        "subject": subject,
        "textContent": text_content,
        "htmlContent": f"<p>{html.escape(text_content)}</p>",
    }
    request = Request(
        "https://api.brevo.com/v3/smtp/email",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "accept": "application/json",
            "api-key": settings.brevo_api_key,
            "content-type": "application/json",
        },
        method="POST",
    )
    with urlopen(request, timeout=15) as response:
        response.read()
