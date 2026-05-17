import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Flag,
  Home,
  Minus,
  Plus,
  RotateCcw,
  Timer,
  Trophy,
} from 'lucide-react';

const SESSION_SECONDS = 300;
const TRACK_REVEAL_MS = 2100;
const TRACK_COVER_MS = 3300;
const TRACK_SLIDE_MS = 1040;
const TRACK_BETWEEN_MOVES_MS = 920;
const TRACK_AFTER_MOVES_MS = 650;
const COLS = 4;
const ROWS = 3;
const MIN_TRACK_MOUSE_COUNT = 2;
const MAX_TRACK_MOUSE_COUNT = 8;
const MAX_MOUSE_COUNT_DRIFT = 2;
const CAT_IMAGE = new URL('./assets/cat-face.svg', import.meta.url).href;
const MOUSE_IMAGE = new URL('./assets/mouse.svg', import.meta.url).href;

type TrackCell = 'mouse' | 'cat';
type PushSide = 'left' | 'right' | 'top' | 'bottom';
type GamePhase = 'title' | 'reveal' | 'cover' | 'move' | 'answer' | 'success' | 'failure' | 'sessionOver';
type FailureReason = 'mistake' | 'giveup' | 'timeout';

type TrackMove = {
  side: PushSide;
  line: number;
  enter: TrackCell;
  exit: TrackCell;
};

type TrackPuzzle = {
  cells: TrackCell[];
  moves: TrackMove[];
  initialMouseCount: number;
  finalMouseCount: number;
};

type Stats = {
  correct: number;
  failed: number;
  rounds: number;
  bestLevel: number;
};

const TRAINING_ITEMS = [
  {
    title: '连续计算',
    summary: '连续心算并保持上一轮结果，训练工作记忆的更新速度。',
    status: '待细化',
  },
  {
    title: '翻牌记忆',
    summary: '记住翻开的图案和顺序，复刻前需要继续确认完整规则。',
    status: '待细化',
  },
  {
    title: '暗格追踪',
    summary: '猫鼠从边缘进出，整行整列推动，最后点出全部剩余鼠。',
    status: '可玩样例',
    ready: true,
  },
  {
    title: '朗读保持',
    summary: '朗读材料与记忆判断结合，节奏和判题规则待整理。',
    status: '待细化',
  },
  {
    title: '符号判断',
    summary: '观察符号变化并作出快速判断，素材与关卡曲线待补。',
    status: '待细化',
  },
  {
    title: '方块追踪',
    summary: '追踪方块位置变化，移动规则和动画节奏待复刻。',
    status: '待细化',
  },
  {
    title: '杯位追踪',
    summary: '杯子交换后的目标追踪，需继续还原交换路径。',
    status: '待细化',
  },
  {
    title: '听算保持',
    summary: '听觉输入下的连续计算训练，音频与答题流程待实现。',
    status: '待细化',
  },
];

