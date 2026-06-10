# 盲五子棋（Blind Gomoku）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 复刻 The Devil's Plan 盲五子棋：两台 iPad（清华/北大）实时对战 + 主持人控制台权威引擎，前端 GitHub Pages，复用已部署的 SSE relay（零后端改动）。

**Architecture:** 控制台 = 唯一权威游戏引擎（订阅 SSE 收 iPad 的 move/join 事件，校验后用单飞串行 sender pushState 完整快照）；iPad = 乐观渲染的瘦客户端（只消费 state，按 epoch/v 接受，幽灵子按权威格内容裁决）。纯游戏逻辑收敛在无 DOM 的 `core.js`，node --test 可测。

**Tech Stack:** 原生 JS（IIFE，无构建依赖）、`public/sync.js`（现有）、FastAPI relay（现有，不改）、node:test、Vite 静态拷贝 + GitHub Pages。

**Spec:** `docs/superpowers/specs/2026-06-10-blind-gomoku-design.md`（下文 §n 均指 spec 章节）

---

## File Structure

```
public/blind-gomoku/core.js     # 纯逻辑：状态机 + 校验 + 胜负 + 版本接受规则（无 DOM/网络）
scripts/test_blind_gomoku.mjs   # node --test 单测（T1-T8, E1-E10 + join/版本规则）
public/blind-gomoku/index.html  # iPad 棋手页（选队/对战/揭示，全内联 JS+CSS）
public/blind-gomoku/admin.html  # 主持人控制台（引擎 + 上帝视角 + 锁管理）
README.md                       # 增补游戏说明（modify）
```

---

### Task 1: core.js 规则引擎（TDD）

**Files:**
- Create: `scripts/test_blind_gomoku.mjs`
- Create: `public/blind-gomoku/core.js`

**core.js 公开 API**（挂 `global.BlindGomoku`，模式同 `public/head-count/core.js` 的 IIFE）：

```js
SIZE = 15
COLORS = ['red','yellow','blue','green','pink','purple','white','black']
TEAMS = ['tsinghua','pku']
initialState(epoch) -> state            // §5 状态模型；v=1, gameId=0, phase='lobby'
applyJoin(state, team, deviceId) -> bool   // 改动返回 true 并 v++；幂等/被占/非法返回 false
startGame(state, rand) -> bool          // 两队都就位才行；随机 seats；清盘；gameId++；turn='b'
applyMove(state, {gameId,team,x,y,color}) -> bool  // 全部校验；落子；先判连五再判平局
forceEnd(state) -> bool                 // phase='finished', revealed=true, winner 不动
resetLobby(state) -> bool               // 回 lobby，清盘 + 清 seats + 清 joined，gameId 不动
checkWin(board, x, y) -> [[x,y],...]|null  // 从该点 4 方向扫描，≥5 返回完整连线
isNewer(current, incoming) -> bool      // epoch 大→真；同 epoch 比 v；current 为 null→真
```

- [ ] **Step 1: 写失败测试** — `scripts/test_blind_gomoku.mjs`，覆盖 spec §13 全部用例：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
await import('../public/blind-gomoku/core.js');
const G = globalThis.BlindGomoku;

function freshGame(rand = () => 0.3) {  // rand<0.5 → tsinghua 执黑（实现里固定这个映射）
  const s = G.initialState(1000);
  G.applyJoin(s, 'tsinghua', 'dev-A');
  G.applyJoin(s, 'pku', 'dev-B');
  G.startGame(s, rand);
  return s;
}
// 让指定真实色连续落子的辅助：黑白交替，白方垫在第 14 行不干扰
function play(s, moves) { for (const m of moves) assert.equal(G.applyMove(s, { gameId: s.gameId, ...m }), true, JSON.stringify(m)); }
function teamOf(s, stone) { return Object.keys(s.seats).find(t => s.seats[t] === stone); }
function altMoves(s, blackCells) {  // 黑方按给定坐标走，白方依次垫远处
  const out = []; let wi = 0;
  for (const [x, y] of blackCells) {
    out.push({ team: teamOf(s, 'b'), x, y, color: 'red' });
    out.push({ team: teamOf(s, 'w'), x: wi++, y: 14, color: 'blue' });
  }
  out.pop();  // 黑方第 5 子连五即终局，最后一手白方不存在
  return out;
}

