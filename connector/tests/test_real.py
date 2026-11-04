import json
from datetime import datetime, timezone

import pytest
from test_extractor import FakeConnection, read

from hishob_connector.real import RealStore, RealTransport, https_origin, map_bill, validate_binding
from hishob_connector.transport import DeliveryError


def binding():
    return {
        "version": 2,
        "shop_id": "shop",
        "owner_id": "owner",
        "source_id": "pc",
        "generation": "gen",
        "database": "RsDB",
        "firm_codes": [0],
        "invoice_types": [0, 1],
        "tracking_from": "2026-11-03",
        "capture_from": "2026-01-01",
        "capture_until": "2027-01-01",
        "mapping_version": "real-display-v1",
        "synthetic_only": False,
        "next_action": "SEND_REAL_REVIEW_OBSERVATIONS",
    }


def real_store(tmp_path, vault):
    store = RealStore.initialize(tmp_path / "real", vault)
    store.put("pilot_kind", "REAL_DEV")
    store.put("expected_binding", binding())
    store.queue_pair("https://dev.example.test", "A" * 32)
    store.finish_pair(store.get("pending_pair")["id"], binding())
    return store


def test_zero_missing_and_signed_duplicate_mapping(tmp_path, vault):
    source = FakeConnection()
    source.header.update(InvoiceDate="2026-11-03", NetAmt=-61, ExchangeAmt=1800)
    source.people[0] = "Confirmed zero"
    source.lines[0]["SLNo"] = source.lines[1]["SLNo"] = 0
    source.lines[2]["SLNo"] = None
    snapshot = read(source)
    bill = map_bill(snapshot)
    assert bill["bill"]["net_amt"] == "-61"
    assert len(bill["bill"]["lines"]) == 3
    assert [r["salesperson_ref"] for r in bill["bill"]["lines"]].count("0") == 2
    assert any(r["attribution_status"] == "ABSENT_REFERENCE" for r in bill["bill"]["lines"])
    store = real_store(tmp_path, vault)
    stamp = datetime.now(timezone.utc).isoformat()
    store.enqueue_real([bill], stamp, {"turn": 1})
    original = store.head()["body"]
    store.close()
    store = RealStore(tmp_path / "real", vault)
    assert store.head()["body"] == original
    source.header["NetAmt"] = 0
    store.enqueue_real([map_bill(read(source))], stamp, {"turn": 2})
    assert store.count() == 2 and store.head()["body"] == original
    with pytest.raises(ValueError, match="key mismatch"):
        store.acknowledge(1, {"bill_id": "wrong"})
    assert store.count() == 2
    assert json.loads(original)["synthetic"] is False
    store.close()


def test_real_origin_and_binding_fail_closed():
    assert https_origin("https://dev.example.test/") == "https://dev.example.test"
    for url in [
        "http://127.0.0.1:8000",
        "https://user@dev.test",
        "https://dev.test/api",
        "https://dev.test?x=1",
        "https://dev.test:444",
    ]:
        with pytest.raises(ValueError):
            https_origin(url)
    b = binding()
    b["synthetic_only"] = True
    with pytest.raises(ValueError):
        validate_binding(b)


def test_https_transport_policy_and_response_limits(monkeypatch):
    import httpx

    calls = []

    class Response:
        status_code = 200

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def iter_bytes(self):
            yield b'{"received":true}'

    class Client:
        def __init__(self, **kwargs):
            assert kwargs == {"timeout": 8, "trust_env": False, "follow_redirects": False}
            # Default httpx certificate/hostname verification remains enabled.

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def stream(self, method, url, **kwargs):
            calls.append(url)
            return Response()

    monkeypatch.setattr(httpx, "Client", Client)
    transport = RealTransport("https://dev.example.test")
    assert transport.post("health", b"{}") == {"received": True}
    assert calls == ["https://dev.example.test/api/radiosoft/real-connector/health"]
    Response.status_code = 302
    with pytest.raises(DeliveryError) as exc:
        transport.post("health", b"{}")
    assert exc.value.status == 302
    Response.status_code = 200
    monkeypatch.setattr(Response, "iter_bytes", lambda self: iter([b"x" * 65537]))
    with pytest.raises(DeliveryError):
        transport.post("health", b"{}")


def test_real_schema_matches_backend():
    from app.radiosoft_real_schemas import RealObservation

    from hishob_connector.real import VALIDATOR

    assert VALIDATOR.schema == RealObservation.model_json_schema()


