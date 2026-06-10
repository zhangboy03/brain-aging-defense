# 跨设备实时同步 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让一台电脑控制台经一个自建 SSE 中转后端，实时同步控制多台外部大屏（双 iPad 场景）。

**Architecture:** 新增 FastAPI 单进程中转后端（部署到 AI Builder Space），控制台 `POST` 推 state 快照 / event 命令，大屏经 SSE 订阅并扇出。游戏页面仍在 GitHub Pages，新增共享 `public/sync.js` 客户端；后端不可达时回退到原 `localStorage`/`BroadcastChannel`。

**Tech Stack:** Python 3.11 / FastAPI / Starlette `StreamingResponse`（手写 SSE，零额外依赖）/ uvicorn；前端原生 JS `EventSource` + `fetch`；Docker；部署 AI Builder Space（Koyeb）。

参见 spec：`docs/superpowers/specs/2026-06-10-cross-device-sync-design.md`

---

## 文件结构

```
server/app.py            # FastAPI 中转：房间状态 + SSE 扇出 + 控制台锁
server/requirements.txt  # fastapi, uvicorn
server/test_app.py       # pytest：状态存取、扇出、锁、SSE 首帧
Dockerfile               # 根目录，只构建后端
.dockerignore            # 挡前端产物
public/sync.js           # 共享客户端同步层（display / console 两种角色 + 本地回退）
public/hexagon/index.html, admin.html      # 接 sync.js（声明式 state）
public/head-count/index.html, player.html  # 接 sync.js（state 快照 + event 命令）
deploy.sh                # 触发 AI Builder Space 部署（不含密钥，token 从环境读）
```

后端公网地址：`https://brain-aging-sync.ai-builders.space`

---

## Task 1: 后端骨架 + 房间状态存取（TDD）

**Files:**
- Create: `server/app.py`
- Create: `server/requirements.txt`
- Create: `server/test_app.py`
- Create: `server/__init__.py`（空文件，保证 `server.app` 可导入）

- [ ] **Step 1: 写依赖文件**

`server/requirements.txt`:
```
fastapi==0.115.6
uvicorn==0.34.0
```

- [ ] **Step 2: 写失败测试**

`server/test_app.py`:
```python
from fastapi.testclient import TestClient
from server.app import app

client = TestClient(app)

def test_health():
    assert client.get("/healthz").json() == {"ok": True}

def test_state_roundtrip():
    # 推一个 state 后，GET 当前快照能拿回同样的内容
    client.post("/r/hexagon/state", json={"phase": "memorize", "round": 3})
    snap = client.get("/r/hexagon/snapshot").json()
    assert snap == {"phase": "memorize", "round": 3}

def test_rooms_isolated():
    client.post("/r/hexagon/state", json={"a": 1})
    client.post("/r/head-count/state", json={"b": 2})
    assert client.get("/r/hexagon/snapshot").json() == {"a": 1}
    assert client.get("/r/head-count/snapshot").json() == {"b": 2}
```

- [ ] **Step 3: 跑测试，确认失败**

Run: `cd /Users/keeplearning/Projects/brain-aging-defense && python3 -m pytest server/test_app.py -v`
Expected: FAIL（`server.app` 不存在 / 端点 404）

- [ ] **Step 4: 写最小实现**

`server/__init__.py`: 空文件。

`server/app.py`:
```python
import asyncio, json, os
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse, JSONResponse, Response

app = FastAPI()

# 每个房间：最新 state 快照 + 在线订阅者队列集合 + 锁信息
class Room:
    def __init__(self):
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

@app.get("/healthz")
def healthz():
    return {"ok": True}

@app.get("/r/{name}/snapshot")
def get_snapshot(name: str):
    return JSONResponse(room(name).snapshot)
```

- [ ] **Step 5: 跑测试，确认通过**

Run: `python3 -m pip install fastapi==0.115.6 uvicorn==0.34.0 httpx pytest -q && python3 -m pytest server/test_app.py -v`
Expected: 3 passed（`test_state_roundtrip`/`test_rooms_isolated` 还会失败，因为 `/state` POST 未实现 → 留到 Task 2 一起，先让 health 过）

注：本任务先实现 health + snapshot 读取。`/state` 的 POST 在 Task 2 实现，届时这两个测试转绿。若希望本步严格 TDD，可暂时只断言 `test_health`。