test('T1 开局：seats 一黑一白, turn=b, phase=playing, gameId+1', () => {
  const s = G.initialState(1);
  assert.equal(G.startGame(s, () => 0.3), false);          // 没人就位不能开局
  G.applyJoin(s, 'tsinghua', 'A'); G.applyJoin(s, 'pku', 'B');
  const g0 = s.gameId, v0 = s.v;
  assert.equal(G.startGame(s, () => 0.3), true);
  assert.deepEqual([s.seats.tsinghua, s.seats.pku].sort(), ['b', 'w']);
  assert.equal(s.turn, 'b'); assert.equal(s.phase, 'playing');
  assert.equal(s.gameId, g0 + 1); assert.ok(s.v > v0);
});

test('T2 落子：board 记录 {s,c,n}，turn 翻转，v+1', () => {
  const s = freshGame(); const v0 = s.v;
  assert.equal(G.applyMove(s, { gameId: s.gameId, team: teamOf(s, 'b'), x: 7, y: 7, color: 'yellow' }), true);
  assert.deepEqual(s.board[7][7], { s: 'b', c: 'yellow', n: 1 });
  assert.equal(s.turn, 'w'); assert.equal(s.v, v0 + 1);
  assert.deepEqual(s.lastMove, { x: 7, y: 7 });
});

test('T3 横向连五 → finished + revealed + winLine', () => {
  const s = freshGame();
  play(s, altMoves(s, [[3,5],[4,5],[5,5],[6,5],[7,5]]));
  assert.equal(s.winner, 'b'); assert.equal(s.phase, 'finished');
  assert.equal(s.revealed, true);
  assert.deepEqual(s.winLine.map(String).sort(), [[3,5],[4,5],[5,5],[6,5],[7,5]].map(String).sort());
});

test('T4 纵向连五', () => {
  const s = freshGame();
  play(s, altMoves(s, [[2,3],[2,4],[2,5],[2,6],[2,7]]));
  assert.equal(s.winner, 'b'); assert.equal(s.winLine.length, 5);
});

test('T5 主对角连五', () => {
  const s = freshGame();
  play(s, altMoves(s, [[3,3],[4,4],[5,5],[6,6],[7,7]]));
  assert.equal(s.winner, 'b');
});

test('T6 副对角连五', () => {
  const s = freshGame();
  play(s, altMoves(s, [[7,3],[6,4],[5,5],[4,6],[3,7]]));
  assert.equal(s.winner, 'b');
});

test('T7 长连（6 连）算胜，winLine ≥5', () => {
  const s = freshGame();
  // 先摆 1,2,4,5,6 列，最后落 3 列连成 6
  play(s, altMoves(s, [[1,5],[2,5],[4,5],[5,5],[6,5]]));
  assert.equal(s.winner, null);            // 5 手互不连五
  play(s, [{ team: teamOf(s, 'w'), x: 9, y: 14, color: 'blue' },
           { team: teamOf(s, 'b'), x: 3, y: 5, color: 'red' }]);
  assert.equal(s.winner, 'b'); assert.ok(s.winLine.length >= 5);
});

test('T8 判定只看真实色不看表面色（白方用 black 表面子连五）', () => {
  const s = freshGame(); const W = teamOf(s, 'w'), B = teamOf(s, 'b');
  const seq = [];
  // 黑方垫在 14 行且间隔落子（x=0,2,4,6,8——绝不能连续 5 格，否则黑先连五），
  // 白方在第 5 行连五，全用 'black' 表面色
  for (let i = 0; i < 5; i++) {
    seq.push({ team: B, x: i * 2, y: 14, color: 'white' });
    seq.push({ team: W, x: 3 + i, y: 5, color: 'black' });
  }
  play(s, seq);
  assert.equal(s.winner, 'w');
});

test('E1 非本回合 move 被拒，v 不变', () => {
  const s = freshGame(); const v0 = s.v;
  assert.equal(G.applyMove(s, { gameId: s.gameId, team: teamOf(s, 'w'), x: 7, y: 7, color: 'red' }), false);
  assert.equal(s.v, v0);
});

