import { setImmediate } from "node:timers/promises";
import {
  SIZE,
  opponent,
  type Board,
  type Move,
  type Stone,
} from "../shared/game.js";

const MATE = 1_000_000;
const DIRECTIONS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];
type Threat = {
  win: boolean;
  winningPoints: number;
  openThrees: number;
  score: number;
};
type Candidate = {
  move: Move;
  attack: Threat;
  defense: Threat;
  priority: number;
  score: number;
};
export type SearchOptions = {
  maxDepth?: number;
  maxNodes?: number;
  timeMs?: number;
  signal?: AbortSignal;
};

function nearby(board: Board): Move[] {
  const cells = new Set<number>();
  for (let row = 0; row < SIZE; row++)
    for (let col = 0; col < SIZE; col++) {
      if (!board[row][col]) continue;
      for (let dr = -2; dr <= 2; dr++)
        for (let dc = -2; dc <= 2; dc++) {
          const r = row + dr,
            c = col + dc;
          if (r >= 0 && r < SIZE && c >= 0 && c < SIZE && !board[r][c])
            cells.add(r * SIZE + c);
        }
    }
  if (!cells.size && board.every((row) => row.every((cell) => !cell)))
    return [{ row: 7, col: 7 }];
  return [...cells].map((index) => ({
    row: Math.floor(index / SIZE),
    col: index % SIZE,
  }));
}

// Every inspected window contains the proposed stone, including broken fours.
export function threatAt(board: Board, move: Move, stone: Stone): Threat {
  let win = false,
    openThrees = 0,
    potential = 0;
  const winningPoints = new Set<number>();
  for (const [dr, dc] of DIRECTIONS) {
    let line = "";
    for (let offset = -4; offset <= 4; offset++) {
      const r = move.row + offset * dr,
        c = move.col + offset * dc;
      const cell = board[r]?.[c];
      line +=
        offset === 0
          ? "X"
          : r < 0 || r >= SIZE || c < 0 || c >= SIZE || cell === opponent(stone)
            ? "#"
            : cell === stone
              ? "X"
              : ".";
    }
    for (let start = 0; start <= 4; start++) {
      const window = line.slice(start, start + 5);
      if (window.includes("#")) continue;
      const count = window.split("X").length - 1;
      if (count === 5) win = true;
      if (count === 4) {
        const offset = start + window.indexOf(".") - 4;
        winningPoints.add(
          (move.row + offset * dr) * SIZE + move.col + offset * dc,
        );
      }
      potential += [0, 1, 8, 60, 0, 0][count];
    }
    const patterns = [".XXX.", ".XX.X.", ".X.XX."];
    if (
      patterns.some((pattern) => {
        for (let start = 0; start + pattern.length <= line.length; start++) {
          if (
            start < 4 &&
            start + pattern.length - 1 > 4 &&
            line.slice(start, start + pattern.length) === pattern
          )
            return true;
        }
        return false;
      })
    )
      openThrees++;
  }
  const score = win
    ? MATE
    : winningPoints.size >= 2
      ? 100_000
      : winningPoints.size && openThrees
        ? 25_000
        : openThrees >= 2
          ? 15_000
          : winningPoints.size
            ? 6_000
            : openThrees
              ? 1_500
              : potential;
  return { win, winningPoints: winningPoints.size, openThrees, score };
}

function ranked(board: Board, stone: Stone): Candidate[] {
  return nearby(board)
    .map((move) => {
      const attack = threatAt(board, move, stone),
        defense = threatAt(board, move, opponent(stone));
      const centrality = 14 - Math.abs(move.row - 7) - Math.abs(move.col - 7);
      const priority = attack.score + defense.score * 1.05 + centrality;
      return { move, attack, defense, priority, score: priority };
    })
    .sort(
      (a, b) =>
        b.priority - a.priority ||
        a.move.row - b.move.row ||
        a.move.col - b.move.col,
    );
}

