import pytest
from test_real import binding

from hishob_connector.pairing_ui import normalize_code, pairing_state
from hishob_connector.real import RealEngine, RealStore
from hishob_connector.transport import DeliveryError


@pytest.mark.parametrize("code", ["00001234", "0000 1234", " 0000\t1234\n"])
def test_short_code_text_normalization(code):
    assert normalize_code(code) == "00001234"


def test_legacy_code_remains_accepted_during_rollout():
    legacy = "A" * 32
    assert normalize_code(legacy) == legacy


@pytest.mark.parametrize("code", [12345678, "1234567", "１２３４５６７８", "1234-5678", "not-a-code"])
def test_reject_malformed(code):
    with pytest.raises(ValueError):
        normalize_code(code)


def test_confirmed_exchange_and_retry_preserve_proof_and_state(tmp_path, vault):
    store = RealStore.initialize(tmp_path / "state", vault)
    store.put("pilot_kind", "REAL_DEV")
    store.put("expected_binding", binding())
    store.put("sequence", 12)
    store.put("real_checkpoint", {"unchanged": 1})
    store.queue_pair("https://dev.example.test", "0000 1234")
    pending = store.get("pending_pair")
    assert pending["body"]["code"] == "00001234"
    assert len(pending["body"]["credential"]) >= 43
    assert pairing_state(store)[0] == "Pairing"

    class Transport:
        calls = []
        fail = True

        def post(self, path, body, credential=None):
            self.calls.append(body)
            if self.fail:
                self.fail = False
                raise DeliveryError(0)
            return binding()

    transport = Transport()
    engine = RealEngine(store, transport)
    engine.pair(pending, 1)
    assert pairing_state(store)[0] == "Connection failed"
    engine.pair(store.get("pending_pair"), 1000)
    assert transport.calls[0] == transport.calls[1]
    assert pairing_state(store)[0] == "Connected"
    assert store.get("sequence") == 12 and store.get("real_checkpoint") == {"unchanged": 1}
    store.close()


def test_expiry_never_reports_queued_as_connected(tmp_path, vault):
    store = RealStore.initialize(tmp_path / "state", vault)
    store.put("pilot_kind", "REAL_DEV")
    store.put("expected_binding", binding())
    store.queue_pair("https://dev.example.test", "12345678")

    class Expired:
        def post(self, *args):
            raise DeliveryError(401)

    RealEngine(store, Expired()).pair(store.get("pending_pair"), 1)
    assert pairing_state(store)[0] == "Expired code"
    assert store.get("pending_pair") and not store.get("credential")
    store.close()