@pytest.mark.parametrize("case", ["trusted", "untrusted", "wrong_host", "expired"])
def test_real_tls_handshake(tmp_path, monkeypatch, case):
    """Actual local TLS sockets; no external service or SQL is contacted."""
    import ssl
    import threading
    from datetime import timedelta
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    import httpx

    pytest.importorskip("cryptography")
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "localhost")])
    now = datetime.now(timezone.utc)
    certificate = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(days=2))
        .not_valid_after(now - timedelta(days=1) if case == "expired" else now + timedelta(days=1))
        .add_extension(
            x509.SubjectAlternativeName(
                [x509.DNSName("wrong.test" if case == "wrong_host" else "localhost")]
            ),
            critical=False,
        )
        .sign(key, hashes.SHA256())
    )
    cert = tmp_path / "cert.pem"
    pem = tmp_path / "key.pem"
    cert.write_bytes(certificate.public_bytes(serialization.Encoding.PEM))
    pem.write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.TraditionalOpenSSL,
            serialization.NoEncryption(),
        )
    )

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            self.rfile.read(int(self.headers["Content-Length"]))
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'{"received":true}')

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(cert, pem)
    server.socket = context.wrap_socket(server.socket, server_side=True)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    client_class = httpx.Client

    def client(**kwargs):
        if case != "untrusted":
            kwargs["verify"] = ssl.create_default_context(cafile=str(cert))
        return client_class(**kwargs)

    monkeypatch.setattr(httpx, "Client", client)
    transport = RealTransport("https://localhost")
    # Ephemeral port is confined to the harness; configured production origin rules stay strict.
    transport.api = f"https://localhost:{server.server_port}"
    try:
        if case == "trusted":
            assert transport.post("health", b"{}") == {"received": True}
        else:
            with pytest.raises(DeliveryError) as exc:
                transport.post("health", b"{}")
            assert exc.value.status == 0
    finally:
        server.shutdown()
        server.server_close()
        thread.join(2)


@pytest.mark.integration
def test_real_queue_lost_reply_and_global_sequence(tmp_path, vault, backend):
    from app.radiosoft_real_schemas import RealScope
    from test_integration import ready

    from hishob_connector.real import RealEngine

    client = backend["client"]
    settings = backend["settings"]
    db = backend["db"]
    source = settings.radiosoft_pilots[0]
    b = {**binding(), "shop_id": source["shop_id"], "owner_id": source["owner_id"]}
    s = {k: v for k, v in b.items() if k not in {"version", "synthetic_only", "next_action"}}
    settings.radiosoft_real_enabled = True
    settings.radiosoft_real_pilots = [RealScope(**s)]
    base = f"/api/shops/{s['shop_id']}/radiosoft-real"
    assert (
        client.post(
            base + "/setup", headers=backend["owner"], json={"scope": s, "confirm_source_and_scope": True}
        ).status_code
        == 200
    )
    code = client.post(base + "/pairing", headers=backend["owner"]).json()["code"]

    class Transport:
        lose = "pair"
        calls = []

        def post(self, path, body, credential=None):
            self.calls.append((path, body))
            response = client.post(
                "/api/radiosoft/real-connector/" + path,
                content=body,
                headers={
                    "Content-Type": "application/json",
                    **({"Authorization": "Bearer " + credential} if credential else {}),
                },
            )
            assert response.status_code == 200, response.text
            if self.lose == path:
                self.lose = None
                raise DeliveryError(0)
            return response.json()

    store = RealStore.initialize(tmp_path / "delivery", vault)
    store.put("pilot_kind", "REAL_DEV")
    store.put("expected_binding", b)
    store.queue_pair("https://dev.example.test", code)
    transport = Transport()
    engine = RealEngine(store, transport)
    engine.tick()
    assert store.get("mode") == "PAIRING"
    ready(store)
    engine.tick()
    assert store.get("mode") == "RUNNING"
    assert transport.calls[0][1] == transport.calls[1][1]
    source = FakeConnection()
    source.header.update(InvoiceDate="2026-11-03", NetAmt=-61)
    record = map_bill(read(source))
    store.enqueue_real([record], datetime.now(timezone.utc).isoformat(), {"turn": 1})
    store.put("last_real_attempt", __import__("time").time())
    transport.lose = "observations"
    engine.tick()
    original = store.head()["body"]
    assert db.radiosoft_real_bills.count_documents({}) == 1
    store.close()
    store = RealStore(tmp_path / "delivery", vault)
    engine = RealEngine(store, transport)
    ready(store)
    engine.tick()
    assert store.count() == 0 and store.get("last_acknowledged_sequence") == 1
    assert [body for path, body in transport.calls if path == "observations"] == [original, original]
    assert len(db.radiosoft_real_bills.find_one({})["versions"]) == 1
    store.close()


def test_polling_budget_and_failed_page_never_advance(tmp_path, vault):
    from hishob_connector.extractor import SCHEMA_SQL, ExtractionReview, Reader
    from hishob_connector.real import Poller

    source = FakeConnection()
    reader = Reader(source, [0], "2026-01-01", "2027-01-01", 0, max_queries=1)
    reader.query(SCHEMA_SQL)
    with pytest.raises(ExtractionReview, match="READ_BUDGET"):
        reader.query(SCHEMA_SQL)
    store = real_store(tmp_path, vault)
    poller = Poller(store, Reader(source, [0], "2026-01-01", "2027-01-01", 0))
    poller.capture()  # directory first, including unobserved people
    assert store.count() == 1
    checkpoint = store.get("real_checkpoint")
    from hishob_connector.extractor import KEYS_SQL

    source.fail = KEYS_SQL
    with pytest.raises(TimeoutError):
        poller.capture()
    assert store.get("real_checkpoint") == checkpoint and store.count() == 1
    store.close()