- [ ] **Step 6: Commit**

```bash
git add server/__init__.py server/app.py server/requirements.txt server/test_app.py
git commit -m "feat(sync): backend skeleton with room snapshot store"
```

---

## Task 2: 控制台推送 state / event + SSE 扇出（TDD）

**Files:**
- Modify: `server/app.py`
- Modify: `server/test_app.py`

- [ ] **Step 1: 追加失败测试**

追加到 `server/test_app.py`:
```python
def test_post_state_updates_snapshot():
    r = client.post("/r/t1/state", json={"x": 9})
    assert r.json() == {"ok": True}
    assert client.get("/r/t1/snapshot").json() == {"x": 9}

def test_sse_sends_snapshot_first():
    # 先放一个快照，新订阅者连上后第一帧应是该快照
    client.post("/r/t2/state", json={"hello": "world"})
    with client.stream("GET", "/r/t2/sse") as s:
        for line in s.iter_lines():
            if line.startswith("data:"):
                payload = json.loads(line[5:].strip())
                assert payload == {"kind": "state", "data": {"hello": "world"}}
                break

def test_cors_header_present():
    r = client.post("/r/t3/state", json={"a": 1},
                    headers={"Origin": "https://zhangboy03.github.io"})
    assert r.headers.get("access-control-allow-origin") == "*"
```

文件顶部补 `import json`（已在实现中）。

- [ ] **Step 2: 跑测试确认失败**

Run: `python3 -m pytest server/test_app.py -v`
Expected: 新增 3 个 FAIL（POST /state、/sse 未实现）

- [ ] **Step 3: 实现 POST state/event + SSE + CORS**

在 `server/app.py` 末尾追加，并在文件顶部确保 `from fastapi.middleware.cors import CORSMiddleware`：

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # 低风险展示用途；锁仅防误开第二控制台
    allow_methods=["*"],
    allow_headers=["*"],
)

async def _broadcast(r: Room, message: dict):
    dead = []
    for q in r.subscribers:
        try:
            q.put_nowait(message)
        except asyncio.QueueFull:
            dead.append(q)
    for q in dead:
        r.subscribers.discard(q)

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
            # 连上立即补发当前快照
            if r.snapshot is not None:
                yield f"data: {json.dumps({'kind': 'state', 'data': r.snapshot})}\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=15)
                    yield f"data: {json.dumps(msg)}\n\n"
                except asyncio.TimeoutError:
                    yield ": ping\n\n"   # 保活
        finally:
            r.subscribers.discard(q)

    return StreamingResponse(gen(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
        "Connection": "keep-alive",
    })
```

- [ ] **Step 4: 跑测试确认通过**

Run: `python3 -m pytest server/test_app.py -v`
Expected: 全部 passed（含 Task 1 里挂起的两个）

- [ ] **Step 5: Commit**

```bash
git add server/app.py server/test_app.py
git commit -m "feat(sync): console push (state/event) and SSE fan-out with keep-alive"
```

---

## Task 3: 单控制台锁（claim + heartbeat，TDD）

**Files:**
- Modify: `server/app.py`
- Modify: `server/test_app.py`

- [ ] **Step 1: 追加失败测试**

```python
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
    client.post("/r/lk3/claim", json={"force": True})  # 抢走锁
    hb = client.post("/r/lk3/heartbeat", json={"token": a["token"]}).json()
    assert hb["ok"] is False   # 旧 token 已失效
```

锁过期（10s 无心跳自动释放）用时间注入便于测试：实现里用模块级 `now()`，测试可 monkeypatch；本计划用真实时间但过期测试不强求（上面三测不依赖过期计时）。

- [ ] **Step 2: 跑测试确认失败**

Run: `python3 -m pytest server/test_app.py -k "claim or force or heartbeat" -v`
Expected: FAIL（端点未实现）

- [ ] **Step 3: 实现锁**

在 `server/app.py` 顶部加 `import time, secrets`；`LOCK_TTL = 10.0`。追加：

```python
def _lock_active(r: Room) -> bool:
    return r.lock_token is not None and (time.monotonic() - r.lock_at) < LOCK_TTL

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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `python3 -m pytest server/test_app.py -v`
Expected: 全部 passed

