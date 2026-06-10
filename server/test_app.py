import json

from fastapi.testclient import TestClient

from server.app import app

client = TestClient(app)


def test_health():
    assert client.get("/healthz").json() == {"ok": True}


def test_post_state_updates_snapshot():
    r = client.post("/r/t1/state", json={"x": 9})
    assert r.json() == {"ok": True}
    assert client.get("/r/t1/snapshot").json() == {"x": 9}


def test_state_roundtrip():
    client.post("/r/hexagon/state", json={"phase": "memorize", "round": 3})
    snap = client.get("/r/hexagon/snapshot").json()
    assert snap == {"phase": "memorize", "round": 3}


def test_rooms_isolated():
    client.post("/r/hxa/state", json={"a": 1})
    client.post("/r/hcb/state", json={"b": 2})
    assert client.get("/r/hxa/snapshot").json() == {"a": 1}
    assert client.get("/r/hcb/snapshot").json() == {"b": 2}


def test_broadcast_reaches_subscriber():
    # The SSE fan-out core: a message posted to a room reaches every subscriber
    # queue. (Full SSE streaming is verified against a real uvicorn server in
    # scripts/smoke_sse.py, since TestClient/ASGITransport can't stream an
    # infinite generator in-process.)
    import asyncio

    from server.app import Room, _broadcast

    async def run():
        r = Room()
        q: asyncio.Queue = asyncio.Queue(maxsize=10)
        r.subscribers.add(q)
        await _broadcast(r, {"kind": "state", "data": {"hello": "world"}})
        assert q.get_nowait() == {"kind": "state", "data": {"hello": "world"}}

    asyncio.run(run())


def test_cors_header_present():
    r = client.post(
        "/r/t3/state",
        json={"a": 1},
        headers={"Origin": "https://zhangboy03.github.io"},
    )
    assert r.headers.get("access-control-allow-origin") == "*"


def test_claim_then_second_is_busy():
    a = client.post("/r/lk1/claim", json={}).json()
    assert a["ok"] is True and a["token"]
    b = client.post("/r/lk1/claim", json={}).json()
    assert b["ok"] is False and b["reason"] == "busy"


def test_force_takeover():
    client.post("/r/lk2/claim", json={})
    b = client.post("/r/lk2/claim", json={"force": True}).json()
    assert b["ok"] is True and b["token"]


def test_heartbeat_rejects_stale_token():
    a = client.post("/r/lk3/claim", json={}).json()
    client.post("/r/lk3/claim", json={"force": True})  # steal the lock
    hb = client.post("/r/lk3/heartbeat", json={"token": a["token"]}).json()
    assert hb["ok"] is False


def test_heartbeat_accepts_live_token():
    a = client.post("/r/lk4/claim", json={}).json()
    hb = client.post("/r/lk4/heartbeat", json={"token": a["token"]}).json()
    assert hb["ok"] is True