test('E2 占用点被拒', () => {
  const s = freshGame();
  G.applyMove(s, { gameId: s.gameId, team: teamOf(s, 'b'), x: 7, y: 7, color: 'red' });
  const v0 = s.v;
  assert.equal(G.applyMove(s, { gameId: s.gameId, team: teamOf(s, 'w'), x: 7, y: 7, color: 'red' }), false);
  assert.equal(s.v, v0);
});

test('E3 越界/非整数被拒', () => {
  const s = freshGame(); const v0 = s.v; const B = teamOf(s, 'b');
  for (const [x, y] of [[15, 0], [-1, 0], [0, 15], [2.5, 3], [NaN, 1]]) {
    assert.equal(G.applyMove(s, { gameId: s.gameId, team: B, x, y, color: 'red' }), false);
  }
  assert.equal(s.v, v0);
});

test('E4 lobby/finished 阶段 move 被拒', () => {
  const s = G.initialState(1);
  G.applyJoin(s, 'tsinghua', 'A'); G.applyJoin(s, 'pku', 'B');
  assert.equal(G.applyMove(s, { gameId: 0, team: 'tsinghua', x: 0, y: 0, color: 'red' }), false);
  const s2 = freshGame(); G.forceEnd(s2); const v0 = s2.v;
  assert.equal(G.applyMove(s2, { gameId: s2.gameId, team: teamOf(s2, 'b'), x: 0, y: 0, color: 'red' }), false);
  assert.equal(s2.v, v0);
});

test('E5 过期 gameId 被拒', () => {
  const s = freshGame();
  assert.equal(G.applyMove(s, { gameId: s.gameId - 1, team: teamOf(s, 'b'), x: 0, y: 0, color: 'red' }), false);
});

test('E6+join 语义：占位/幂等/拒绝/换队释放/重置清空', () => {
  const s = G.initialState(1);
  assert.equal(G.applyJoin(s, 'tsinghua', 'A'), true);
  assert.equal(G.applyJoin(s, 'tsinghua', 'A'), false);     // 幂等
  assert.equal(G.applyJoin(s, 'tsinghua', 'B'), false);     // 被占拒绝
  assert.equal(s.joined.tsinghua, 'A');
  assert.equal(G.applyJoin(s, 'pku', 'A'), true);           // 换队
  assert.equal(s.joined.tsinghua, null);                    // 旧座位释放
  assert.equal(s.joined.pku, 'A');
  assert.equal(G.applyJoin(s, 'x', 'C'), false);            // 非法队名
  G.applyJoin(s, 'tsinghua', 'B'); G.startGame(s, () => 0.3);
  G.resetLobby(s);
  assert.equal(s.phase, 'lobby');
  assert.deepEqual(s.joined, { tsinghua: null, pku: null });
  assert.deepEqual(s.seats, { tsinghua: null, pku: null });
});

test('E7 225 手下满无连五 → draw', () => {
  const s = freshGame();
  // 构造永不连五的填充：行模式按 (y%2, floor(x/5)) 交错分配真实色是复杂的；
  // 改用引擎直填 board + moveCount 模拟最后一手前的局面（同样走 applyMove 校验路径太长）。
  // 用 3 行循环模式 bbwwb / wwbbw 保证任何方向最多 4 连（经典 gomoku 无胜局填充）。
  const pat = (x, y) => {
    const r = ['bbwwb', 'wwbbw', 'bwbwb'][y % 3]; // 含对角错位
    return r[x % 5] === 'b' ? 'b' : 'w';
  };
  for (let y = 0; y < 15; y++) for (let x = 0; x < 15; x++) {
    if (x === 14 && y === 14) continue;
    s.board[x][y] = { s: pat(x, y), c: 'red', n: 0 };
  }
  s.moveCount = 224;
  s.turn = pat(14, 14);
  const team = teamOf(s, s.turn);
  assert.equal(G.applyMove(s, { gameId: s.gameId, team, x: 14, y: 14, color: 'red' }), true);
  if (s.winner !== 'draw') {
    // 模式在 (14,14) 意外连五的话此断言给出明确信号
    assert.fail('填充模式在最后一手连五了，需换模式：winner=' + s.winner);
  }
  assert.equal(s.phase, 'finished'); assert.equal(s.revealed, true);
});

