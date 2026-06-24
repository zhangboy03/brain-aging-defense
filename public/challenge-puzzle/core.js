(function () {
  const TEAMS = {
    thu: '清华',
    pku: '北大',
  };

  const PUZZLES = [
    {
      id: 'river-steps',
      title: '第一题',
      board: ['..####', '.#####', '######', '####..'],
      pieces: [
        ['##', '##'],
        ['###', '#.#', '###'],
        ['.#', '##', '#.'],
        ['#', '#', '##'],
        ['##.', '.##'],
        ['###', '..#'],
      ],
    },
    {
      id: 'north-gate',
      title: '第二题',
      board: ['.####.', '######', '######', '.####.', '..##..'],
      pieces: [
        ['###', '.#.'],
        ['##', '##'],
        ['#.', '##', '.#'],
        ['###', '#..'],
        ['.#.', '###'],
        ['##.', '.##'],
      ],
    },
    {
      id: 'double-court',
      title: '第三题',
      board: ['###.###', '#######', '.#####.', '.#####.', '###.###'],
      pieces: [
        ['##', '##'],
        ['###', '..#', '..#'],
        ['#..', '###'],
        ['.#', '##', '.#'],
        ['###', '#.#'],
        ['.##', '##.'],
      ],
    },
  ];

  function clonePuzzle(puzzle) {
    return JSON.parse(JSON.stringify(puzzle));
  }

  function freshState() {
    return {
      phase: 'idle',
      round: 0,
      durationMs: 180000,
      startedAt: 0,
      endsAt: 0,
      puzzle: null,
      results: { thu: null, pku: null },
      scores: { thu: 0, pku: 0 },
      winner: '',
      message: '打开主持人控制台，开始比赛。',
    };
  }

  function startRound(state, puzzle, durationMs, now) {
    state.phase = 'solving';
    state.round += 1;
    state.durationMs = Math.max(1000, Number(durationMs) || 180000);
    state.startedAt = Number(now) || Date.now();
    state.endsAt = state.startedAt + state.durationMs;
    state.puzzle = clonePuzzle(puzzle);
    state.results = { thu: null, pku: null };
    state.winner = '';
    state.message = '双方同时开始拼图，倒计时结束后录入最佳 Step。';
    return state;
  }

  function finishSolving(state) {
    if (state.phase !== 'solving') return false;
    state.phase = 'scoring';
    state.message = '答题结束，请录入双方实际完成的最高 Step。';
    return true;
  }

  function normalizeStep(step) {
    const value = Math.floor(Number(step));
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(99, value));
  }

  function judgeIfReady(state) {
    const thu = state.results.thu;
    const pku = state.results.pku;
    if (thu === null || pku === null) return;

    state.phase = 'judged';
    if (thu > pku) {
      state.winner = 'thu';
      state.scores.thu += 1;
      state.message = `${TEAMS.thu} Step ${thu} 胜出。`;
    } else if (pku > thu) {
      state.winner = 'pku';
      state.scores.pku += 1;
      state.message = `${TEAMS.pku} Step ${pku} 胜出。`;
    } else {
      state.winner = 'draw';
      state.message = `双方同为 Step ${thu}，本题平局。`;
    }
  }

  function recordResult(state, team, step) {
    if (state.phase !== 'scoring' || !Object.prototype.hasOwnProperty.call(TEAMS, team)) {
      return false;
    }
    state.results[team] = normalizeStep(step);
    judgeIfReady(state);
    return true;
  }

  window.ChallengePuzzle = {
    TEAMS,
    PUZZLES,
    freshState,
    startRound,
    finishSolving,
    recordResult,
  };
})();
