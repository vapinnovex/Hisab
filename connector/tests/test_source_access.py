"""No SQL server is used; validate fail-closed connection/permission checks."""

import sys
from types import SimpleNamespace

import pytest

from hishob_connector.extractor import ExtractionReview, open_local_readonly


@pytest.mark.parametrize(
    "failure", ["role", "unknown_role", "database_write", "object_write", "no_select", None]
)
def test_readonly_identity_preflight(monkeypatch, failure):
    calls = []
    closed = []

    class Cursor:
        def execute(self, sql, *params):
            assert sql.startswith("SELECT ")
            calls.append((sql, params))
            self.sql = sql

        def fetchone(self):
            if "HAS_PERMS_BY_NAME" in self.sql:
                return (0 if failure == "no_select" else 1,)
            return (1 if failure == "role" else None if failure == "unknown_role" else 0,) * 13

        def __iter__(self):
            if "'DATABASE'" in self.sql:
                return iter(
                    [("CONNECT",), ("CREATE TABLE" if failure == "database_write" else "VIEW DEFINITION",)]
                )
            return iter(
                [
                    (
                        "UPDATE"
                        if failure == "object_write"
                        else "VIEW DEFINITION"
                        if failure == "no_select"
                        else "SELECT",
                    )
                ]
            )

        def close(self):
            closed.append("cursor")

    connection = SimpleNamespace(cursor=Cursor, close=lambda: closed.append("connection"))

    def connect(value, **kwargs):
        assert "Trusted_Connection=yes" in value and "PWD=" not in value
        assert kwargs["attrs_before"] == {101: 1}
        return connection

    monkeypatch.setitem(sys.modules, "pyodbc", SimpleNamespace(connect=connect))
    if failure:
        with pytest.raises(ExtractionReview):
            open_local_readonly(r".\SQLEXPRESS", "RsDB")
        assert closed == ["cursor", "connection"]
    else:
        assert open_local_readonly(r".\SQLEXPRESS", "RsDB") is connection
        assert closed == ["cursor"] and connection.timeout == 10
    assert calls


def test_remote_connection_and_injected_database_refused_before_connect(monkeypatch):
    def forbidden(*_, **__):
        raise AssertionError("Must not connect")

    monkeypatch.setitem(sys.modules, "pyodbc", SimpleNamespace(connect=forbidden))
    for server, database in [("public.example.com", "RsDB"), (r".\SQLEXPRESS", "RsDB;PWD=secret")]:
        with pytest.raises(ValueError):
            open_local_readonly(server, database)
