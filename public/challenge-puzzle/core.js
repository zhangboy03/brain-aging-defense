(function () {
  const TEAMS = {
    thu: '清华',
    pku: '北大',
  };

  const PUZZLES = [
    {
      id: 'show-r1-twin-islands',
      title: '节目复刻 R1：双岛',
      note: '来源：EP4 Challenge Puzzle Round 1 规则帧。1-6 号块可填满 24 格；加入 7 号块后面积超出，最高 Step 6。',
      maxStep: 6,
      board: [
        '###   ###',
        '####  ####',
        ' ###   ###',
        '  ##    ##',
      ],
      pieces: [
        ['##', '##', '#.'],
        ['.##', '##.', '#..'],
        ['#', '#'],
        ['#', '#'],
        ['##', '##', '#.'],
        ['.##', '##.', '#..'],
        ['#', '#'],
      ],
    },
    {
      id: 'show-r2-area-wall',
      title: '节目复刻 R2：面积墙',
      note: '来源：EP4 Challenge Puzzle Round 2 规则帧与证明帧。底板共 38 格，1-6 号块合计 39 格，最高 Step 5。',
      maxStep: 5,
      board: [
        '#######',
        '#######',
        '#######',
        '#######',
        '#######',
        '###    ',
      ],
      pieces: [
        ['.#', '##', '.#'],
        ['##', '##'],
        ['.#', '.#', '##'],
        ['.#', '##', '#.'],
        ['#', '#', '#', '#', '#'],
        ['######', '######', '######'],
      ],
    },
    {
      id: 'show-r3-checkerboard',
      title: '节目复刻 R3：棋盘洞',
      note: '来源：EP4 Challenge Puzzle Round 3 规则帧与赛后访谈。Step 8 实际可行，节目中选手未能在限时内摆出。',
      maxStep: 8,
      board: [
        '#######',
        '#.#.#.#',
        '#######',
        '#.#.#.#',
        '#######',
        '#.#.#.#',
        '#######',
      ],
      pieces: [
        ['###', '#.#', '##.'],
        ['##.', '#.#', '###'],
        ['###', '#.#', '.##'],
        ['.##', '#.#', '###'],
        ['##', '#.'],
        ['##', '#.'],
        ['##', '#.'],
        ['##', '#.'],
      ],
    },
    {
      id: 'show-r6-red-cover',
      title: '节目复刻 R6：九个关键格',
      note: '来源：EP4 Challenge Puzzle Round 6 规则帧与红格证明帧。底板共 25 格，12 个相同二连块；Step 9 可行，Step 10 被关键格上限卡死。',
      maxStep: 9,
      board: [
        '   #   ',
        '  ###  ',
        ' ##### ',
        '#######',
        ' ##### ',
        '  ###  ',
        '   #   ',
      ],
      pieces: [
        ['##'],
        ['##'],
        ['##'],
        ['##'],
        ['##'],
        ['##'],
        ['##'],
        ['##'],
        ['##'],
        ['##'],
        ['##'],
        ['##'],
      ],
    },
    {
      id: 'area-gate',
      title: '自制题 A：差一格',
      note: '自制基础题：底板空间接近满载，下一块因面积超限无法成立。',
      maxStep: 5,
      board: [
        '########.',
        '####.####',
        '##.######',
        '###.#####',
        '#####.###',
      ],
      pieces: [
        ['##', '##'],
        ['#####'],
        ['#...', '#...', '####'],
        ['#.#', '###', '.##'],
        ['###', '###', '###', '###'],
        ['.##', '###', '##.'],
      ],
    },
    {
      id: 'checker-trap',
      title: '自制题 B：复杂底板',
      note: '自制进阶题：题面更密，前段可行，越级后被总面积卡住。',
      maxStep: 7,
      board: [
        '#####.###.##',
        '.#.#########',
        '##...#..####',
        '############',
        '#.########..',
        '.##.....##..',
      ],
      pieces: [
        ['###', '.#.', '.#.'],
        ['#..', '###', '..#'],
        ['###', '###'],
        ['####', '..##', '.#..'],
        ['####', '####'],
        ['##', '##', '##', '##'],
        ['##', '##', '##', '##'],
        ['###', '.##', '.#.'],
      ],
    },
    {
      id: 'red-cell-limit',
      title: '自制题 C：红格上限变体',
      note: '自制变体题：看似还能继续，实际被染色/匹配上限锁死。',
      maxStep: 9,
      board: ['.###.', '#####', '##.##', '#####', '.####'],
      pieces: [
        ['##'],
        ['##'],
        ['##'],
        ['##'],
        ['##'],
        ['##'],
        ['##'],
        ['##'],
        ['##'],
        ['##'],
        ['##'],
        ['##'],
      ],
    },
    {
      id: 'corner-lock',
      title: '自制题 D：角位锁死',
      note: '自制进阶题：面积允许到 Step 8，但第 8 块与前段的角位占用冲突，最高 Step 7。',
      maxStep: 7,
      board: [
        '##.###',
        '#.####',
        '##..#.',
        '.##.##',
        '###.##',
        '####.#',
        '##.###',
      ],
      pieces: [
        ['##', '##'],
        ['#..', '###'],
        ['###'],
        ['####', '#...'],
        ['#', '#', '#'],
        ['####', '...#'],
        ['##', '#.'],
        ['.##', '##.', '#..'],
        ['####'],
      ],
    },
    {
      id: 'corridor-switch',
      title: '自制题 E：走廊换向',
      note: '自制进阶题：面积允许到 Step 6，但第 6 块需要的走廊方向会被前 5 块封死，最高 Step 5。',
      maxStep: 5,
      board: [
        '###..#',
        '##..#.',
        '.#####',
        '##.##.',
        '###.##',
        '####.#',
      ],
      pieces: [
        ['.##', '##.', '#..'],
        ['####', '...#'],
        ['###'],
        ['####'],
        ['##', '.#'],
        ['###', '.#.'],
        ['##.', '.##'],
        ['.##', '##.'],
      ],
    },
  ];

  function shapeToCells(rows) {
    const cells = [];
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x += 1) {
        if (row[x] === '#') cells.push({ x, y });
      }
    });
    return cells;
  }

  function normalizeCells(cells) {
    const minX = Math.min(...cells.map(c => c.x));
    const minY = Math.min(...cells.map(c => c.y));
    return cells
      .map(c => ({ x: c.x - minX, y: c.y - minY }))
      .sort((a, b) => a.y - b.y || a.x - b.x);
  }

  function cellsKey(cells) {
    return normalizeCells(cells).map(c => `${c.x},${c.y}`).join(';');
  }

  function rotateCells(cells) {
    return normalizeCells(cells.map(c => ({ x: c.y, y: -c.x })));
  }

  function rowsFromCells(cells) {
    const norm = normalizeCells(cells);
    const width = Math.max(...norm.map(c => c.x)) + 1;
    const height = Math.max(...norm.map(c => c.y)) + 1;
    const rows = Array.from({ length: height }, () => Array(width).fill('.'));
    norm.forEach(c => { rows[c.y][c.x] = '#'; });
    return rows.map(row => row.join(''));
  }

  function orientations(rows) {
    const seen = new Set();
    const result = [];
    let cells = normalizeCells(shapeToCells(rows));
    for (let i = 0; i < 4; i += 1) {
      const key = cellsKey(cells);
      if (!seen.has(key)) {
        seen.add(key);
        result.push({ cells, rows: rowsFromCells(cells) });
      }
      cells = rotateCells(cells);
    }
    return result;
  }

  function boardInfo(boardRows) {
    const cells = shapeToCells(boardRows);
    const set = new Set(cells.map(c => `${c.x},${c.y}`));
    return {
      cells,
      set,
      width: Math.max(...boardRows.map(r => r.length)),
      height: boardRows.length,
    };
  }

  function pieceArea(piece) {
    return shapeToCells(piece).length;
  }

  function totalArea(pieces, step) {
    return pieces.slice(0, step).reduce((sum, piece) => sum + pieceArea(piece), 0);
  }

  function isDomino(piece) {
    const cells = normalizeCells(shapeToCells(piece));
    return cells.length === 2 && (
      (cells[0].x === 0 && cells[0].y === 0 && cells[1].x === 1 && cells[1].y === 0) ||
      (cells[0].x === 0 && cells[0].y === 0 && cells[1].x === 0 && cells[1].y === 1)
    );
  }

  function upperBoundStep(puzzle) {
    const board = boardInfo(puzzle.board);
    let areaBound = 0;
    for (let step = 0; step <= puzzle.pieces.length; step += 1) {
      if (totalArea(puzzle.pieces, step) <= board.cells.length) areaBound = step;
    }

    let parityBound = puzzle.pieces.length;
    if (puzzle.pieces.every(isDomino)) {
      const even = board.cells.filter(c => (c.x + c.y) % 2 === 0).length;
      const odd = board.cells.length - even;
      parityBound = Math.min(even, odd);
    }

    return Math.min(areaBound, parityBound);
  }

  function candidatesFor(board, piece, index) {
    const result = [];
    orientations(piece).forEach((shape, rotation) => {
      const width = Math.max(...shape.cells.map(c => c.x)) + 1;
      const height = Math.max(...shape.cells.map(c => c.y)) + 1;
      for (let y = 0; y <= board.height - height; y += 1) {
        for (let x = 0; x <= board.width - width; x += 1) {
          const cells = shape.cells.map(c => ({ x: c.x + x, y: c.y + y }));
          if (cells.every(c => board.set.has(`${c.x},${c.y}`))) {
            result.push({ index, x, y, rotation, rows: shape.rows, cells });
          }
        }
      }
    });
    return result;
  }

  function findSolution(puzzle, step) {
    const count = Math.max(0, Math.min(Math.floor(Number(step)) || 0, puzzle.pieces.length));
    if (count > upperBoundStep(puzzle)) return null;
    const board = boardInfo(puzzle.board);
    if (totalArea(puzzle.pieces, count) > board.cells.length) return null;
    const allCandidates = puzzle.pieces.slice(0, count).map((piece, index) => candidatesFor(board, piece, index));
    if (allCandidates.some(list => list.length === 0)) return null;

    const placements = Array(count).fill(null);
    const occupied = new Set();

    function fits(candidate) {
      return candidate.cells.every(c => !occupied.has(`${c.x},${c.y}`));
    }

    function search(remaining) {
      if (remaining.length === 0) return true;
      let bestIndex = -1;
      let bestOptions = null;
      remaining.forEach(index => {
        const options = allCandidates[index].filter(fits);
        if (bestOptions === null || options.length < bestOptions.length) {
          bestIndex = index;
          bestOptions = options;
        }
      });
      if (!bestOptions || bestOptions.length === 0) return false;

      const nextRemaining = remaining.filter(index => index !== bestIndex);
      for (const candidate of bestOptions) {
        candidate.cells.forEach(c => occupied.add(`${c.x},${c.y}`));
        placements[bestIndex] = candidate;
        if (search(nextRemaining)) return true;
        placements[bestIndex] = null;
        candidate.cells.forEach(c => occupied.delete(`${c.x},${c.y}`));
      }
      return false;
    }

    return search(Array.from({ length: count }, (_, i) => i)) ? placements : null;
  }

  function maxAchievableStep(puzzle) {
    for (let step = upperBoundStep(puzzle); step >= 0; step -= 1) {
      if (findSolution(puzzle, step)) return step;
    }
    return 0;
  }

  function answerGrid(puzzle, step) {
    const solution = findSolution(puzzle, step);
    if (!solution) return null;
    const rows = puzzle.board.map(row => row.split('').map(ch => (ch === '#' ? '·' : ' ')));
    solution.forEach((placement, index) => {
      const mark = String(index + 1);
      placement.cells.forEach(c => { rows[c.y][c.x] = mark; });
    });
    return rows.map(row => row.join(''));
  }

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
    state.message = '拼图块可以旋转但不能翻面';
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
    shapeToCells,
    orientations,
    findSolution,
    upperBoundStep,
    maxAchievableStep,
    answerGrid,
    freshState,
    startRound,
    finishSolving,
    recordResult,
  };
})();