- [ ] **Step 5: Commit**

```bash
git add server/app.py server/test_app.py
git commit -m "feat(sync): single-console lock via claim/heartbeat with TTL"
```

---

## Task 4: Dockerfile + .dockerignore + 本地容器冒烟

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`

- [ ] **Step 1: 写 Dockerfile**（只构建后端，避开 node_modules）

`Dockerfile`:
```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY server/requirements.txt ./server/requirements.txt
RUN pip install --no-cache-dir -r server/requirements.txt
COPY server/ ./server/
EXPOSE 8000
CMD sh -c "uvicorn server.app:app --host 0.0.0.0 --port ${PORT:-8000}"
```

- [ ] **Step 2: 写 .dockerignore**

`.dockerignore`:
```
node_modules
dist
src
public
.git
.github
.accelerate
.gstack
docs
*.tsbuildinfo
.DS_Store
```

- [ ] **Step 3: 本地直接用 uvicorn 冒烟（无需 Docker）**

Run:
```bash
cd /Users/keeplearning/Projects/brain-aging-defense
python3 -m uvicorn server.app:app --port 8000 &
sleep 2
curl -s localhost:8000/healthz
curl -s -X POST localhost:8000/r/demo/state -H 'content-type: application/json' -d '{"phase":"go"}'
curl -s localhost:8000/r/demo/snapshot
kill %1
```
Expected: `{"ok":true}` / `{"ok":true}` / `{"phase":"go"}`

- [ ] **Step 4: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "build(sync): backend Dockerfile and dockerignore for AI Builder Space"
```

---

## Task 5: 共享客户端 `public/sync.js`

**Files:**
- Create: `public/sync.js`

- [ ] **Step 1: 写 sync.js**

`public/sync.js`（原生 JS，挂到 `window.Sync`）：
```javascript
(function () {
  const BACKEND = "https://brain-aging-sync.ai-builders.space";

  async function reachable() {
    try {
      const r = await fetch(BACKEND + "/healthz", { cache: "no-store" });
      return r.ok;
    } catch { return false; }
  }

  // 大屏：订阅房间。onState(snapshot) / onEvent(evt)。自动重连由 EventSource 负责，
  // 每次重连后端会重发当前快照 → 自动对齐。
  function display(room, onState, onEvent) {
    const es = new EventSource(`${BACKEND}/r/${room}/sse`);
    es.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.kind === "state") onState && onState(msg.data);
      else if (msg.kind === "event") onEvent && onEvent(msg.data);
    };
    return es;
  }

  // 控制台：推送 + 锁。
  function consoleRole(room) {
    let token = null, hb = null;
    const post = (path, body) =>
      fetch(`${BACKEND}/r/${room}/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body || {}),
      }).then((r) => r.json());

    async function claim(force) {
      const res = await post("claim", { force: !!force });
      if (res.ok) {
        token = res.token;
        clearInterval(hb);
        hb = setInterval(() => post("heartbeat", { token }), 4000);
      }
      return res; // {ok, token} 或 {ok:false, reason:"busy"}
    }
    const pushState = (s) => post("state", s);
    const pushEvent = (e) => post("event", e);
    return { claim, pushState, pushEvent };
  }

  window.Sync = { BACKEND, reachable, display, console: consoleRole };
})();
```

- [ ] **Step 2: 语法自检**

Run: `node --check public/sync.js && echo OK`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add public/sync.js
git commit -m "feat(sync): shared client sync layer (display/console + local fallback hook)"
```

---

## Task 6: 接入 hexagon（声明式 state，含倒计时优化）

**Files:**
- Modify: `public/hexagon/admin.html`
- Modify: `public/hexagon/index.html`

设计：hexagon 大屏渲染完全由完整状态 `S` 决定，因此**只用 state**。
控制台 `publish()` 既写本地（回退）又 `Sync.console.pushState(S)`；
大屏用 `Sync.display(room, render)` 接收远端 `S` 并 `render(S)`。
倒计时：`S` 里加 `endAt`（毫秒时间戳），大屏本地 tick 显示剩余秒，减少消息量。

- [ ] **Step 1: index.html（大屏）引入 sync.js 并订阅**