export async function searchCandidates(
  source: Board,
  stone: Stone,
  options: SearchOptions = {},
) {
  const board = source.map((row) => [...row]);
  const started = performance.now();
  const deadline = started + (options.timeMs ?? 700);
  const maxNodes = options.maxNodes ?? 3000;
  let nodes = 0,
    completedDepth = 0;
  const exhausted = new Error("SEARCH_BUDGET");
  const checkAbort = () => options.signal?.throwIfAborted();
  checkAbort();
  const all = ranked(board, stone);
  const wins = all.filter((item) => item.attack.win);
  const blocks = all.filter((item) => item.defense.win);
  // A fork is decisive only when the opponent cannot win on the next turn.
  const forks = all.filter((item) => item.attack.winningPoints >= 2);
  let candidates = wins.length
    ? wins
    : blocks.length
      ? blocks
      : forks.length
        ? forks
        : all.slice(0, 14);
  const mode = wins.length
    ? "immediate-win"
    : blocks.length
      ? "mandatory-defense"
      : forks.length
        ? "winning-fork"
        : "search";

  async function negamax(
    turn: Stone,
    depth: number,
    alpha: number,
    beta: number,
    ply: number,
  ): Promise<number> {
    nodes++;
    if (nodes % 16 === 0) await setImmediate();
    checkAbort();
    if (nodes > maxNodes || performance.now() >= deadline) throw exhausted;
    const list = ranked(board, turn);
    if (!list.length) return 0;
    if (list.some((item) => item.attack.win)) return MATE - ply;
    const forced = list.filter((item) => item.defense.win);
    if (forced.length >= 2) return -MATE + ply + 1;
    if (!forced.length && list.some((item) => item.attack.winningPoints >= 2))
      return MATE - ply - 2;
    // Extend forced replies past the nominal horizon; an unanswered four is
    // not a lost game when the side to move can still block it.
    if ((depth <= 0 && !forced.length) || ply >= 8) {
      const attack = Math.max(...list.map((item) => item.attack.score));
      const defense = Math.max(...list.map((item) => item.defense.score));
      return Math.max(-200_000, Math.min(200_000, attack - defense * 1.1));
    }
    let best = -Infinity;
    for (const candidate of forced.length ? forced : list.slice(0, 8)) {
      const { row, col } = candidate.move;
      board[row][col] = turn;
      let score;
      try {
        score = -(await negamax(
          opponent(turn),
          depth - 1,
          -beta,
          -alpha,
          ply + 1,
        ));
      } finally {
        board[row][col] = null;
      }
      best = Math.max(best, score);
      alpha = Math.max(alpha, score);
      if (alpha >= beta) break;
    }
    return best;
  }

  if (mode === "search" || mode === "mandatory-defense") {
    for (let depth = 1; depth <= (options.maxDepth ?? 4); depth++) {
      const iteration: Candidate[] = [];
      try {
        for (const candidate of candidates) {
          const { row, col } = candidate.move;
          board[row][col] = stone;
          let score;
          // Each root gets a full window so shortlisted scores are comparable.
          try {
            score = -(await negamax(
              opponent(stone),
              depth - 1,
              -Infinity,
              Infinity,
              1,
            ));
          } finally {
            board[row][col] = null;
          }
          iteration.push({ ...candidate, score });
        }
      } catch (error) {
        if (error !== exhausted) throw error;
        break;
      }
      candidates = iteration.sort(
        (a, b) => b.score - a.score || b.priority - a.priority,
      );
      completedDepth = depth;
      if (Math.abs(candidates[0]?.score ?? 0) >= MATE - 100) break;
    }
  }
  checkAbort();
  const best = candidates[0]?.score ?? 0;
  const margin =
    Math.abs(best) >= MATE - 100 ? 0 : Math.max(50, Math.abs(best) * 0.08);
  const shortlist = candidates
    .filter((item) => item.score >= best - margin)
    .slice(0, 4);
  return {
    candidates: shortlist,
    mode,
    depth: completedDepth,
    nodes,
    elapsedMs: Math.round(performance.now() - started),
  };
}
