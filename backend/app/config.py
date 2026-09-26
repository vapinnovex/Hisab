from functools import lru_cache

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    app_env: str = "development"
    mongodb_uri: str = "mongodb://127.0.0.1:27017"
    mongodb_database: str = "hisab"
    jwt_secret: str = Field(min_length=32)
    jwt_expire_minutes: int = Field(default=10080, ge=1, le=43200)
    email_provider: str = "dev"
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_from: str = ""
    smtp_ssl: bool = False
    dev_otp: str = Field(default="123456", pattern=r"^\d{6}$")
    otp_expire_seconds: int = Field(default=300, ge=30)
    otp_resend_seconds: int = Field(default=30, ge=0)
    otp_max_attempts: int = Field(default=5, ge=1, le=10)
    cors_origins: list[str] = ["http://localhost:8081"]

    @model_validator(mode="after")
    def production_safety(self):
        if "*" in self.cors_origins:
            raise ValueError("CORS_ORIGINS must list exact trusted app origins")
        if self.email_provider not in {"dev", "smtp"}:
            raise ValueError("EMAIL_PROVIDER must be dev or smtp")
        if self.email_provider == "smtp" and (not self.smtp_host or not self.smtp_from):
            raise ValueError("SMTP_HOST and SMTP_FROM are required")
        if self.app_env not in {"development", "test"}:
            if self.email_provider == "dev":
                raise ValueError("Development email provider cannot run in production")
            if self.jwt_secret.startswith("change-this"):
                raise ValueError("Set a random production JWT_SECRET")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