test('E8 边缘/角点连五正确，不越界', () => {
  const s = freshGame();
  play(s, altMoves(s, [[0,0],[0,1],[0,2],[0,3],[0,4]]));
  assert.equal(s.winner, 'b');
});

test('E9 第 225 手同时连五 → 算胜不算平', () => {
  const s = freshGame();
  for (let y = 0; y < 15; y++) for (let x = 0; x < 15; x++) s.board[x][y] = { s: 'w', c: 'red', n: 0 };
  // 腾出一行五连位给黑方：(0..4, 7)，其中 (4,7) 留空为最后一手
  for (let x = 0; x < 4; x++) s.board[x][7] = { s: 'b', c: 'red', n: 0 };
  s.board[4][7] = null;
  s.moveCount = 224; s.turn = 'b';
  assert.equal(G.applyMove(s, { gameId: s.gameId, team: teamOf(s, 'b'), x: 4, y: 7, color: 'red' }), true);
  assert.equal(s.winner, 'b');   // 不是 draw
});

test('E10 isNewer：epoch 优先，同 epoch 比 v，null 接受一切', () => {
  assert.equal(G.isNewer(null, { epoch: 1, v: 1 }), true);
  assert.equal(G.isNewer({ epoch: 1, v: 99 }, { epoch: 2, v: 1 }), true);   // epoch 大无条件赢
  assert.equal(G.isNewer({ epoch: 2, v: 5 }, { epoch: 2, v: 6 }), true);
  assert.equal(G.isNewer({ epoch: 2, v: 6 }, { epoch: 2, v: 6 }), false);
  assert.equal(G.isNewer({ epoch: 2, v: 6 }, { epoch: 1, v: 99 }), false);
});

test('forceEnd：winner 不动，revealed=true', () => {
  const s = freshGame(); G.applyMove(s, { gameId: s.gameId, team: teamOf(s, 'b'), x: 7, y: 7, color: 'red' });
  assert.equal(G.forceEnd(s), true);
  assert.equal(s.phase, 'finished'); assert.equal(s.revealed, true); assert.equal(s.winner, null);
});

test('随机分边覆盖两个分支', () => {
  const a = G.initialState(1); G.applyJoin(a, 'tsinghua', 'A'); G.applyJoin(a, 'pku', 'B');
  G.startGame(a, () => 0.1);
  const b = G.initialState(1); G.applyJoin(b, 'tsinghua', 'A'); G.applyJoin(b, 'pku', 'B');
  G.startGame(b, () => 0.9);
  assert.notEqual(a.seats.tsinghua, b.seats.tsinghua);
});
```

- [ ] **Step 2: 跑测试确认失败** — `node --test scripts/test_blind_gomoku.mjs`，预期：import core.js 报 ERR_MODULE_NOT_FOUND / 全部 fail。

- [ ] **Step 3: 实现 core.js**：

```js
/* Blind Gomoku — pure rules engine (no DOM, no network).
 * Shared by index.html (player iPad) and admin.html (host console engine).
 * State shape & semantics: docs/superpowers/specs/2026-06-10-blind-gomoku-design.md §5.
 */
