from datetime import date
from enum import Enum
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import phonenumbers
from pydantic import BaseModel, ConfigDict, Field, field_validator


class Role(str, Enum):
    OWNER = "OWNER"
    MANAGER = "MANAGER"
    ADMIN = "ADMIN"  # Legacy memberships are treated as managers.
    WORKER = "WORKER"


class LoginRole(str, Enum):
    OWNER = "OWNER"
    MANAGER = "MANAGER"
    WORKER = "WORKER"


class AttendanceStatus(str, Enum):
    PRESENT = "PRESENT"
    ABSENT = "ABSENT"
    HALF_DAY = "HALF_DAY"
    LEAVE = "LEAVE"
    NOT_MARKED = "NOT_MARKED"


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class MobileInput(Input):
    mobile: str

    @field_validator("mobile")
    @classmethod
    def valid_mobile(cls, value):
        if not value.startswith("+"):
            raise ValueError("Include country code, e.g. +919876543210")
        try:
            number = phonenumbers.parse(value, None)
            if not phonenumbers.is_valid_number(number):
                raise ValueError("Enter a valid mobile number")
            return phonenumbers.format_number(number, phonenumbers.PhoneNumberFormat.E164)
        except phonenumbers.NumberParseException as exc:
            raise ValueError("Enter a valid mobile number") from exc


class OTPRequest(MobileInput):
    role: LoginRole


class OTPVerify(Input):
    challenge_id: str = Field(min_length=1, max_length=100)
    code: str = Field(pattern=r"^\d{6}$")


class OwnerProfileUpdate(Input):
    name: str = Field(min_length=2, max_length=100)


class ShopCreate(Input):
    name: str = Field(min_length=2, max_length=100)
    timezone: str = "Asia/Kolkata"

    @field_validator("timezone")
    @classmethod
    def valid_timezone(cls, value):
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError("Use a valid IANA timezone, e.g. Asia/Kolkata") from exc
        return value


class WorkerCreate(MobileInput):
    name: str = Field(min_length=2, max_length=100)


class WorkerUpdate(WorkerCreate):
    active: bool


class AttendanceUpdate(Input):
    date: date
    status: AttendanceStatus
    note: str = Field(default="", max_length=500)


class AttendanceMode(str, Enum):
    CHECK_IN_ONLY = "CHECK_IN_ONLY"
    CHECK_IN_OUT = "CHECK_IN_OUT"


class HishobMode(str, Enum):
    ENTRIES = "ENTRIES"
    COUNTED = "COUNTED"
    BILLING = "BILLING"


class ShopSettings(Input):
    hishob_mode: HishobMode = HishobMode.ENTRIES
    attendance_mode: AttendanceMode = AttendanceMode.CHECK_IN_ONLY
    manager_can_manage_attendance: bool = True
    manager_can_mark_own_attendance: bool = False
    manager_can_add_workers: bool = False
    manager_can_edit_workers: bool = False
    workers_can_view_attendance: bool = True
    manager_can_access_hishob: bool = False
    manager_can_close_hishob: bool = False
