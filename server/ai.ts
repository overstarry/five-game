import {
  coordinate,
  legalChoices,
  opponent,
  replay,
  stoneAt,
  type Move,
  type Stone,
} from "../shared/game.js";

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
  const criteria = legalChoices(game.board, opponent(player));
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
                "Choose the strongest legal Gomoku move for yourStone. Take an immediate winning move first; otherwise block an immediate opponent win. Otherwise create open fours, double threats or open threes while defending. Use the supplied tactical facts. On an empty board prefer the center.",
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