在 `public/hexagon/index.html` 的 `<script>` 之前加：
```html
<script src="../sync.js"></script>
```
在其 IIFE 内，`load()`/`render()` 已存在。把现有的 `storage` + `BroadcastChannel` 监听**保留作回退**，并追加远端订阅（放在 `render(load())` 初始化之后）：
```javascript
// 远端订阅（跨设备）。后端推完整 S，直接 render。
if (window.Sync) {
  Sync.display('hexagon', (S) => render(S));
}
// 本地 endAt → 本地 tick（若 S 带 endAt，则用它推算剩余秒）
```
在 `render(s)` 内，计时显示改为：若 `s.endAt`，`const left = Math.max(0, Math.ceil((s.endAt - Date.now())/1000)); s.timer = left;` 之前使用 `s.timer` 的地方改读 `left`。并在大屏侧启动一个 `setInterval(()=>{ if(lastS && lastS.endAt) render(lastS); }, 250)`，`lastS` 缓存最近一次 state。

- [ ] **Step 2: admin.html（控制台）推送 state + endAt + 领锁**

在 `public/hexagon/admin.html` 顶部 `<script>` 之前加 `<script src="../sync.js"></script>`。

改 `publish()`（原：写 localStorage + `bc.postMessage(S)` + render）：
```javascript
let _sync = null;
function publish(){
  S.teams={thu:name('thu'),pku:name('pku')};
  localStorage.setItem(K,JSON.stringify(S));   // 本地回退
  bc&&bc.postMessage(S);                        // 同设备回退
  if(_sync) _sync.pushState(S);                 // 跨设备
  render();
}
```

倒计时改为携带 `endAt`，让大屏本地 tick。改 `countdown()`：
```javascript
function countdown(sec,done){
  stop();timerDone=done;
  const end=Date.now()+sec*1000;
  S.timer=sec; S.endAt=end;            // 携带结束时间戳
  publish();
  T=setInterval(()=>{
    S.timer=Math.max(0,Math.ceil((end-Date.now())/1000));
    render();                          // 控制台本地刷新，不再每 tick publish
    if(S.timer<=0){let f=timerDone;stop();f&&f()}
  },250);
}
```
注意：原 `countdown` 每 250ms `publish()`；改后只在开始时 publish 一次（带 endAt），tick 仅本地 `render()`。其它 phase 切换处仍各自 publish（已有）。

页面加载后领锁（在 `publish()`/`E` 初始化之后）：
```javascript
window.addEventListener('load', async () => {
  if(!window.Sync) return;
  _sync = Sync.console('hexagon');
  const res = await _sync.claim(false);
  if(!res.ok){
    if(confirm('已有一个控制台在线，是否强制接管？')) await _sync.claim(true);
  }
});
```

- [ ] **Step 3: 语法/本地验证**

Run:
```bash
node --check public/hexagon/admin.html 2>/dev/null || echo "(html, skip node-check)"
cd /Users/keeplearning/Projects/brain-aging-defense && python3 -m http.server 5500 &
sleep 1
echo "手测：浏览器开 http://localhost:5500/public/hexagon/admin.html 与 .../index.html，开始比赛看是否同步"
kill %1 2>/dev/null
```
（HTML 内嵌 JS 无法 node --check；用 Task 9 的浏览器联调验证。）

- [ ] **Step 4: Commit**

```bash
git add public/hexagon/admin.html public/hexagon/index.html
git commit -m "feat(sync): wire hexagon to relay (declarative state + endAt countdown)"
```

---

## Task 7: 接入 head-count（state 快照 + event 命令）

**Files:**
- Modify: `public/head-count/index.html`（控制台）
- Modify: `public/head-count/player.html`（大屏）

设计：把控制台维护一个 `snapshot = {round, roundNo, phase, scores}` 作为 state；
动画触发（`start`/`reveal`/`reset`）作为 event。大屏：收到 state 渲染静态画面，
收到 event 播动画。`verdict`/`scores` 走 state（写进 snapshot 并重推）。

- [ ] **Step 1: index.html 控制台改造**

`public/head-count/index.html`：`<script src="core.js">` 之后、内联脚本里。
顶部加 `<script src="../sync.js"></script>`（在 core.js 之后即可）。