(function (global) {
  'use strict';
  const SIZE = 15;
  const COLORS = ['red', 'yellow', 'blue', 'green', 'pink', 'purple', 'white', 'black'];
  const TEAMS = ['tsinghua', 'pku'];

  function emptyBoard() {
    return Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  }

  function initialState(epoch) {
    return {
      epoch, v: 1, gameId: 0, phase: 'lobby',
      seats: { tsinghua: null, pku: null },
      joined: { tsinghua: null, pku: null },
      turn: 'b', board: emptyBoard(), moveCount: 0, lastMove: null,
      winner: null, winLine: null, revealed: false, showNumbers: false,
    };
  }

  function applyJoin(state, team, deviceId) {
    if (!TEAMS.includes(team) || !deviceId) return false;
    if (state.joined[team] === deviceId) return false;       // idempotent
    if (state.joined[team] !== null) return false;           // seat taken by someone else
    const other = team === 'tsinghua' ? 'pku' : 'tsinghua';
    if (state.joined[other] === deviceId) state.joined[other] = null;  // team switch releases old seat
    state.joined[team] = deviceId;
    state.v++;
    return true;
  }

  function startGame(state, rand) {
    if (!state.joined.tsinghua || !state.joined.pku) return false;
    const black = (rand || Math.random)() < 0.5 ? 'tsinghua' : 'pku';
    state.seats = { tsinghua: black === 'tsinghua' ? 'b' : 'w', pku: black === 'pku' ? 'b' : 'w' };
    state.gameId++;
    state.phase = 'playing';
    state.turn = 'b';
    state.board = emptyBoard();
    state.moveCount = 0; state.lastMove = null;
    state.winner = null; state.winLine = null; state.revealed = false;
    state.v++;
    return true;
  }

  function applyMove(state, m) {
    if (state.phase !== 'playing') return false;
    if (!m || m.gameId !== state.gameId) return false;
    if (!TEAMS.includes(m.team)) return false;
    const stone = state.seats[m.team];
    if (!stone || stone !== state.turn) return false;
    const { x, y } = m;
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x >= SIZE || y < 0 || y >= SIZE) return false;
    if (state.board[x][y] !== null) return false;
    if (!COLORS.includes(m.color)) return false;
    state.board[x][y] = { s: stone, c: m.color, n: state.moveCount + 1 };
    state.moveCount++;
    state.lastMove = { x, y };
    const line = checkWin(state.board, x, y);
    if (line) {                       // win has priority over draw (spec §5)
      state.winner = stone; state.winLine = line;
      state.phase = 'finished'; state.revealed = true;
    } else if (state.moveCount >= SIZE * SIZE) {
      state.winner = 'draw'; state.phase = 'finished'; state.revealed = true;
    } else {
      state.turn = stone === 'b' ? 'w' : 'b';
    }
    state.v++;
    return true;
  }

  function checkWin(board, x, y) {
    const cell = board[x][y];
    if (!cell) return null;
    const s = cell.s;
    for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
      const line = [[x, y]];
      for (const dir of [1, -1]) {
        let nx = x + dx * dir, ny = y + dy * dir;
        while (nx >= 0 && nx < SIZE && ny >= 0 && ny < SIZE && board[nx][ny] && board[nx][ny].s === s) {
          line.push([nx, ny]); nx += dx * dir; ny += dy * dir;
        }
      }
      if (line.length >= 5) return line;
    }
    return null;
  }

  function forceEnd(state) {
    state.phase = 'finished'; state.revealed = true; state.v++;
    return true;
  }

  function resetLobby(state) {
    state.phase = 'lobby';
    state.seats = { tsinghua: null, pku: null };
    state.joined = { tsinghua: null, pku: null };
    state.board = emptyBoard(); state.moveCount = 0; state.lastMove = null;
    state.winner = null; state.winLine = null; state.revealed = false;
    state.v++;
    return true;
  }

  function isNewer(current, incoming) {
    if (!incoming || typeof incoming.epoch !== 'number') return false;
    if (!current) return true;
    if (incoming.epoch !== current.epoch) return incoming.epoch > current.epoch;
    return incoming.v > current.v;
  }

  global.BlindGomoku = {
    SIZE, COLORS, TEAMS,
    initialState, applyJoin, startGame, applyMove, checkWin, forceEnd, resetLobby, isNewer,
  };
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: 跑测试确认全绿** — `node --test scripts/test_blind_gomoku.mjs`，预期 pass 全部、fail 0。E7 的填充模式若意外连五会显式 fail 并提示换模式（届时调整 pat 的行模式字符串直到不连五，模式正确性由断言守护，不靠人脑验证）。

- [ ] **Step 5: Commit** — `git add public/blind-gomoku/core.js scripts/test_blind_gomoku.mjs && git commit -m "feat(blind-gomoku): pure rules engine with full unit tests"`

---

### Task 2: iPad 棋手页 index.html

**Files:**
- Create: `public/blind-gomoku/index.html`（内联 CSS+JS，引 `../sync.js` 与 `core.js`）

