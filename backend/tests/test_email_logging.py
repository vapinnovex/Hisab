import logging
import smtplib

import pytest

from app.config import Settings
from app.email_provider import send_email


@pytest.mark.parametrize(
    "stage,error",
    [
        ("connect", TimeoutError("private-recipient@example.com")),
        ("starttls", smtplib.SMTPNotSupportedError("private-password")),
        ("authenticate", smtplib.SMTPAuthenticationError(535, b"private-password")),
        ("send", smtplib.SMTPDataError(554, b"private-code")),
        ("quit", smtplib.SMTPResponseException(421, b"private-code")),
    ],
)
def test_smtp_failure_logs_safe_diagnostics(monkeypatch, caplog, stage, error):
    def fail_at(current):
        if current == stage:
            raise error

    class SMTP:
        def __init__(self, *args, **kwargs):
            fail_at("connect")

        def __enter__(self):
            return self

        def __exit__(self, *args):
            if args[0] is None:
                fail_at("quit")

        def starttls(self, **kwargs):
            fail_at("starttls")

        def login(self, *args):
            fail_at("authenticate")

        def send_message(self, message):
            fail_at("send")

    monkeypatch.setattr("app.email_provider.smtplib.SMTP", SMTP)
    settings = Settings(
        _env_file=None,
        app_env="test",
        jwt_secret="test-secret-with-more-than-32-characters",
        email_provider="smtp",
        smtp_host="smtp.example.com",
        smtp_from="private-sender@example.com",
        smtp_username="private-user",
        smtp_password="private-password",
    )
    with caplog.at_level(logging.INFO), pytest.raises(type(error)):
        send_email(settings, "private-recipient@example.com", "private-code")
    assert f"stage={stage}" in caplog.text
    assert f"error_type={type(error).__name__}" in caplog.text
    assert "host=smtp.example.com port=587 tls=starttls" in caplog.text
    if hasattr(error, "smtp_code"):
        assert f"smtp_code={error.smtp_code}" in caplog.text
    assert "private-" not in caplog.text
    assert "SMTP delivery completed" not in caplog.text
