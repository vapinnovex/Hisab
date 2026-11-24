"""Windows SCM host: process and sync lifetime are independent of the setup UI."""

import os
import threading
from pathlib import Path

from .engine import Engine
from .security import DPAPI, ProcessLock
from .store import Store

SERVICE_NAME = "HishobRadioSoftSynthetic"


def default_directory():
    return Path(os.environ.get("PROGRAMDATA", r"C:\ProgramData")) / "HishobConnectorSynthetic"


def run(directory, stop):
    with ProcessLock(directory):
        store = Store(directory, DPAPI())
        try:
            Engine(store).run(stop)
        finally:
            store.close()


def dispatch():
    import servicemanager
    import win32service
    import win32serviceutil

    class ConnectorService(win32serviceutil.ServiceFramework):
        _svc_name_ = SERVICE_NAME
        _svc_display_name_ = SERVICE_NAME
        _svc_description_ = "Isolated Hishob display preview connector."

        def __init__(self, args):
            super().__init__(args)
            self.stop_event = threading.Event()

        def SvcStop(self):
            self.ReportServiceStatus(win32service.SERVICE_STOP_PENDING, waitHint=30000)
            self.stop_event.set()

        def SvcShutdown(self):
            self.SvcStop()

        def SvcDoRun(self):
            self.ReportServiceStatus(win32service.SERVICE_RUNNING)
            try:
                run(default_directory(), self.stop_event)
            except BaseException:
                # Never send exception text (could include DPAPI/path/response data) to logs.
                servicemanager.LogErrorMsg("Hishob connector stopped: state/runtime error; preserve state.")
                raise

    servicemanager.Initialize()
    servicemanager.PrepareToHostSingle(ConnectorService)
    servicemanager.StartServiceCtrlDispatcher()