**页面状态机**：`select-team`（选队）→ `waiting`（已就位等开局）→ `playing` → `finished`。驱动源只有一个：`onState(s)`。

**视觉要求（§6，还原节目）**：深色岩洞底（#0d0b08 渐变）、棋盘为深蓝发光网格（cell 边框 rgba(80,160,255,.55) + 外框 box-shadow 蓝色 glow）、棋子为带高光的圆片、8 色调色盘圆形 swatch、揭示时 3D 翻面动画（CSS transform rotateY + 黑/白面）、获胜五连脉冲发光。横屏 iPad 优先：棋盘左、信息+调色盘右栏。所有交互元素 ≥44px 触控目标。

**核心客户端逻辑**（完整写出，markup/CSS 按上述要求实现）：

```js
const G = window.BlindGomoku;
const ROOM = 'blind-gomoku';
const deviceId = (() => {     // §5: localStorage，关标签重开仍是同一身份
  let id = localStorage.getItem('bg_device');
  if (!id) { id = Math.random().toString(36).slice(2, 10); localStorage.setItem('bg_device', id); }
  return id;
})();
let myTeam = sessionStorage.getItem('bg_team') || null;
let cur = null;               // 最新已接受 state
let ghost = null;             // {x, y, color, gameId, timer} 乐观渲染
let selColor = localStorage.getItem('bg_color') || 'red';
let lastMsgAt = Date.now();
let es = null;
const push = Sync.console(ROOM);   // 只用 pushEvent，不 claim（不抢锁）

function connect() {
  if (es) es.close();
  es = Sync.display(ROOM, onState, () => { lastMsgAt = Date.now(); });  // event 仅喂看门狗
  es.onopen = () => { lastMsgAt = Date.now(); setBanner(false); };
  es.onerror = () => setBanner(true);
}
connect();
setInterval(() => {            // §6.5 常开僵尸看门狗（90s 无消息即重建；ping 注释帧不可见，
  if (Date.now() - lastMsgAt > 90000) { lastMsgAt = Date.now(); connect(); }
}, 5000);                      //  所以以 state/event 消息为准；误触发无害）

function onState(s) {
  lastMsgAt = Date.now();
  if (!G.isNewer(cur, s)) return;       // §5 epoch/v 接受规则
  cur = s;
  adjudicateGhost(s);
  if (myTeam && s.joined[myTeam] === null) {           // §3 自愈 1：座位空才重发
    push.pushEvent({ type: 'join', team: myTeam, deviceId });
  }
  if (myTeam && s.joined[myTeam] && s.joined[myTeam] !== deviceId) {
    myTeam = null; sessionStorage.removeItem('bg_team'); // 被他机占用 → 回选队屏
    toast('该队已被占用，请重新选队');
  }
  render();
}

function adjudicateGhost(s) {   // §6: 以权威格内容裁决，不以"下一个 state"
  if (!ghost) return;
  if (s.gameId !== ghost.gameId) { clearGhost(); return; }
  const cell = s.board[ghost.x][ghost.y];
  if (cell) { clearGhost(); return; }                  // 已落子（无论谁的）→ 权威接管
  if (s.seats[myTeam] && s.turn !== s.seats[myTeam]) clearGhost();  // turn 翻转但格空 → 清除
}

function chooseTeam(team) {
  myTeam = team; sessionStorage.setItem('bg_team', team);
  push.pushEvent({ type: 'join', team, deviceId });
  render();
}

function tapCell(x, y) {
  if (!cur || cur.phase !== 'playing' || ghost) return;
  const myStone = cur.seats[myTeam];
  if (!myStone || cur.turn !== myStone || cur.board[x][y]) return;
  if (pending && pending.x === x && pending.y === y) {   // 二次确认：再点同格 = 确认
    pending = null;
    ghost = { x, y, color: selColor, gameId: cur.gameId,
      timer: setTimeout(() => { clearGhost(); toast('未送达，请重下'); render(); }, 5000) };  // §6 超时
    push.pushEvent({ type: 'move', gameId: cur.gameId, team: myTeam, x, y, color: selColor });
  } else {
    pending = { x, y };        // 第一次点 = 幽灵预览（可点别处改）
  }
  render();
}
let pending = null;

function clearGhost() { if (ghost) { clearTimeout(ghost.timer); ghost = null; } }
```

