export const SIZE = 15;
export type Stone = "black" | "white";
export type Move = { row: number; col: number };
export type Board = (Stone | null)[][];
export const opponent = (stone: Stone): Stone =>
  stone === "black" ? "white" : "black";
export const stoneAt = (index: number): Stone =>
  index % 2 === 0 ? "black" : "white";
export const coordinate = ({ row, col }: Move) =>
  `${String.fromCharCode(65 + col)}${SIZE - row}`;

export function winningLine(board: Board, move: Move): Move[] {
  const stone = board[move.row]?.[move.col];
  if (!stone) return [];
  for (const [dr, dc] of [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ]) {
    const line: Move[] = [move];
    for (const sign of [-1, 1]) {
      let row = move.row + dr * sign;
      let col = move.col + dc * sign;
      while (
        row >= 0 &&
        row < SIZE &&
        col >= 0 &&
        col < SIZE &&
        board[row][col] === stone
      ) {
        line.push({ row, col });
        row += dr * sign;
        col += dc * sign;
      }
    }
    if (line.length >= 5) return line;
  }
  return [];
}

export function replay(value: unknown) {
  if (!Array.isArray(value) || value.length > SIZE * SIZE)
    throw new Error("INVALID_HISTORY");
  const board: Board = Array.from({ length: SIZE }, () =>
    Array<Stone | null>(SIZE).fill(null),
  );
  let winner: Stone | null = null;
  let line: Move[] = [];
  for (let index = 0; index < value.length; index++) {
    const move = value[index];
    if (
      winner ||
      !move ||
      !Number.isInteger(move.row) ||
      !Number.isInteger(move.col) ||
      move.row < 0 ||
      move.row >= SIZE ||
      move.col < 0 ||
      move.col >= SIZE ||
      board[move.row][move.col]
    )
      throw new Error("INVALID_HISTORY");
    board[move.row][move.col] = stoneAt(index);
    line = winningLine(board, move);
    if (line.length) winner = stoneAt(index);
  }
  return {
    board,
    winner,
    line,
    draw: !winner && value.length === SIZE * SIZE,
    next: stoneAt(value.length),
  };
}

export function legalChoices(board: Board, ai: Stone) {
  const criteria: Record<string, string> = {};
  for (let row = 0; row < SIZE; row++) {
    for (let col = 0; col < SIZE; col++) {
      if (board[row][col]) continue;
      const move = { row, col };
      board[row][col] = ai;
      const wins = winningLine(board, move).length > 0;
      board[row][col] = opponent(ai);
      const blocks = winningLine(board, move).length > 0;
      board[row][col] = null;
      criteria[`${row}_${col}`] =
        `Place at ${coordinate(move)} (row ${row}, column ${col}). Immediate win: ${wins}. Blocks opponent immediate win at this position: ${blocks}.`;
    }
  }
  return criteria;
}