在内联脚本 `const bc = ...` 后加：
```javascript
let _sync = null, _snap = { round: null, roundNo: state.roundNo, phase: 'idle', scores: state.scores };
function pushSnap(patch){
  Object.assign(_snap, patch);
  if(_sync) _sync.pushState(_snap);
}
function pushEvt(type, extra){
  const m = Object.assign({ type }, extra || {});
  if(_sync) _sync.pushEvent(m);
}
```

改 `post(msg)`（原只 `bc.postMessage`）——保留 bc 回退，并按语义分流：
```javascript
function post(msg){
  if(bc) bc.postMessage(msg);            // 同设备回退（player 仍听 bc）
  if(!msg || !msg.type) return;
  switch(msg.type){
    case 'round':   pushSnap({ round: msg.round, roundNo: msg.roundNo, phase: 'ready' });
                    pushEvt('round', { round: msg.round, roundNo: msg.roundNo }); break;
    case 'start':   pushSnap({ phase: 'observe' }); pushEvt('start'); break;
    case 'reveal':  pushSnap({ phase: 'reveal' });  pushEvt('reveal'); break;
    case 'reset':   pushSnap({ phase: 'idle', round: null }); pushEvt('reset'); break;
    case 'scores':  pushSnap({ scores: { thu: msg.thu, pku: msg.pku }, roundNo: msg.roundNo }); break;
    case 'verdict': pushEvt('verdict', { team: msg.team, value: msg.value }); break;
    case 'ping':    pushEvt('ping'); break;
  }
}
```
说明：`round`/`start`/`reveal`/`reset` 既更新 snapshot（中途连入可恢复）又发 event（在线者播动画）；`scores` 只走 state；`verdict` 是瞬时提示，走 event（中途连入不补，无碍）。

页面加载领锁：
```javascript
window.addEventListener('load', async () => {
  if(!window.Sync) return;
  _sync = Sync.console('head-count');
  const res = await _sync.claim(false);
  if(!res.ok && confirm('已有一个控制台在线，是否强制接管？')) await _sync.claim(true);
  pushSnap({});  // 推一次初始 snapshot
});
```

- [ ] **Step 2: player.html 大屏改造**

`public/head-count/player.html`：顶部 `<script src="../sync.js"></script>`（在引用 core/stage 之后、内联 `<script>` 之前）。

现有 `handle(msg)` 已能处理 `round/start/reveal/reset/scores/verdict/ping`。新增：
- 远端 **state** → 渲染静态画面（恢复用）：
- 远端 **event** → 复用现有 `handle()` 的动画分支。

在 `if (bc) { bc.onmessage = ... }` 附近追加：
```javascript
if (window.Sync) {
  Sync.display('head-count',
    (snap) => {            // state：恢复静态画面
      if (snap.scores) { numThu.textContent = snap.scores.thu; numPku.textContent = snap.scores.pku; }
      if (snap.round) {
        stage.setRound(snap.round);
        waiting.style.display = 'none';
        roundtag.textContent = `第 ${snap.roundNo || 1} 题 · ${snap.round.presetLabel}`;
        if (snap.phase === 'reveal') stage.reveal();
        else if (snap.phase === 'idle') { stage.reset(); waiting.style.display='flex'; }
      } else if (snap.phase === 'idle') {
        stage.reset(); waiting.style.display='flex'; waiting.textContent='等待主持人开始…';
      }
    },
    (evt) => handle(evt)   // event：复用动画处理
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add public/head-count/index.html public/head-count/player.html
git commit -m "feat(sync): wire head-count to relay (state snapshot + event commands)"
```

---

## Task 8: 大屏防息屏（Screen Wake Lock）

**Files:**
- Modify: `public/hexagon/index.html`
- Modify: `public/head-count/player.html`

- [ ] **Step 1: 两个大屏页内联脚本末尾各加**

```javascript
// iPad 大屏防息屏（Safari 16.4+）
let _wake = null;
async function keepAwake(){
  try { _wake = await navigator.wakeLock.request('screen'); } catch {}
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') keepAwake();
});
keepAwake();
```

- [ ] **Step 2: 语法确认 + Commit**

Run: `git add public/hexagon/index.html public/head-count/player.html && git commit -m "feat(sync): keep display awake via Screen Wake Lock"`

---

## Task 9: 本地双窗口联调（人工验证）

**Files:** 无（验证）