渲染函数 `render()`：按 `cur.phase` 切换四屏；棋盘循环 15×15 画 cell（已落子画 `cell.c` 表面色圆片；`cur.revealed` 时画 `cell.s` 黑/白面 + 翻面动画类；`cur.winLine` 加脉冲类；`cur.showNumbers` 时叠加 `cell.n` 序号）；顶栏显示队名 + 我的真实执色（`cur.seats[myTeam]`）+ 回合提示；`pending` 画半透明预览 + 「再点一次确认」提示；`ghost` 画半透明子。Wake Lock：`navigator.wakeLock?.request('screen')`，`visibilitychange` 回前台时重新申请，失败 toast 提示设置自动锁定为永不。

- [ ] **Step 1: 实现页面**（结构如上；CSS 按视觉要求；引 `<script src="../sync.js">` 和 `<script src="core.js">`）
- [ ] **Step 2: 本地冒烟** — 起 `python3 -m http.server` + 本地 relay（`uvicorn server.app:app`），`?backend=http://localhost:8000` 打开页面：选队 → 状态出现在 relay snapshot（curl 验证 join 事件无人消费时页面停在等待屏，不报错）。
- [ ] **Step 3: Commit** — `git commit -m "feat(blind-gomoku): iPad player page"`

---

### Task 3: 主持人控制台 admin.html

**Files:**
- Create: `public/blind-gomoku/admin.html`（内联 CSS+JS，引 `../sync.js` 与 `core.js`）

**职责**：权威引擎 + 上帝视角 + 流程控制 + 锁管理（§3 锁语义、§7）。

**核心逻辑**（完整写出）：

```js
const G = window.BlindGomoku;
const ROOM = 'blind-gomoku';
const BACKEND = Sync.BACKEND;
let auth = null;              // 权威 state（本控制台为引擎时非 null）
let readOnly = false;
let token = null;
let lastMsgAt = Date.now();
let es = null;

async function boot() {
  // 1) 锁：claim，busy 自动 force 一次（§7 覆盖刷新后 10s 旧锁窗口）
  let r = await post('claim', {});
  if (!r.ok) r = await post('claim', { force: true });
  token = r.token;
  setInterval(heartbeat, 4000);          // 自管心跳：检查响应（sync.js 的内置心跳不可检查）
  // 2) 恢复：有快照 → 沿用其 epoch 续 v；无快照 → 新 epoch（§5）
  const snap = await fetch(BACKEND + '/r/' + ROOM + '/snapshot').then(r => r.json()).catch(() => null);
  auth = (snap && typeof snap.epoch === 'number') ? snap : G.initialState(Date.now());
  connect();
  pushAuth();                            // 上线即广播一次当前真相
  render();
}

async function post(path, body) {
  return fetch(BACKEND + '/r/' + ROOM + '/' + path, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }).then(r => r.json());
}

async function heartbeat() {
  if (readOnly) return;
  try {
    const r = await post('heartbeat', { token });
    if (!r.ok) enterReadOnly();          // §3：失锁立即停引擎，防 split-brain
  } catch (_) { /* 网络错不算失锁 */ }
}
function enterReadOnly() { readOnly = true; render(); }   // 横幅 + 「重新接管」按钮
async function retakeover() {                              // §7 发现5：被关掉的接管者留下真空
  const r = await post('claim', { force: true });
  token = r.token;
  const snap = await fetch(BACKEND + '/r/' + ROOM + '/snapshot').then(r => r.json()).catch(() => null);
  if (snap && G.isNewer(auth, snap)) auth = snap;          // 接管前先对齐对方可能推过的进度
  readOnly = false; pushAuth(); render();
}

// —— 单飞串行 sender（§3 自愈 2：永远发当前最新，绝不重试旧 payload）——
let sending = false, dirty = false;
async function pushAuth() {
  if (readOnly) return;
  if (sending) { dirty = true; return; }
  sending = true;
  try {
    await Sync.console(ROOM).pushState(auth);   // 失败走 catch；成功落快照
  } catch (_) {
    dirty = true;                                // 失败 → 稍后再发最新值
    setTimeout(() => { sending = false; if (dirty) { dirty = false; pushAuth(); } }, 1000);
    return;
  }
  sending = false;
  if (dirty) { dirty = false; pushAuth(); }
}

function connect() {
  if (es) es.close();
  es = Sync.display(ROOM, () => { lastMsgAt = Date.now(); }, onEvent);  // §3：忽略 state 回显
  es.onopen = () => { lastMsgAt = Date.now(); if (!readOnly && auth) pushAuth(); };  // 重连重推
}
setInterval(() => {                                  // 控制台同样需要看门狗
  if (Date.now() - lastMsgAt > 90000) { lastMsgAt = Date.now(); connect(); }
}, 5000);

function onEvent(e) {
  lastMsgAt = Date.now();
  if (readOnly || !auth || !e) return;
  let changed = false;
  if (e.type === 'join') changed = G.applyJoin(auth, e.team, e.deviceId);
  else if (e.type === 'move') {
    changed = G.applyMove(auth, e);
    if (changed) logMove(e);                          // 着法记录侧栏
  }
  if (changed) { pushAuth(); render(); }
}

// 控制台动作（按钮 onclick）
function startGame()  { if (G.startGame(auth, Math.random)) { pushAuth(); render(); } }
function resetLobby() { if (confirm('重置将清空棋盘和就位状态，确定？') && G.resetLobby(auth)) { pushAuth(); render(); } }
function forceEnd()   { if (confirm('强制结束并揭示全盘？') && G.forceEnd(auth)) { pushAuth(); render(); } }
function toggleNumbers(on) { auth.showNumbers = on; auth.v++; pushAuth(); render(); }
boot();
```

