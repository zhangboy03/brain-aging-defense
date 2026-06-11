/* Blind Gomoku — pure rules engine (no DOM, no network).
 * Shared by index.html (player iPad) and admin.html (host console engine).
 * State shape & semantics: docs/superpowers/specs/2026-06-10-blind-gomoku-design.md §5.
 */
(function (global) {
  'use strict';
  const SIZE = 19;
  const COLORS = ['red', 'yellow', 'blue', 'green', 'pink', 'purple'];
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
    const x = m.x, y = m.y;
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
    for (const dir of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
      const dx = dir[0], dy = dir[1];
      const line = [[x, y]];
      for (const sign of [1, -1]) {
        let nx = x + dx * sign, ny = y + dy * sign;
        while (nx >= 0 && nx < SIZE && ny >= 0 && ny < SIZE && board[nx][ny] && board[nx][ny].s === s) {
          line.push([nx, ny]); nx += dx * sign; ny += dy * sign;
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
