"""Machine DPAPI is only safe with the installer's service-SID/admin directory ACL."""

import os
from pathlib import Path


class DPAPI:
    def __init__(self):
        if os.name != "nt":
            raise RuntimeError("Windows DPAPI is required; there is no plaintext fallback")
        import win32crypt

        self.api = win32crypt

    def seal(self, data: bytes) -> bytes:
        # CRYPTPROTECT_LOCAL_MACHINE | CRYPTPROTECT_UI_FORBIDDEN
        return self.api.CryptProtectData(data, "Hishob connector", None, None, None, 0x5)

    def open(self, data: bytes) -> bytes:
        return self.api.CryptUnprotectData(data, None, None, None, 0x1)[1]


class ProcessLock:
    """An OS file lock; released on process death, not a stale PID sentinel."""

    def __init__(self, directory: Path):
        self.path = directory / "worker.lock"
        self.file = None

    def __enter__(self):
        self.file = self.path.open("a+b")
        try:
            self.file.seek(0)
            if os.name == "nt":
                import msvcrt
                import time

                # Windows may briefly retain a byte lock while closing a killed
                # process's handles. Bound startup wait; a live second worker still fails.
                deadline = time.monotonic() + 2
                while True:
                    try:
                        msvcrt.locking(self.file.fileno(), msvcrt.LK_NBLCK, 1)
                        break
                    except OSError:
                        if time.monotonic() >= deadline:
                            raise
                        time.sleep(0.05)
            else:
                import fcntl

                fcntl.flock(self.file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BaseException:
            self.file.close()
            raise
        return self

    def __exit__(self, *_):
        if self.file:
            self.file.close()


def service_state(name="HishobRadioSoftSynthetic"):
    if os.name != "nt":
        return "UNSUPPORTED_PLATFORM"
    import pywintypes
    import win32service

    manager = service = None
    try:
        manager = win32service.OpenSCManager(None, None, win32service.SC_MANAGER_CONNECT)
        service = win32service.OpenService(manager, name, win32service.SERVICE_QUERY_STATUS)
        state = win32service.QueryServiceStatus(service)[1]
        return {
            1: "STOPPED",
            2: "START_PENDING",
            3: "STOP_PENDING",
            4: "RUNNING",
            5: "CONTINUE_PENDING",
            6: "PAUSE_PENDING",
            7: "PAUSED",
        }.get(state, "UNKNOWN")
    except pywintypes.error as exc:
        return "NOT_INSTALLED" if exc.winerror == 1060 else "STATUS_UNAVAILABLE"
    finally:
        if service is not None:
            win32service.CloseServiceHandle(service)
        if manager is not None:
            win32service.CloseServiceHandle(manager)
