import test from "node:test";
import assert from "node:assert/strict";
import { searchCandidates, threatAt } from "../server/strategy.js";
import { chooseMove } from "../server/ai.js";
import { SIZE, type Board, type Stone } from "../shared/game.js";

function position(stones: [Stone, number, number][]): Board {
  const board: Board = Array.from({ length: SIZE }, () =>
    Array(SIZE).fill(null),
  );
  for (const [stone, row, col] of stones) board[row][col] = stone;
  return board;
}
const keys = (result: Awaited<ReturnType<typeof searchCandidates>>) =>
  result.candidates.map(({ move }) => `${move.row}_${move.col}`);

test("opening is centered and input board remains unchanged", async () => {
  const board = position([]),
    before = structuredClone(board);
  assert.deepEqual(keys(await searchCandidates(board, "black")), ["7_7"]);
  assert.deepEqual(board, before);
});

test("takes its own win before defending the opponent", async () => {
  const board = position([
    ...[2, 3, 4, 5].map((col) => ["white", 5, col] as [Stone, number, number]),
    ...[3, 4, 5, 6].map((col) => ["black", 9, col] as [Stone, number, number]),
  ]);
  const result = await searchCandidates(board, "white");
  assert.equal(result.mode, "immediate-win");
  assert.ok(keys(result).every((key) => ["5_1", "5_6"].includes(key)));
});

test("forces defense against a broken four", async () => {
  const board = position([
    ...[3, 4, 6, 7].map((col) => ["black", 7, col] as [Stone, number, number]),
  ]);
  assert.deepEqual(keys(await searchCandidates(board, "white")), ["7_5"]);
});

test("detects open threes, broken threes and edge-closed lines", () => {
  assert.equal(
    threatAt(
      position([
        ["black", 7, 5],
        ["black", 7, 6],
      ]),
      { row: 7, col: 7 },
      "black",
    ).openThrees,
    1,
  );
  assert.equal(
    threatAt(
      position([
        ["black", 7, 4],
        ["black", 7, 6],
      ]),
      { row: 7, col: 7 },
      "black",
    ).openThrees,
    1,
  );
  assert.equal(
    threatAt(
      position([
        ["black", 0, 0],
        ["black", 0, 1],
      ]),
      { row: 0, col: 2 },
      "black",
    ).openThrees,
    0,
  );
});

test("creates a double-four fork and recognizes distinct winning points", async () => {
  const board = position([
    ...[5, 6, 8].map((col) => ["white", 7, col] as [Stone, number, number]),
    ...[5, 6, 8].map((row) => ["white", row, 7] as [Stone, number, number]),
  ]);
  assert.equal(threatAt(board, { row: 7, col: 7 }, "white").winningPoints, 4);
  const result = await searchCandidates(board, "white");
  assert.equal(result.mode, "winning-fork");
  assert.ok(keys(result).includes("7_7"));
  assert.ok(
    result.candidates.every((candidate) => candidate.attack.winningPoints >= 2),
  );
});

test("defends an open three before it becomes an unstoppable open four", async () => {
  const board = position([
    ...[5, 6, 7].map((col) => ["black", 7, col] as [Stone, number, number]),
    ["white", 2, 2],
    ["white", 11, 11],
  ]);
  const before = structuredClone(board);
  const result = await searchCandidates(board, "white", {
    timeMs: 5000,
    maxDepth: 3,
    maxNodes: 6000,
  });
  assert.ok(result.depth >= 2, JSON.stringify(result));
  assert.ok(
    keys(result).every((key) => ["7_4", "7_8"].includes(key)),
    JSON.stringify(result),
  );
  assert.deepEqual(board, before);
});

test("budget exhaustion keeps a legal shortlist and cancellation interrupts search", async () => {
  const board = position([
    ["black", 7, 7],
    ["white", 6, 6],
  ]);
  const before = structuredClone(board);
  const result = await searchCandidates(board, "black", { maxNodes: 0 });
  assert.equal(result.depth, 0);
  assert.ok(result.candidates.length > 0 && result.candidates.length <= 4);
  assert.deepEqual(board, before);
  const controller = new AbortController();
  const pending = searchCandidates(board, "black", {
    signal: controller.signal,
    timeMs: 5000,
  });
  setTimeout(() => controller.abort(), 0);
  await assert.rejects(pending, { name: "AbortError" });
  assert.deepEqual(board, before);
});

test("an already lost double threat still returns a legal defensive move", async () => {
  const board = position([
    ...[5, 6, 7, 8].map((col) => ["black", 7, col] as [Stone, number, number]),
  ]);
  const result = await searchCandidates(board, "white");
  assert.ok(result.candidates.length > 0);
  assert.ok(keys(result).every((key) => ["7_4", "7_9"].includes(key)));
});

test("TypeSafe cannot choose a legal but tactically losing alternative", async () => {
  const moves = [
    { row: 7, col: 3 },
    { row: 0, col: 0 },
    { row: 7, col: 4 },
    { row: 0, col: 2 },
    { row: 7, col: 6 },
    { row: 0, col: 4 },
    { row: 7, col: 7 },
  ];
  const fetcher: typeof fetch = async (_url, init) => {
    const payload = JSON.parse(String(init?.body));
    assert.deepEqual(Object.keys(payload.questions.move.criteria), ["7_5"]);
    assert.equal(JSON.parse(payload.state).search.mode, "mandatory-defense");
    return Response.json({
      answers: { move: { type: "choice", choice: "2_2" } },
    });
  };
  await assert.rejects(
    chooseMove(moves, "black", {
      apiKey: "test-only",
      model: "jev-latest",
      fetcher,
    }),
    /AI_INVALID_RESPONSE/,
  );
});
