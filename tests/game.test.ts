import test from "node:test";
import assert from "node:assert/strict";
import {
  legalChoices,
  replay,
  winningLine,
  SIZE,
  type Board,
} from "../shared/game.js";
import { chooseMove, ApiError } from "../server/ai.js";
import { createApp } from "../server/app.js";

for (const [dr, dc] of [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
]) {
  test(`detects five and overlines in direction ${dr},${dc}`, () => {
    const board: Board = Array.from({ length: SIZE }, () =>
      Array(SIZE).fill(null),
    );
    for (let count = 0; count < 6; count++)
      board[2 + dr * count][8 + dc * count] = "black";
    assert.equal(winningLine(board, { row: 2, col: 8 }).length, 6);
  });
}
test("does not join stones across edges or gaps", () => {
  const board = replay([
    { row: 0, col: 14 },
    { row: 2, col: 0 },
    { row: 1, col: 0 },
  ]).board;
  assert.deepEqual(winningLine(board, { row: 0, col: 14 }), []);
});
test("rejects duplicates, malformed moves, overflow and play after a win", () => {
  for (const input of [
    null,
    [{ row: -1, col: 2 }],
    [{ row: 1.5, col: 2 }],
    [{ row: 15, col: 0 }],
    [
      { row: 0, col: 0 },
      { row: 0, col: 0 },
    ],
  ])
    assert.throws(() => replay(input));
  const moves = Array.from({ length: 9 }, (_, i) => ({
    row: i % 2,
    col: Math.floor(i / 2),
  }));
  assert.equal(replay(moves).winner, "black");
  assert.throws(() => replay([...moves, { row: 2, col: 0 }]));
});
test("legal choices include every empty cell without mutating the board", () => {
  const board = replay([{ row: 7, col: 7 }]).board;
  const before = structuredClone(board);
  const choices = legalChoices(board, "white");
  assert.equal(Object.keys(choices).length, 224);
  assert.equal(choices["7_7"], undefined);
  assert.deepEqual(board, before);
});
test("calls TypeSafe with a constrained choice and validates the response", async () => {
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(url, "https://api.typesafe.ai/v1/systemone");
    const payload = JSON.parse(String(init?.body));
    assert.equal(payload.model, "jev-latest");
    assert.equal(payload.questions.move.type, "choice");
    assert.equal(payload.questions.move.criteria["7_7"], undefined);
    return Response.json({
      model: "jev-test",
      answers: { move: { type: "choice", choice: "7_8" } },
    });
  };
  const result = await chooseMove([{ row: 7, col: 7 }], "black", {
    apiKey: "test-only",
    model: "jev-latest",
    fetcher,
  });
  assert.deepEqual(result.move, { row: 7, col: 8 });
});
test("does not substitute a local move on invalid upstream responses", async () => {
  for (const choice of ["7_7", "99_99", "__proto__", null]) {
    await assert.rejects(
      chooseMove([{ row: 7, col: 7 }], "black", {
        apiKey: "test-only",
        model: "jev-latest",
        fetcher: async () =>
          Response.json({ answers: { move: { type: "choice", choice } } }),
      }),
      (error: unknown) =>
        error instanceof ApiError && error.code === "AI_INVALID_RESPONSE",
    );
  }
});
test("rejects human turns and missing configuration before making an upstream call", async () => {
  const config = {
    apiKey: "",
    model: "jev-latest",
    fetcher: async () => {
      throw new Error("Unexpected call");
    },
  };
  await assert.rejects(chooseMove([], "black", config), /INVALID_TURN/);
  await assert.rejects(chooseMove([], "white", config), /NOT_CONFIGURED/);
});
test("maps authentication, throttling, malformed JSON, network and timeout failures", async () => {
  const cases: [typeof fetch, string][] = [
    [async () => new Response("", { status: 401 }), "AI_AUTH"],
    [async () => new Response("", { status: 429 }), "AI_RATE_LIMIT"],
    [async () => new Response("not json"), "AI_INVALID_RESPONSE"],
    [
      async () => {
        throw new TypeError("network");
      },
      "AI_UNAVAILABLE",
    ],
    [
      async () => {
        throw new DOMException("timed out", "TimeoutError");
      },
      "AI_TIMEOUT",
    ],
  ];
  for (const [fetcher, code] of cases) {
    await assert.rejects(
      chooseMove([], "white", {
        apiKey: "test-only",
        model: "jev-latest",
        fetcher,
      }),
      (error: unknown) => error instanceof ApiError && error.code === code,
    );
  }
});
test("HTTP boundary rejects invalid states and never returns the API key", async () => {
  const app = createApp({ apiKey: "private-test-key", model: "jev-latest" });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;
  try {
    const health = await (await fetch(`${url}/api/health`)).text();
    assert.ok(!health.includes("private-test-key"));
    const response = await fetch(`${url}/api/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ moves: [{ row: 16, col: 0 }], player: "black" }),
    });
    assert.equal(response.status, 400);
    const foreign = await fetch(`${url}/api/move`, {
      method: "POST",
      headers: {
        Origin: "https://untrusted.example",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    assert.equal(foreign.status, 403);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