- [ ] **Step 1: 起后端 + 静态服**

Run:
```bash
cd /Users/keeplearning/Projects/brain-aging-defense
python3 -m uvicorn server.app:app --port 8000 &
python3 -m http.server 5500 &
```
临时把 `public/sync.js` 顶部 `BACKEND` 指到 `http://localhost:8000` 做本地联调（验证后改回线上域名再部署）。

- [ ] **Step 2: 验证清单（两个浏览器窗口模拟控制台 + 大屏）**

- hexagon：admin 开始比赛 → index 大屏 1 秒内出现同样棋盘/目标/倒计时。
- head-count：admin 出题→开始→揭晓 → player 大屏动画跟随。
- 关掉 player 再开 → 立即显示当前题目/比分（快照恢复）。
- 第二个控制台打开 → 提示「已有控制台在线」。

- [ ] **Step 3: 联调通过后把 BACKEND 改回线上域名**

确认 `public/sync.js` 的 `BACKEND = "https://brain-aging-sync.ai-builders.space"`。
```bash
git add public/sync.js && git commit -m "chore(sync): point client at production backend url" --allow-empty
```

---

## Task 10: 部署到 AI Builder Space

**Files:**
- Create: `deploy.sh`（不含密钥）

- [ ] **Step 1: 推送所有改动到 GitHub**（部署系统从 GitHub 拉代码）

```bash
git push origin main
```
（按用户全局规则：push 前需用户明确同意——执行时先征得同意。）

- [ ] **Step 2: 写 deploy.sh（token 从环境变量读，绝不提交密钥）**

`deploy.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
: "${AI_BUILDER_TOKEN:?set AI_BUILDER_TOKEN first}"
curl -sS -X POST "https://space.ai-builders.com/backend/v1/deployments" \
  -H "Authorization: Bearer ${AI_BUILDER_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "repo_url": "https://github.com/zhangboy03/brain-aging-defense",
    "service_name": "brain-aging-sync",
    "branch": "main"
  }'
```

- [ ] **Step 3: 触发部署**

Run: `AI_BUILDER_TOKEN=<用户的token> bash deploy.sh`
Expected: 返回部署状态 + `streaming_logs`。若 logs 为空，核对 repo/branch。

- [ ] **Step 4: 轮询状态（5–10 分钟）**

用 MCP 工具 `mcp__ai-builders-coach__*` 或：
```bash
curl -sS "https://space.ai-builders.com/backend/v1/deployments/brain-aging-sync/logs" \
  -H "Authorization: Bearer ${AI_BUILDER_TOKEN}"
```
就绪后：`curl -s https://brain-aging-sync.ai-builders.space/healthz` → `{"ok":true}`

- [ ] **Step 5: 线上端到端验证**

- 电脑开 `https://zhangboy03.github.io/brain-aging-defense/hexagon/admin.html`
- 两台 iPad 开 `.../hexagon/index.html`（或 head-count player）
- 控制台操作，两 iPad 同步；锁屏/切网后自动重连对齐。

- [ ] **Step 6: Commit**

```bash
git add deploy.sh && git commit -m "build(sync): add AI Builder Space deploy script"
```

---

## Self-Review（计划对照 spec）

- 后端 state/event/SSE/lock：Task 1–3 覆盖 spec §5/§6。✓
- 部署约束（Dockerfile/单进程/PORT/256MB）：Task 4。✓
- 客户端共享层 + 回退：Task 5。✓
- hexagon 声明式 + 倒计时优化：Task 6 覆盖 spec §4/§9。✓
- head-count state+event 双语义：Task 7 覆盖 spec §4。✓
- iPad 可靠性：保活心跳（Task 2）、自动重连+重连补发快照（Task 2 SSE + Task 5 EventSource）、防息屏（Task 8）、禁缓冲头（Task 2）。覆盖 spec §8。✓
- 单控制台提示/接管：Task 3 + Task 6/7 前端。✓
- 成功标准（1 秒内同步、重连恢复、中途连入、第二控制台提示、本地回退）：Task 9 验证清单。✓

类型/命名一致性：`Sync.display/Sync.console`、`pushState/pushEvent/claim`、消息 `{kind, data}`、snapshot 字段 `{round, roundNo, phase, scores}` 在 Task 5/6/7 间一致。✓
