import json
import os
import subprocess
import sys
import time

import pytest
from conftest import new_code
from test_store import bound, capture

from hishob_connector.store import Store

pytestmark = [pytest.mark.windows, pytest.mark.skipif(os.name != "nt", reason="Windows DPAPI/process tests")]


def child(code, *args):
    return subprocess.Popen(
        [sys.executable, "-c", code, *map(str, args)],
        creationflags=subprocess.CREATE_NO_WINDOW,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )


def wait_until(check, timeout=15):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if check():
            return
        time.sleep(0.05)
    raise AssertionError("Timed out waiting for isolated child process")


def test_process_crash_mid_transaction_rolls_back_sequence_queue_and_checkpoint(store, vault):
    bound(store)
    capture(store)
    original = store.head()["body"]
    # Simulate abrupt termination after writes, before SQLite COMMIT.
    code = """
import os, sys
from hishob_connector.store import Store
from hishob_connector.security import DPAPI
s=Store(sys.argv[1], DPAPI())
with s.transaction():
    s.put("sequence", 100)
    s.put("scan_checkpoint", 100)
    s.db.execute("DELETE FROM outbox")
    os._exit(27)
"""
    process = child(code, store.directory)
    assert process.wait(10) == 27
    reopened = Store(store.directory, vault)
    try:
        assert reopened.get("sequence") == 3 and reopened.get("scan_checkpoint") == 1
        assert reopened.head()["body"] == original and reopened.count() == 3
    finally:
        reopened.close()


def test_single_worker_lock_released_after_process_death(store):
    from hishob_connector.security import ProcessLock

    marker = store.directory / "test-ready"
    code = """
import sys,time
from pathlib import Path
from hishob_connector.security import ProcessLock
with ProcessLock(Path(sys.argv[1])):
    Path(sys.argv[2]).write_text("ready")
    time.sleep(30)
"""
    process = child(code, store.directory, marker)
    try:
        wait_until(marker.exists)
        with pytest.raises(OSError):
            with ProcessLock(store.directory):
                pass
    finally:
        process.kill()
        process.wait(10)
    with ProcessLock(store.directory):
        pass


@pytest.mark.integration
def test_background_worker_restart_and_ui_close_against_real_http(store, backend):
    import socket
    import threading

    import uvicorn

    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    server = uvicorn.Server(uvicorn.Config(backend["client"].app, lifespan="off", log_level="critical"))
    thread = threading.Thread(target=server.run, kwargs={"sockets": [sock]}, daemon=True)
    thread.start()
    processes = []
    try:
        wait_until(lambda: server.started)
        store.queue_pair(f"http://127.0.0.1:{sock.getsockname()[1]}", new_code(backend))
        # Optional built artifact: verifies embedded runtime, not the editable package.
        executable = os.environ.get("CONNECTOR_TEST_EXE")
        command = [executable] if executable else [sys.executable, "-m", "hishob_connector.main"]
        command += ["run", "--state", str(store.directory)]

        def start():
            process = subprocess.Popen(
                command,
                creationflags=subprocess.CREATE_NO_WINDOW,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            processes.append(process)
            return process

        worker = start()
        try:
            wait_until(
                lambda: store.get("last_acknowledged_sequence", 0) >= 1 or worker.poll() is not None, 25
            )
        except AssertionError:
            pytest.fail("Worker did not acknowledge: " + json.dumps(store.status()))
        if worker.poll() is not None:
            pytest.fail("Synthetic child exited: " + worker.stderr.read().decode(errors="replace"))
        # Real Tk window in its own process closes after one render; worker stays alive.
        if executable:
            import win32con
            import win32gui
            import win32process

            gui = subprocess.Popen(
                [executable, "gui", "--state", str(store.directory)],
                creationflags=subprocess.CREATE_NO_WINDOW,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            processes.append(gui)
            windows = []

            def find_our_window():
                windows.clear()

                def visit(hwnd, _):
                    if win32process.GetWindowThreadProcessId(hwnd)[1] == gui.pid and win32gui.IsWindowVisible(
                        hwnd
                    ):
                        windows.append(hwnd)

                win32gui.EnumWindows(visit, None)
                return bool(windows)

            wait_until(find_our_window, 15)
            time.sleep(1)
            for hwnd in windows:
                win32gui.PostMessage(hwnd, win32con.WM_CLOSE, 0, 0)
        else:
            gui = child(
                """
import sys,tkinter as tk
from pathlib import Path
from hishob_connector.gui import show
original=tk.Tk
def temporary_window():
    root=original()
    root.after(1200,root.destroy)
    return root
tk.Tk=temporary_window
show(Path(sys.argv[1]))
""",
                store.directory,
            )
            processes.append(gui)
        assert gui.wait(15) == 0
        assert worker.poll() is None
        wait_until(lambda: store.get("last_acknowledged_sequence", 0) >= 3)
        credential, identity = store.get("credential"), store.get("identity")
        worker.kill()
        worker.wait(10)
        # Persist an outstanding scan while the process is down, then restart it.
        capture_binding = store.get("binding")
        from datetime import datetime, timezone

        from hishob_connector.synthetic import scan

        store.enqueue_scan(
            scan(identity, capture_binding, "salesperson_change"), datetime.now(timezone.utc).isoformat()
        )
        queued = store.head()["body"]
        restarted = start()
        wait_until(lambda: store.get("last_acknowledged_sequence", 0) >= json.loads(queued)["sequence"], 25)
        assert restarted.poll() is None and store.get("identity") == identity
        assert store.get("credential") == credential
        assert backend["db"].radiosoft_bills.count_documents({}) == 3
    finally:
        for process in processes:
            if process.poll() is None:
                process.kill()
            process.wait(10)
        server.should_exit = True
        thread.join(10)
        sock.close()