function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffle<T>(items: T[]) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = randomInt(0, i);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function formatTime(totalSeconds: number) {
  const min = Math.floor(totalSeconds / 60);
  const sec = totalSeconds % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

function accuracy(stats: Stats) {
  if (!stats.rounds) return 0;
  return Math.round((stats.correct / stats.rounds) * 100);
}

function exitingIndex(side: PushSide, line: number) {
  if (side === 'left') return line * COLS + COLS - 1;
  if (side === 'right') return line * COLS;
  if (side === 'top') return (ROWS - 1) * COLS + line;
  return line;
}

function applyTrackMove(cells: TrackCell[], move: TrackMove): TrackCell[] {
  const next = [...cells];

  if (move.side === 'left') {
    for (let col = COLS - 1; col > 0; col -= 1) next[move.line * COLS + col] = cells[move.line * COLS + col - 1];
    next[move.line * COLS] = move.enter;
  }

  if (move.side === 'right') {
    for (let col = 0; col < COLS - 1; col += 1) next[move.line * COLS + col] = cells[move.line * COLS + col + 1];
    next[move.line * COLS + COLS - 1] = move.enter;
  }

  if (move.side === 'top') {
    for (let row = ROWS - 1; row > 0; row -= 1) next[row * COLS + move.line] = cells[(row - 1) * COLS + move.line];
    next[move.line] = move.enter;
  }

  if (move.side === 'bottom') {
    for (let row = 0; row < ROWS - 1; row += 1) next[row * COLS + move.line] = cells[(row + 1) * COLS + move.line];
    next[(ROWS - 1) * COLS + move.line] = move.enter;
  }

  return next;
}

function countMice(cells: TrackCell[]) {
  return cells.reduce((total, animal) => total + (animal === 'mouse' ? 1 : 0), 0);
}

function mouseBounds(initialMouseCount: number) {
  return {
    min: Math.max(MIN_TRACK_MOUSE_COUNT, initialMouseCount - MAX_MOUSE_COUNT_DRIFT),
    max: Math.min(MAX_TRACK_MOUSE_COUNT, initialMouseCount + MAX_MOUSE_COUNT_DRIFT),
  };
}

function nextMouseCount(currentMouseCount: number, enter: TrackCell, exit: TrackCell) {
  return currentMouseCount + (enter === 'mouse' ? 1 : 0) - (exit === 'mouse' ? 1 : 0);
}

function lineCountForSide(side: PushSide) {
  return side === 'left' || side === 'right' ? ROWS : COLS;
}

function buildMoveCandidates(
  cells: TrackCell[],
  currentMouseCount: number,
  bounds: { min: number; max: number },
) {
  const candidates: Array<TrackMove & { nextCount: number }> = [];

  (['left', 'right', 'top', 'bottom'] as PushSide[]).forEach((side) => {
    for (let line = 0; line < lineCountForSide(side); line += 1) {
      const exit = cells[exitingIndex(side, line)];

      (['mouse', 'cat'] as TrackCell[]).forEach((enter) => {
        const nextCount = nextMouseCount(currentMouseCount, enter, exit);
        if (nextCount >= bounds.min && nextCount <= bounds.max) {
          candidates.push({ side, line, enter, exit, nextCount });
        }
      });
    }
  });

  return candidates;
}

function canReachMouseCount(
  cells: TrackCell[],
  currentMouseCount: number,
  targetMouseCount: number,
  stepsLeft: number,
  bounds: { min: number; max: number },
  memo: Map<string, boolean>,
): boolean {
  if (stepsLeft === 0) return currentMouseCount === targetMouseCount;

  const key = `${stepsLeft}|${currentMouseCount}|${targetMouseCount}|${cells.map((cell) => cell[0]).join('')}`;
  const cached = memo.get(key);
  if (cached !== undefined) return cached;

  const reachable = buildMoveCandidates(cells, currentMouseCount, bounds).some((candidate) =>
    canReachMouseCount(
      applyTrackMove(cells, candidate),
      candidate.nextCount,
      targetMouseCount,
      stepsLeft - 1,
      bounds,
      memo,
    ),
  );

  memo.set(key, reachable);
  return reachable;
}

function makeTrackPuzzle(level: number): TrackPuzzle {
  const initialMouseCount = Math.min(MAX_TRACK_MOUSE_COUNT, level + 1);
  const moveCount = 14 + level * 2;
  const bounds = mouseBounds(initialMouseCount);
  const minSpeciesChangingMoves = Math.max(3, Math.floor(moveCount * 0.32));
  let fallback: TrackPuzzle | null = null;

  for (let attempt = 0; attempt < 120; attempt += 1) {
    const base = shuffle([
      ...Array.from({ length: initialMouseCount }, () => 'mouse' as const),
      ...Array.from({ length: COLS * ROWS - initialMouseCount }, () => 'cat' as const),
    ]);
    const moves: TrackMove[] = [];
    let current = [...base];
    let currentMouseCount = initialMouseCount;
    let speciesChangingMoves = 0;
    let builtBalancedPath = true;
    const reachMemo = new Map<string, boolean>();

    for (let i = 0; i < moveCount; i += 1) {
      const candidates = buildMoveCandidates(current, currentMouseCount, bounds);
      const remainingAfterThisMove = moveCount - i - 1;
      const reachableCandidates = candidates.filter((candidate) =>
        canReachMouseCount(
          applyTrackMove(current, candidate),
          candidate.nextCount,
          initialMouseCount,
          remainingAfterThisMove,
          bounds,
          reachMemo,
        ),
      );

      if (!reachableCandidates.length) {
        builtBalancedPath = false;
        break;
      }

      const changingCandidates = reachableCandidates.filter((candidate) => candidate.enter !== candidate.exit);
      const movesRemaining = moveCount - i;
      const changesNeeded = minSpeciesChangingMoves - speciesChangingMoves;
      const mustChangeNow = changesNeeded >= movesRemaining;
      const prefersChange = changesNeeded > 0 && (mustChangeNow || Math.random() < 0.62);
      const pool = prefersChange && changingCandidates.length ? changingCandidates : reachableCandidates;
      const candidate = shuffle(pool)[0];
      const move = {
        side: candidate.side,
        line: candidate.line,
        enter: candidate.enter,
        exit: candidate.exit,
      };

      moves.push(move);
      if (move.enter !== move.exit) speciesChangingMoves += 1;
      currentMouseCount = candidate.nextCount;
      current = applyTrackMove(current, move);
    }

    if (!builtBalancedPath || moves.length !== moveCount) {
      continue;
    }

    const candidatePuzzle = {
      cells: base,
      moves,
      initialMouseCount,
      finalMouseCount: countMice(current),
    };

    if (candidatePuzzle.finalMouseCount === initialMouseCount) {
      fallback = fallback || candidatePuzzle;
    }

    if (speciesChangingMoves >= minSpeciesChangingMoves && candidatePuzzle.finalMouseCount === initialMouseCount) {
      return candidatePuzzle;
    }
  }

  return fallback as TrackPuzzle;
}

function lineIsMoving(move: TrackMove | undefined, index: number) {
  if (!move) return false;
  if (move.side === 'left' || move.side === 'right') return Math.floor(index / COLS) === move.line;
  return index % COLS === move.line;
}

function motionPanelPositions(move: TrackMove) {
  if (move.side === 'left') {
    return Array.from({ length: COLS + 1 }, (_, i) => ({ row: move.line, col: i - 1 }));
  }
  if (move.side === 'right') {
    return Array.from({ length: COLS + 1 }, (_, i) => ({ row: move.line, col: i }));
  }
  if (move.side === 'top') {
    return Array.from({ length: ROWS + 1 }, (_, i) => ({ row: i - 1, col: move.line }));
  }
  return Array.from({ length: ROWS + 1 }, (_, i) => ({ row: i, col: move.line }));
}

function motionStyle(position: { row: number; col: number }): React.CSSProperties {
  return { '--motion-row': position.row, '--motion-col': position.col } as React.CSSProperties;
}

function motionActorPosition(move: TrackMove, kind: 'enter' | 'exit') {
  if (kind === 'enter') {
    if (move.side === 'left') return { row: move.line, col: -1 };
    if (move.side === 'right') return { row: move.line, col: COLS };
    if (move.side === 'top') return { row: -1, col: move.line };
    return { row: ROWS, col: move.line };
  }

  if (move.side === 'left') return { row: move.line, col: COLS - 1 };
  if (move.side === 'right') return { row: move.line, col: 0 };
  if (move.side === 'top') return { row: ROWS - 1, col: move.line };
  return { row: 0, col: move.line };
}

function sameMotionPosition(a: { row: number; col: number }, b: { row: number; col: number }) {
  return a.row === b.row && a.col === b.col;
}

function phaseCopy(phase: GamePhase, round: number, found: number, startTarget: number, answerTarget: number) {
  if (phase === 'reveal') return `第${round}问：记住起始 ${startTarget} 只鼠`;
  if (phase === 'cover') return `第${round}问`;
  if (phase === 'move') return '追踪进出';
  if (phase === 'answer') return `点出所有鼠 ${found}/${answerTarget}`;
  if (phase === 'success') return '成功';
  if (phase === 'failure') return '失败';
  return '准备';
}

function failureCopy(reason: FailureReason | null) {
  if (reason === 'giveup') return '本题已放弃';
  if (reason === 'timeout') return '训练时间结束';
  return '点到了猫';
}

function AnimalSprite({ animal }: { animal: TrackCell }) {
  return (
    <span className={`animal-sprite ${animal}`} aria-hidden="true">
      <img src={animal === 'mouse' ? MOUSE_IMAGE : CAT_IMAGE} alt="" draggable={false} />
    </span>
  );
}

function TrackCellButton({
  animal,
  covered,
  selected,
  moving,
  slidingClass,
  disabled,
  onClick,
}: {
  animal: TrackCell;
  covered: boolean;
  selected: boolean;
  moving: boolean;
  slidingClass: string;
  disabled: boolean;
  onClick: () => void;
}) {
  const label = covered ? '遮盖的格子' : animal === 'mouse' ? '鼠' : '猫';

  return (
    <button
      className={`track-cell ${covered ? 'covered' : animal} ${selected ? 'selected' : ''} ${
        moving ? 'moving-line' : ''
      } ${slidingClass}`}
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
    >
      {covered ? <span className="question-mark">?</span> : <AnimalSprite animal={animal} />}
      {selected && animal === 'mouse' ? <span className="hit-ring" aria-hidden="true" /> : null}
    </button>
  );
}

function Coach({ phase, failureReason }: { phase: GamePhase; failureReason: FailureReason | null }) {
  const message =
    phase === 'answer'
      ? '把鼠全部点出来'
      : phase === 'success'
        ? '答对了'
        : phase === 'failure'
          ? failureCopy(failureReason)
          : '集中';

  return (
    <div className={`coach ${phase === 'answer' || phase === 'success' || phase === 'failure' ? 'visible' : ''}`}>
      <div className="coach-face" aria-hidden="true">
        <span className="coach-hair" />
        <span className="coach-brow left" />
        <span className="coach-brow right" />
        <span className="coach-glasses left" />
        <span className="coach-glasses right" />
        <span className="coach-nose" />
        <span className="coach-mouth" />
      </div>
      <div className="coach-bubble">{message}</div>
    </div>
  );
}

function MotionLayer({ move }: { move: TrackMove }) {
  const enterPosition = motionActorPosition(move, 'enter');
  const exitPosition = motionActorPosition(move, 'exit');
  const panelPositions = motionPanelPositions(move).filter(
    (position) => !sameMotionPosition(position, enterPosition) && !sameMotionPosition(position, exitPosition),
  );

  return (
    <div className={`motion-layer side-${move.side}`} aria-hidden="true">
      {panelPositions.map((position, index) => (
        <span
          key={`${position.row}-${position.col}-${index}`}
          className="motion-panel"
          style={motionStyle(position)}
        >
          <span className="question-mark">?</span>
        </span>
      ))}

      <span className="motion-actor enter" style={motionStyle(enterPosition)}>
        <span className="actor-badge">入</span>
        <AnimalSprite animal={move.enter} />
      </span>

      <span className="motion-actor exit" style={motionStyle(exitPosition)}>
        <span className="actor-badge">出</span>
        <AnimalSprite animal={move.exit} />
      </span>
    </div>
  );
}

function GameBoard({
  puzzle,
  displayCells,
  phase,
  currentMove,
  sliding,
  revealed,
  clickedIndex,
  onCellClick,
}: {
  puzzle: TrackPuzzle | null;
  displayCells: TrackCell[];
  phase: GamePhase;
  currentMove: TrackMove | undefined;
  sliding: boolean;
  revealed: number[];
  clickedIndex: number | null;
  onCellClick: (index: number) => void;
}) {
  const cells = displayCells.length ? displayCells : puzzle?.cells || [];
  const showAnimals = phase === 'reveal' || phase === 'success' || phase === 'failure';
  const canAnswer = phase === 'answer';

  return (
    <div
      className={`track-playfield ${sliding ? 'is-sliding' : ''} ${
        phase === 'answer' || phase === 'success' || phase === 'failure' ? 'answer-layout' : ''
      }`}
      style={{ '--track-slide-ms': `${TRACK_SLIDE_MS}ms` } as React.CSSProperties}
    >
      <div className="board-halo" aria-hidden="true" />
      <div className="track-board">
        {phase === 'move' && currentMove && sliding ? (
          <MotionLayer move={currentMove} />
        ) : null}

        {Array.from({ length: COLS * ROWS }, (_, index) => {
          const animal = cells[index] || 'cat';
          const isRevealed = showAnimals || revealed.includes(index);
          const moving = phase === 'move' && lineIsMoving(currentMove, index);
          return (
            <TrackCellButton
              key={index}
              animal={animal}
              covered={!isRevealed}
              selected={revealed.includes(index) || clickedIndex === index}
              moving={moving}
              slidingClass={sliding && moving ? 'ghost-moving' : ''}
              disabled={!canAnswer || isRevealed}
              onClick={() => onCellClick(index)}
            />
          );
        })}
      </div>
    </div>
  );
}

function TitleScreen({
  startLevel,
  setStartLevel,
  onStart,
}: {
  startLevel: number;
  setStartLevel: (value: number) => void;
  onStart: () => void;
}) {
  const preview = useMemo(() => makeTrackPuzzle(startLevel).cells, [startLevel]);
  const readyCount = TRAINING_ITEMS.filter((item) => item.ready).length;

  return (
    <main className="title-screen">
      <section className="title-card">
        <div className="title-copy">
          <p className="kicker">8种训练复刻计划</p>
          <h1>脑力八练</h1>
          <p className="subtitle">当前先完成猫鼠追踪样例。其他训练入口先列出来，规则、素材和节奏会继续补齐。</p>
          <div className="level-stepper" aria-label="初始鼠数量">
            <button type="button" onClick={() => setStartLevel(Math.max(1, startLevel - 1))} aria-label="减少鼠数量">
              <Minus size={18} />
            </button>
            <strong>{startLevel + 1}只</strong>
            <button type="button" onClick={() => setStartLevel(Math.min(7, startLevel + 1))} aria-label="增加鼠数量">
              <Plus size={18} />
            </button>
          </div>
          <button className="start-button" type="button" onClick={onStart}>
            <PlayIcon />
            进入猫鼠样例
          </button>
        </div>

        <div className="preview-panel" aria-hidden="true">
          <div className="preview-grid">
            {preview.map((animal, index) => (
              <span key={index} className={`preview-cell ${animal}`}>
                <AnimalSprite animal={animal} />
              </span>
            ))}
          </div>
        </div>

        <div className="training-catalog" aria-label="训练列表">
          <div className="catalog-head">
            <div>
              <p className="kicker">训练列表</p>
              <h2>当前进度</h2>
            </div>
            <strong>{readyCount}/8 可玩</strong>
          </div>

          <div className="training-grid">
            {TRAINING_ITEMS.map((item, index) => (
              <article key={item.title} className={`training-item ${item.ready ? 'is-ready' : ''}`}>
                <div className="training-index">{String(index + 1).padStart(2, '0')}</div>
                <div>
                  <h3>{item.title}</h3>
                  <p>{item.summary}</p>
                </div>
                {item.ready ? (
                  <button className="training-status ready" type="button" onClick={onStart}>
                    开始
                  </button>
                ) : (
                  <span className="training-status">{item.status}</span>
                )}
              </article>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

function PlayIcon() {
  return <span className="play-triangle" aria-hidden="true" />;
}

export default function App() {
  const [phase, setPhase] = useState<GamePhase>('title');
  const [sessionLeft, setSessionLeft] = useState(SESSION_SECONDS);
  const [sessionActive, setSessionActive] = useState(false);
  const [level, setLevel] = useState(1);
  const [startLevel, setStartLevel] = useState(1);
  const [round, setRound] = useState(1);
  const [puzzle, setPuzzle] = useState<TrackPuzzle | null>(null);
  const [displayCells, setDisplayCells] = useState<TrackCell[]>([]);
  const [moveIndex, setMoveIndex] = useState(0);
  const [sliding, setSliding] = useState(false);
  const [revealed, setRevealed] = useState<number[]>([]);
  const [clickedIndex, setClickedIndex] = useState<number | null>(null);
  const [failureReason, setFailureReason] = useState<FailureReason | null>(null);
  const [stats, setStats] = useState<Stats>({ correct: 0, failed: 0, rounds: 0, bestLevel: 1 });
  const [pairBuffer, setPairBuffer] = useState<boolean[]>([]);

  const currentMove = puzzle?.moves[moveIndex];
  const startTargetCount = puzzle?.initialMouseCount || Math.min(MAX_TRACK_MOUSE_COUNT, level + 1);
  const answerTargetCount = puzzle?.finalMouseCount || startTargetCount;
  const resultVisible = phase === 'success' || phase === 'failure' || phase === 'sessionOver';
  const headerMouseCount = phase === 'answer' || resultVisible ? answerTargetCount : startTargetCount;
  const foundMice = revealed.filter((index) => displayCells[index] === 'mouse').length;

  const finishRound = (ok: boolean, reason: FailureReason | null = null, clicked: number | null = null) => {
    setSliding(false);
    setClickedIndex(clicked);
    setFailureReason(reason);
    setRevealed((current) => {
      if (ok) return current;
      return Array.from(new Set([...current, ...(clicked === null ? [] : [clicked])]));
    });
    setStats((current) => ({
      correct: current.correct + (ok ? 1 : 0),
      failed: current.failed + (ok ? 0 : 1),
      rounds: current.rounds + 1,
      bestLevel: Math.max(current.bestLevel, level),
    }));

    const nextBuffer = [...pairBuffer, ok].slice(-2);
    if (nextBuffer.length === 2 && nextBuffer.every(Boolean)) {
      setLevel((current) => Math.min(8, current + 1));
      setPairBuffer([]);
    } else if (nextBuffer.length === 2 && nextBuffer.every((item) => !item)) {
      setLevel((current) => Math.max(1, current - 1));
      setPairBuffer([]);
    } else {
      setPairBuffer(nextBuffer);
    }

    setPhase(ok ? 'success' : 'failure');
  };

  const startRound = (nextRound = round, targetLevel = level) => {
    const nextPuzzle = makeTrackPuzzle(targetLevel);
    setPuzzle(nextPuzzle);
    setDisplayCells(nextPuzzle.cells);
    setMoveIndex(0);
    setSliding(false);
    setRevealed([]);
    setClickedIndex(null);
    setFailureReason(null);
    setRound(nextRound);
    setPhase('reveal');
  };

  const startSession = () => {
    setSessionLeft(SESSION_SECONDS);
    setSessionActive(true);
    setLevel(startLevel);
    setStats({ correct: 0, failed: 0, rounds: 0, bestLevel: startLevel });
    setPairBuffer([]);
    setRound(1);
    startRound(1, startLevel);
  };

  const nextRound = () => {
    startRound(round + 1, level);
  };

  const resetToTitle = () => {
    setSessionActive(false);
    setSessionLeft(SESSION_SECONDS);
    setPhase('title');
    setPuzzle(null);
    setDisplayCells([]);
    setRevealed([]);
    setClickedIndex(null);
    setFailureReason(null);
  };

  useEffect(() => {
    if (!sessionActive) return undefined;

    const id = window.setInterval(() => {
      setSessionLeft((current) => {
        if (current <= 1) {
          setSessionActive(false);
          setPhase('sessionOver');
          setFailureReason('timeout');
          return 0;
        }
        return current - 1;
      });
    }, 1000);

    return () => window.clearInterval(id);
  }, [sessionActive]);

  useEffect(() => {
    if (phase !== 'reveal') return undefined;
    const id = window.setTimeout(() => setPhase('cover'), TRACK_REVEAL_MS);
    return () => window.clearTimeout(id);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'cover') return undefined;
    const id = window.setTimeout(() => setPhase('move'), TRACK_COVER_MS);
    return () => window.clearTimeout(id);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'move' || !puzzle) return undefined;

    if (moveIndex >= puzzle.moves.length) {
      const doneId = window.setTimeout(() => setPhase('answer'), TRACK_AFTER_MOVES_MS);
      return () => window.clearTimeout(doneId);
    }

    const move = puzzle.moves[moveIndex];
    const pause = moveIndex === 0 ? 0 : TRACK_BETWEEN_MOVES_MS;
    const beginId = window.setTimeout(() => setSliding(true), pause);
    const finishId = window.setTimeout(() => {
      setDisplayCells((cells) => applyTrackMove(cells, move));
      setMoveIndex((current) => current + 1);
      setSliding(false);
    }, pause + TRACK_SLIDE_MS);

    return () => {
      window.clearTimeout(beginId);
      window.clearTimeout(finishId);
    };
  }, [moveIndex, phase, puzzle]);

  const handleCellClick = (index: number) => {
    if (phase !== 'answer' || revealed.includes(index)) return;

    const animal = displayCells[index];
    const nextRevealed = [...revealed, index];
    setRevealed(nextRevealed);
    setClickedIndex(index);

    if (animal !== 'mouse') {
      finishRound(false, 'mistake', index);
      return;
    }

    const nextFound = nextRevealed.filter((cellIndex) => displayCells[cellIndex] === 'mouse').length;
    if (nextFound === answerTargetCount) finishRound(true);
  };

  if (phase === 'title') {
    return <TitleScreen startLevel={startLevel} setStartLevel={setStartLevel} onStart={startSession} />;
  }

  const canGiveUp = phase === 'cover' || phase === 'move' || phase === 'answer';

  return (
    <main className={`catmouse-shell phase-${phase}`}>
      <header className="game-topbar">
        <div className="mouse-count">{headerMouseCount}只</div>
        <div className="training-pill">集中训练时间</div>
        <div className="time-box">
          <Timer size={16} />
          {formatTime(sessionLeft)}
        </div>
      </header>

      <section className="game-stage" aria-live="polite">
        <div className="round-line">
          <span>{phaseCopy(phase, round, foundMice, startTargetCount, answerTargetCount)}</span>
          <span>Level {level}</span>
        </div>

        <Coach phase={phase} failureReason={failureReason} />

        <GameBoard
          puzzle={puzzle}
          displayCells={displayCells}
          phase={phase === 'sessionOver' ? 'failure' : phase}
          currentMove={currentMove}
          sliding={sliding}
          revealed={revealed}
          clickedIndex={clickedIndex}
          onCellClick={handleCellClick}
        />

        {canGiveUp ? (
          <button className="give-up" type="button" onClick={() => finishRound(false, 'giveup')}>
            <Flag size={15} />
            放弃
          </button>
        ) : null}

        {resultVisible ? (
          <section className={`result-panel ${phase === 'success' ? 'good' : 'bad'}`}>
            <div>
              <p>{phase === 'success' ? '本题正确' : failureCopy(failureReason)}</p>
              <strong>
                {stats.correct}/{stats.rounds} · {accuracy(stats)}%
              </strong>
            </div>
            <div className="result-actions">
              {phase !== 'sessionOver' ? (
                <button className="primary-action" type="button" onClick={nextRound} disabled={!sessionActive}>
                  下一题
                  <ArrowRight size={17} />
                </button>
              ) : null}
              <button className="soft-action" type="button" onClick={startSession}>
                <RotateCcw size={17} />
                重新开始
              </button>
              <button className="soft-action" type="button" onClick={resetToTitle}>
                <Home size={17} />
                标题
              </button>
            </div>
          </section>
        ) : null}
      </section>

      <aside className="score-strip" aria-label="成绩">
        <span>
          <Trophy size={15} />
          {stats.correct} 正确
        </span>
        <span>{stats.failed} 失败</span>
        <span>最高 {stats.bestLevel + 1}只</span>
      </aside>

      <footer className="asset-credit">Mouse icon: SVG Repo CC0. Cat icon: Wikimedia Commons CC0.</footer>
    </main>
  );
}
