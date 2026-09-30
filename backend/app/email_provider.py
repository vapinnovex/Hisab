"""Email delivery for owner registration, recovery and identity changes."""

import logging
import smtplib
import ssl
from email.message import EmailMessage
from time import monotonic

logger = logging.getLogger("uvicorn.error.email")


def send_email(settings, recipient, code):
    if settings.email_provider == "dev":
        if settings.app_env not in {"development", "test"}:
            raise RuntimeError("Development email is disabled")
        return
    message = EmailMessage()
    message["From"] = settings.smtp_from
    message["To"] = recipient
    message["Subject"] = "Your Hishob verification code"
    message.set_content(
        f"Your Hishob code is {code}. It expires in {settings.otp_expire_seconds // 60} minutes.\n\nIf you did not request this, ignore this email. Never share this code."
    )
    started = monotonic()
    stage = "connect"
    mode = "implicit_tls" if settings.smtp_ssl else "starttls"
    try:
        connection = smtplib.SMTP_SSL if settings.smtp_ssl else smtplib.SMTP
        options = {"context": ssl.create_default_context()} if settings.smtp_ssl else {}
        with connection(settings.smtp_host, settings.smtp_port, timeout=15, **options) as smtp:
            if not settings.smtp_ssl:
                stage = "starttls"
                smtp.starttls(context=ssl.create_default_context())
            if settings.smtp_username:
                stage = "authenticate"
                smtp.login(settings.smtp_username, settings.smtp_password)
            stage = "send"
            smtp.send_message(message)
            stage = "quit"
    except Exception as exc:
        # SMTP exception messages can contain addresses, credentials or message contents.
        # Log only diagnostic types and numeric codes, never raw exceptions or wire traffic.
        smtp_code = getattr(exc, "smtp_code", None)
        error_number = getattr(exc, "errno", None)
        logger.error(
            "SMTP delivery failed stage=%s host=%s port=%s tls=%s auth_enabled=%s "
            "error_type=%s smtp_code=%s errno=%s elapsed_ms=%d",
            stage,
            settings.smtp_host,
            settings.smtp_port,
            mode,
            bool(settings.smtp_username),
            type(exc).__name__,
            smtp_code if isinstance(smtp_code, int) else None,
            error_number if isinstance(error_number, int) else None,
            (monotonic() - started) * 1000,
        )
        raise
    logger.info(
        "SMTP delivery completed host=%s port=%s tls=%s elapsed_ms=%d",
        settings.smtp_host,
        settings.smtp_port,
        mode,
        (monotonic() - started) * 1000,
    )
