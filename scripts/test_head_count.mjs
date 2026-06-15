import { test } from 'node:test';
import assert from 'node:assert/strict';
await import('../public/head-count/core.js');
const HC = globalThis.HeadCount;

// Deterministic seed list so failures are reproducible.
function seedFromIdx(i) { return HC.makeSeedString((i * 2654435761) >>> 0); }

// Visual head count, walking events in the order the ANIMATION plays them
// (sorted by startAt, ties broken by logical index). Returns the minimum the
// count ever reaches — must never drop below 0, or the audience sees a person
// leave a house the animation hasn't shown them entering.
function minVisible(r) {
  const order = r.events
    .map((ev, i) => ({ ev, i }))
    .sort((a, b) => a.ev.startAt - b.ev.startAt || a.i - b.i);
  let vis = r.initialCount, min = vis;
  for (const { ev } of order) { vis += ev.type === 'in' ? ev.n : -ev.n; min = Math.min(min, vis); }
  return min;
}

function isMonotonic(r) {
  for (let i = 1; i < r.events.length; i++) {
    if (r.events[i].startAt < r.events[i - 1].startAt) return false;
  }
  return true;
}

const SEEDS = Array.from({ length: 3000 }, (_, i) => seedFromIdx(i));

test('startAt is monotonic with logical order (animation order == event order)', () => {
  for (const pk of HC.PRESET_ORDER) {
    for (const seed of SEEDS) {
      const r = HC.generateRound({ seed, presetKey: pk });
      assert.ok(isMonotonic(r), `non-monotonic startAt: preset=${pk} seed=${seed}\n  ${r.events.map((e, i) => `${i}:${e.type}/${e.via}@${e.startAt}`).join('  ')}`);
    }
  }
});

test('visual head count never goes negative', () => {
  for (const pk of HC.PRESET_ORDER) {
    for (const seed of SEEDS) {
      const r = HC.generateRound({ seed, presetKey: pk });
      assert.ok(minVisible(r) >= 0, `visual count went negative (${minVisible(r)}): preset=${pk} seed=${seed}`);
    }
  }
});

test('regression: seed ZPB2-7YD / hard — last two events not reversed, no negative', () => {
  const r = HC.generateRound({ seed: 'ZPB2-7YD', presetKey: 'hard' });
  assert.ok(isMonotonic(r), 'events must animate in logical order');
  assert.ok(minVisible(r) >= 0, 'visual count must stay >= 0');
});

test('same-lane events never overlap (previous person clears before next appears)', () => {
  for (const pk of HC.PRESET_ORDER) {
    for (const seed of SEEDS) {
      const r = HC.generateRound({ seed, presetKey: pk });
      const lastEndByLane = {};
      for (const ev of r.events) {
        const lane = ev.via === 'chimney' ? 'chimney' : 'door';
        if (lane in lastEndByLane) {
          assert.ok(ev.startAt >= lastEndByLane[lane], `same-lane overlap: preset=${pk} seed=${seed} lane=${lane}`);
        }
        lastEndByLane[lane] = ev.startAt + ev.dur;
      }
    }
  }
});

test('an "out" never starts before every preceding "in" has finished entering', () => {
  for (const pk of HC.PRESET_ORDER) {
    for (const seed of SEEDS) {
      const r = HC.generateRound({ seed, presetKey: pk });
      let lastInEnd = 0;
      for (const ev of r.events) {
        if (ev.type === 'out') {
          assert.ok(ev.startAt >= lastInEnd, `out emerges before a preceding in finished: preset=${pk} seed=${seed}`);
        }
        if (ev.type === 'in') lastInEnd = Math.max(lastInEnd, ev.startAt + ev.dur);
      }
    }
  }
});

test('logical invariants hold: answer matches running count and stays in [0, maxInside]', () => {
  for (const pk of HC.PRESET_ORDER) {
    for (const seed of SEEDS) {
      const r = HC.generateRound({ seed, presetKey: pk });
      let inside = r.initialCount;
      for (const ev of r.events) {
        inside += ev.type === 'in' ? ev.n : -ev.n;
        assert.ok(inside >= 0 && inside <= r.maxInside, `logical count out of bounds: preset=${pk} seed=${seed}`);
      }
      assert.equal(inside, r.answer, `answer mismatch: preset=${pk} seed=${seed}`);
    }
  }
});