**渲染**：上帝视角棋盘——每子外环表面色、内圈真实黑白、角标序号；着法记录 `第n手 清华(黑) H8 表面红`（坐标列 A–O 行 1–15）；就位指示灯×2；「开始新一局」按钮 disabled 条件 `!(auth.joined.tsinghua && auth.joined.pku) || auth.phase==='playing'`；readOnly 时全按钮禁用 + 顶部横幅「已被另一控制台接管 [重新接管]」。

- [ ] **Step 1: 实现页面**
- [ ] **Step 2: 本地三窗口冒烟** — 本地 relay + 三个浏览器窗口（admin + 2 player）跑通：选队→开局→交替落子→连五→三屏揭示。再验：关 admin 刷新恢复（C5）、player 断网重连对齐（C3 雏形）。
- [ ] **Step 3: Commit** — `git commit -m "feat(blind-gomoku): host console engine page"`

---

### Task 4: README + 构建验证

**Files:**
- Modify: `README.md`（「多屏实时同步」节后加盲五子棋小节：玩法一句话、三个 URL、房间名）

- [ ] **Step 1: README 增补**（中英对应位置，含规则 3 行摘要 + 链接 spec）
- [ ] **Step 2: 构建 + 全测试** — `npm run build`（确认 dist/blind-gomoku/ 三文件就位）+ `node --test scripts/test_blind_gomoku.mjs` + `cd server && python3 -m pytest -q`（确认零后端改动没碰坏）
- [ ] **Step 3: Commit** — `git commit -m "docs(blind-gomoku): README section"`

---

### Task 5: 部署 + 线上验收

- [ ] **Step 1: push main**（用户已授权部署）— `git push origin main`
- [ ] **Step 2: 等 Pages workflow 完成** — `gh run watch`；然后 `curl -sI https://zhangboy03.github.io/brain-aging-defense/blind-gomoku/ | head -1` 与 `admin.html` 同理，预期 `HTTP/2 200`
- [ ] **Step 3: 线上烟测（C2/C6）** — relay `curl https://brain-aging-sync.ai-builders.space/healthz` 预期 `{"ok":true}`；浏览器三窗口指向线上 URL 跑一整局（20 手内含连五揭示），目测同步 ≤1s
- [ ] **Step 4: 验收记录** — 把 C1–C6 核验结果写进最终汇报（C3 锁屏 30s 真机项留给用户 iPad 实测，标注）
