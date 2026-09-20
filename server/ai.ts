import {
  coordinate,
  opponent,
  replay,
  stoneAt,
  type Move,
  type Stone,
} from "../shared/game.js";
import { searchCandidates } from "./strategy.js";

export class ApiError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code);
  }
}

export async function chooseMove(
  moves: Move[],
  player: Stone,
  options: {
    apiKey: string;
    model: string;
    fetcher?: typeof fetch;
    signal?: AbortSignal;
  },
) {
  const game = replay(moves);
  if (game.winner || game.draw || game.next === player)
    throw new ApiError("INVALID_TURN", 400);
  if (!options.apiKey) throw new ApiError("NOT_CONFIGURED", 503);
  let analysis;
  try {
    analysis = await searchCandidates(game.board, opponent(player), {
      signal: options.signal,
    });
  } catch (error) {
    if (options.signal?.aborted) throw new ApiError("CANCELLED", 499);
    throw error;
  }
  const criteria = Object.fromEntries(
    analysis.candidates.map(({ move, attack, defense, score }) => [
      `${move.row}_${move.col}`,
      `Place at ${coordinate(move)}. Search score: ${score} (higher is better). Immediate win: ${attack.win}. Blocks immediate win: ${defense.win}. Creates ${attack.winningPoints} distinct next-turn winning points and ${attack.openThrees} open-three directions. Opponent threat score prevented at this point: ${defense.score}.`,
    ]),
  );
  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(
      "https://api.typesafe.ai/v1/systemone",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.any([
          AbortSignal.timeout(25000),
          ...(options.signal ? [options.signal] : []),
        ]),
        body: JSON.stringify({
          model: options.model,
          state: JSON.stringify({
            game: "Freestyle Gomoku on a 15x15 board. Black starts. Five or more contiguous stones horizontally, vertically or diagonally wins. No forbidden moves.",
            yourStone: opponent(player),
            search: {
              mode: analysis.mode,
              completedDepth: analysis.depth,
              scoreMeaning:
                "Bounded selective minimax evaluation, not a win probability. Candidates have comparable scores from the last fully completed depth. Tactical constraints are mandatory.",
            },
            coordinates:
              "Rows and columns are zero-based; row 0 is top. Labels A15 to O1.",
            board: game.board.map((row) =>
              row
                .map((cell) =>
                  cell === "black" ? "B" : cell === "white" ? "W" : ".",
                )
                .join(""),
            ),
            history: moves.map(
              (move, index) => `${stoneAt(index)}:${coordinate(move)}`,
            ),
          }),
          questions: {
            move: {
              type: "choice",
              instructions:
                "Select one of the supplied tactically screened Gomoku moves for yourStone. The local search already enforces immediate wins and mandatory defense. Among these similarly evaluated options, prefer coordinated threats and useful connections while limiting the opponent's counterplay. Use the computed facts; do not invent alternative coordinates. Search scores are heuristic, not probabilities.",
              criteria,
            },
          },
        }),
      },
    );
  } catch (error) {
    if (options.signal?.aborted) throw new ApiError("CANCELLED", 499);
    if (
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    )
      throw new ApiError("AI_TIMEOUT", 504);
    throw new ApiError("AI_UNAVAILABLE", 502);
  }
  if (!response.ok)
    throw new ApiError(
      response.status === 429
        ? "AI_RATE_LIMIT"
        : response.status === 401 || response.status === 403
          ? "AI_AUTH"
          : "AI_UNAVAILABLE",
      response.status === 429 ? 429 : 502,
    );
  let result;
  try {
    result = await response.json();
  } catch {
    throw new ApiError("AI_INVALID_RESPONSE", 502);
  }
  const answer = result?.answers?.move;
  if (
    answer?.type !== "choice" ||
    typeof answer.choice !== "string" ||
    !Object.hasOwn(criteria, answer.choice)
  )
    throw new ApiError("AI_INVALID_RESPONSE", 502);
  const [row, col] = answer.choice.split("_").map(Number);
  return {
    move: { row, col },
    model: typeof result.model === "string" ? result.model : options.model,
  };
}
