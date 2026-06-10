"""Cross-device sync relay for the host-console / big-screen games.

A console (one laptop) POSTs declarative `state` snapshots and imperative
`event` commands; displays (e.g. two iPads) subscribe over SSE and are fanned
out to. The relay is game-agnostic — it stores and forwards opaque JSON. Rooms
keep the latest snapshot so a newly-connected or reconnecting display is brought
up to date immediately.

See docs/superpowers/specs/2026-06-10-cross-device-sync-design.md
"""

import asyncio
import json
import secrets
import time

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

app = FastAPI()

# Low-risk display use; the single-console lock only guards against accidentally
# opening a second console, so an open CORS policy is acceptable here.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

LOCK_TTL = 10.0  # seconds without a heartbeat before a console lock auto-releases
PING_INTERVAL = 15.0  # SSE keep-alive comment interval


class Room:
    def __init__(self) -> None:
        self.snapshot: dict | None = None
        self.subscribers: set[asyncio.Queue] = set()
        self.lock_token: str | None = None
        self.lock_at: float = 0.0


rooms: dict[str, Room] = {}


def room(name: str) -> Room:
    r = rooms.get(name)
    if r is None:
        r = rooms[name] = Room()
    return r


async def _broadcast(r: Room, message: dict) -> None:
    dead = []
    for q in r.subscribers:
        try:
            q.put_nowait(message)
        except asyncio.QueueFull:
            dead.append(q)
    for q in dead:
        r.subscribers.discard(q)


def _lock_active(r: Room) -> bool:
    return r.lock_token is not None and (time.monotonic() - r.lock_at) < LOCK_TTL


@app.get("/healthz")
def healthz():
    return {"ok": True}


@app.get("/r/{name}/snapshot")
def get_snapshot(name: str):
    return JSONResponse(room(name).snapshot)


@app.post("/r/{name}/state")
async def post_state(name: str, request: Request):
    data = await request.json()
    r = room(name)
    r.snapshot = data
    await _broadcast(r, {"kind": "state", "data": data})
    return {"ok": True}


@app.post("/r/{name}/event")
async def post_event(name: str, request: Request):
    data = await request.json()
    await _broadcast(room(name), {"kind": "event", "data": data})
    return {"ok": True}


@app.get("/r/{name}/sse")
async def sse(name: str, request: Request):
    r = room(name)
    q: asyncio.Queue = asyncio.Queue(maxsize=100)
    r.subscribers.add(q)

    async def gen():
        try:
            # On connect, immediately resend the current snapshot so a late or
            # reconnecting display aligns to the latest truth.
            if r.snapshot is not None:
                yield f"data: {json.dumps({'kind': 'state', 'data': r.snapshot})}\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=PING_INTERVAL)
                    yield f"data: {json.dumps(msg)}\n\n"
                except asyncio.TimeoutError:
                    yield ": ping\n\n"  # keep-alive through proxies / Koyeb idle timeout
        finally:
            r.subscribers.discard(q)

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@app.post("/r/{name}/claim")
async def claim(name: str, request: Request):
    body = await request.json()
    r = room(name)
    if _lock_active(r) and not body.get("force"):
        return {"ok": False, "reason": "busy"}
    r.lock_token = secrets.token_urlsafe(8)
    r.lock_at = time.monotonic()
    return {"ok": True, "token": r.lock_token}


@app.post("/r/{name}/heartbeat")
async def heartbeat(name: str, request: Request):
    body = await request.json()
    r = room(name)
    if body.get("token") and body["token"] == r.lock_token:
        r.lock_at = time.monotonic()
        return {"ok": True}
    return {"ok": False}
