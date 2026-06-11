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
  // 用 3 行循环模式保证 (14,14) 落子处任何方向不足 5 连；
  // 若模式意外连五，下方显式 fail 提示换模式（断言守护，不靠人脑验证）。
  const pat = (x, y) => {
    const r = ['bbwwb', 'wwbbw', 'bwbwb'][y % 3];
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
