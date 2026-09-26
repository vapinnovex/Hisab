from pydantic import ConfigDict, EmailStr, Field

from .schemas import Input, OTPRequest, OTPVerify


class EmailInput(Input):
    email: EmailStr


class RegisterInput(OTPRequest):
    email: EmailStr
    name: str = Field(min_length=2, max_length=100)


class LoginInput(OTPRequest):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=False)
    password: str = Field(min_length=1, max_length=128)


class NewPassword(Input):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=False)
    password: str = Field(min_length=12, max_length=128)
    confirm_password: str = Field(min_length=12, max_length=128)


class EmailPassword(OTPVerify, NewPassword):
    pass


class StaffPassword(OTPRequest, NewPassword):
    setup_code: str = Field(min_length=8, max_length=100)


class PasswordChange(NewPassword):
    current_password: str = Field(min_length=1, max_length=128)


class MobileChange(LoginInput):
    pass
