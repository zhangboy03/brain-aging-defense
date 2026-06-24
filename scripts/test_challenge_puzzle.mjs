import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../public/challenge-puzzle/core.js', import.meta.url), 'utf8');
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(src, ctx);
const C = ctx.window.ChallengePuzzle;

test('startRound reveals one puzzle and starts one shared timer for both teams', () => {
  const state = C.freshState();
  C.startRound(state, C.PUZZLES[0], 180000);

  assert.equal(state.phase, 'solving');
  assert.equal(state.round, 1);
  assert.equal(state.puzzle.id, 'area-gate');
  assert.equal(state.durationMs, 180000);
  assert.equal(state.results.thu, null);
  assert.equal(state.results.pku, null);
  assert.equal(state.winner, '');
});

test('puzzle pack has proven max steps and answer grids', () => {
  for (const puzzle of C.PUZZLES) {
    assert.equal(C.upperBoundStep(puzzle), puzzle.maxStep, `${puzzle.id} upper bound`);
    assert.equal(C.maxAchievableStep(puzzle), puzzle.maxStep, `${puzzle.id} max step`);
    assert.ok(C.answerGrid(puzzle, puzzle.maxStep), `${puzzle.id} has an answer`);
    assert.equal(C.findSolution(puzzle, puzzle.maxStep + 1), null, `${puzzle.id} rejects one higher step`);
  }
});

test('results are rejected before the solve timer ends', () => {
  const state = C.freshState();
  C.startRound(state, C.PUZZLES[0], 180000);

  assert.equal(C.recordResult(state, 'thu', 5), false);
  assert.equal(state.results.thu, null);
});

test('higher achieved step wins after solving ends', () => {
  const state = C.freshState();
  C.startRound(state, C.PUZZLES[0], 180000);
  C.finishSolving(state);

  assert.equal(C.recordResult(state, 'thu', 5), true);
  assert.equal(C.recordResult(state, 'pku', 4), true);

  assert.equal(state.phase, 'judged');
  assert.equal(state.winner, 'thu');
  assert.equal(state.message, '清华 Step 5 胜出。');
});

test('equal achieved steps are a draw', () => {
  const state = C.freshState();
  C.startRound(state, C.PUZZLES[1], 120000);
  C.finishSolving(state);

  C.recordResult(state, 'thu', 6);
  C.recordResult(state, 'pku', 6);

  assert.equal(state.phase, 'judged');
  assert.equal(state.winner, 'draw');
  assert.equal(state.message, '双方同为 Step 6，本题平局。');
});

test('scoreboard accumulates judged round wins only', () => {
  const state = C.freshState();

  C.startRound(state, C.PUZZLES[0], 180000);
  C.finishSolving(state);
  C.recordResult(state, 'thu', 6);
  C.recordResult(state, 'pku', 5);
  assert.equal(state.scores.thu, 1);
  assert.equal(state.scores.pku, 0);

  C.startRound(state, C.PUZZLES[1], 180000);
  C.finishSolving(state);
  C.recordResult(state, 'thu', 4);
  C.recordResult(state, 'pku', 4);
  assert.equal(state.scores.thu, 1);
  assert.equal(state.scores.pku, 0);
});
