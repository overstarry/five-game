import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowRight,
  RotateCcw,
  Undo2,
  CircleHelp,
  LoaderCircle,
  ArrowUpRight,
  RefreshCw,
} from "lucide-react";
import {
  coordinate,
  opponent,
  replay,
  SIZE,
  stoneAt,
  type Move,
  type Stone,
} from "../shared/game";
import { errors, t } from "./locale";
import "./style.css";

type Session = { moves: Move[]; player: Stone; started: boolean };
const initial: Session = { moves: [], player: "black", started: false };
function restore(): Session {
  try {
    const data = JSON.parse(localStorage.getItem("five-stones-v1") || "null");
    if (
      data &&
      (data.player === "black" || data.player === "white") &&
      typeof data.started === "boolean"
    ) {
      replay(data.moves);
      if (data.started || data.moves.length === 0) return data;
    }
  } catch {
    /* Invalid or unavailable storage must not prevent a new game. */
  }
  return initial;
}

function App() {
  const [session, setSession] = useState<Session>(restore);
  const [health, setHealth] = useState<
    "checking" | "ready" | "missing" | "error"
  >("checking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [numbers, setNumbers] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [focus, setFocus] = useState(112);
  const controller = useRef<AbortController | null>(null);
  const requestId = useRef(0);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const history = useRef<HTMLDivElement>(null);
  const { moves, player, started } = session;
  const game = replay(moves);
  const finished = Boolean(game.winner || game.draw);
  const isHumanTurn = started && !finished && game.next === player;
  const canPlay = isHumanTurn && !busy && health === "ready";

  async function checkConnection() {
    setHealth("checking");
    try {
      const response = await fetch("/api/health", {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error();
      const data = await response.json();
      setHealth(data.configured ? "ready" : "missing");
    } catch {
      setHealth("error");
    }
  }
  useEffect(() => {
    void checkConnection();
    return () => controller.current?.abort();
  }, []);
  useEffect(() => {
    document.title = `${t.title} · TypeSafe AI`;
    try {
      localStorage.setItem("five-stones-v1", JSON.stringify(session));
    } catch {
      /* Storage is optional. */
    }
    history.current?.scrollTo({ top: history.current.scrollHeight });
  }, [session]);

  function cancelRequest() {
    requestId.current++;
    controller.current?.abort();
    controller.current = null;
    setBusy(false);
    setError("");
  }

  async function requestMove(next: Session) {
    cancelRequest();
    const id = requestId.current;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    try {
      const response = await fetch("/api/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ moves: next.moves, player: next.player }),
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(30000)]),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "AI_UNAVAILABLE");
      const nextMoves = [...next.moves, data.move];
      replay(nextMoves);
      if (id === requestId.current) setSession({ ...next, moves: nextMoves });
    } catch (failure) {
      if (id === requestId.current && !abort.signal.aborted) {
        setError(
          errors[failure instanceof Error ? failure.message : ""] ||
            errors.AI_UNAVAILABLE,
        );
      }
    } finally {
      if (id === requestId.current) {
        controller.current = null;
        setBusy(false);
      }
    }
  }

  function play(move: Move) {
    if (!canPlay || game.board[move.row][move.col]) return;
    const next = { ...session, moves: [...moves, move] };
    setError("");
    setSession(next);
    const result = replay(next.moves);
    if (!result.winner && !result.draw) void requestMove(next);
  }

  function start() {
    cancelRequest();
    setConfirm(false);
    const next = { moves: [], player, started: true };
    setSession(next);
    if (player === "white") void requestMove(next);
  }

  function undo() {
    cancelRequest();
    let index = moves.length - 1;
    while (index >= 0 && stoneAt(index) !== player) index--;
    if (index >= 0) setSession({ ...session, moves: moves.slice(0, index) });
  }

  const title = game.winner
    ? game.winner === player
      ? t.win
      : t.lose
    : game.draw
      ? t.draw
      : busy
        ? t.thinking
        : error
          ? t.paused
          : !started
            ? t.ready
            : isHumanTurn
              ? t.yourTurn
              : t.waiting;
  const hint = game.winner
    ? game.winner === player
      ? t.winHint
      : t.loseHint
    : busy
      ? t.thinkHint
      : t.turnHint;
  const last = moves.at(-1);
  const canUndo = moves.some((_, index) => stoneAt(index) === player);
  const winning = new Set(game.line.map((move) => move.row * SIZE + move.col));

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="/" aria-label={t.title}>
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
            <i />
          </span>
          <span>
            {t.title}
            <small>{t.room}</small>
          </span>
        </a>
        <a
          className="provider"
          href="https://console.typesafe.ai/home"
          target="_blank"
          rel="noreferrer"
        >
          TypeSafe AI <ArrowUpRight size={15} />
        </a>
      </header>

      <main>
        <div className="page-heading">
          <div>
            <h1>{t.subtitle}</h1>
            <p>{t.ruleTitle}</p>
          </div>
          <span className="rule-badge">
            15 × 15 <span /> {t.rules}
          </span>
        </div>
        <div className="game-layout">
          <section className="board-panel" aria-label={t.title}>
            <div className="board-toolbar">
              <span className="turn-indicator">
                <i className={`mini-stone ${game.next}`} />
                {title}
              </span>
              <label className="number-toggle">
                <input
                  type="checkbox"
                  checked={numbers}
                  onChange={(event) => setNumbers(event.target.checked)}
                />
                {t.numbers}
              </label>
            </div>
            <div className="board-frame">
              <div className="column-labels" aria-hidden="true">
                {Array.from({ length: SIZE }, (_, index) => (
                  <span key={index}>{String.fromCharCode(65 + index)}</span>
                ))}
              </div>
              <div className="row-labels" aria-hidden="true">
                {Array.from({ length: SIZE }, (_, index) => (
                  <span key={index}>{SIZE - index}</span>
                ))}
              </div>
              <div
                className="board"
                role="grid"
                aria-label={t.title}
                aria-busy={busy}
              >
                <div className="board-lines" aria-hidden="true">
                  {[3, 7, 11].flatMap((row) =>
                    [3, 7, 11]
                      .filter((col) => row !== 7 || col === 7)
                      .filter((col) => col !== 7 || row === 7)
                      .map((col) => (
                        <i
                          key={`${row}-${col}`}
                          className="star"
                          style={{
                            left: `${(col / 14) * 100}%`,
                            top: `${(row / 14) * 100}%`,
                          }}
                        />
                      )),
                  )}
                </div>
                {Array.from({ length: SIZE }, (_, row) => (
                  <div className="board-row" role="row" key={row}>
                    {Array.from({ length: SIZE }, (_, col) => {
                      const index = row * SIZE + col;
                      const stone = game.board[row][col];
                      const moveIndex = moves.findIndex(
                        (move) => move.row === row && move.col === col,
                      );
                      const isLast = last?.row === row && last?.col === col;
                      return (
                        <div role="gridcell" key={col}>
                          <button
                            ref={(element) => {
                              buttons.current[index] = element;
                            }}
                            className={`intersection ${canPlay && !stone ? `playable preview-${player}` : ""}`}
                            aria-label={`${coordinate({ row, col })}${stone ? ` ${stone === "black" ? t.black : t.white} ${moveIndex + 1}` : ""}`}
                            aria-disabled={!canPlay || Boolean(stone)}
                            tabIndex={focus === index ? 0 : -1}
                            onFocus={() => setFocus(index)}
                            onClick={() => play({ row, col })}
                            onKeyDown={(event) => {
                              const delta = {
                                ArrowLeft: -1,
                                ArrowRight: 1,
                                ArrowUp: -SIZE,
                                ArrowDown: SIZE,
                              }[event.key];
                              if (delta === undefined) return;
                              event.preventDefault();
                              const target = index + delta;
                              if (
                                target >= 0 &&
                                target < SIZE * SIZE &&
                                (Math.abs(delta) !== 1 ||
                                  Math.floor(target / SIZE) === row)
                              )
                                buttons.current[target]?.focus();
                            }}
                          >
                            {stone && (
                              <span
                                className={`stone ${stone} ${winning.has(index) ? "winning" : ""} ${isLast ? "latest" : ""}`}
                              >
                                {numbers ? (
                                  moveIndex + 1
                                ) : isLast ? (
                                  <i />
                                ) : null}
                              </span>
                            )}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
            <div className="board-caption">
              <span>
                <i className="last-dot" />
                {t.last}
                {last ? ` ${coordinate(last)}` : " —"}
              </span>
              <span>{t.keyboard}</span>
            </div>
          </section>

          <aside className="sidebar">
            <section className="match-panel">
              <div className="opponents">
                <div className={isHumanTurn ? "opponent active" : "opponent"}>
                  <span className={`avatar ${player}`} />
                  <strong>{t.you}</strong>
                  <small>{player === "black" ? t.first : t.second}</small>
                </div>
                <span className="versus">/</span>
                <div className={busy ? "opponent active" : "opponent"}>
                  <span className={`avatar ${opponent(player)}`} />
                  <strong>{t.ai}</strong>
                  <small>TypeSafe · Jev</small>
                </div>
              </div>
              <div className="status" role="status" aria-live="polite">
                <h2>
                  {busy && <LoaderCircle className="spin" size={20} />}
                  {title}
                </h2>
                <p>{hint}</p>
              </div>
              {!started && (
                <fieldset className="color-choice">
                  <legend>{t.choose}</legend>
                  {(["black", "white"] as const).map((color) => (
                    <button
                      key={color}
                      aria-pressed={player === color}
                      onClick={() => setSession({ ...session, player: color })}
                    >
                      <i className={`mini-stone ${color}`} />
                      {color === "black" ? t.black : t.white}
                      <small>{color === "black" ? t.first : t.second}</small>
                    </button>
                  ))}
                </fieldset>
              )}
              {health !== "ready" && (
                <div className="connection-notice" role="status">
                  <strong>
                    {health === "checking"
                      ? t.checking
                      : health === "missing"
                        ? t.unconfigured
                        : t.paused}
                  </strong>
                  <p>
                    {health === "missing"
                      ? t.setup
                      : health === "error"
                        ? errors.AI_UNAVAILABLE
                        : t.checking}
                  </p>
                  {health !== "checking" && (
                    <button onClick={() => void checkConnection()}>
                      <RefreshCw size={14} />
                      {t.check}
                    </button>
                  )}
                </div>
              )}
              {error && (
                <div className="error-notice" role="alert">
                  {error}
                </div>
              )}
              {!started || finished ? (
                <button
                  className="primary-button"
                  disabled={health !== "ready"}
                  onClick={start}
                >
                  {finished ? t.restart : t.start}
                  <ArrowRight size={18} />
                </button>
              ) : (
                <>
                  {!isHumanTurn && !busy && (
                    <button
                      className="primary-button"
                      disabled={health !== "ready"}
                      onClick={() => void requestMove(session)}
                    >
                      {error ? t.retry : t.resume}
                      <RefreshCw size={16} />
                    </button>
                  )}
                  <div className="game-actions">
                    <button disabled={!canUndo} onClick={undo}>
                      <Undo2 size={17} />
                      {t.undo}
                    </button>
                    <button onClick={() => setConfirm(true)}>
                      <RotateCcw size={16} />
                      {t.newGame}
                    </button>
                  </div>
                </>
              )}
              {confirm && (
                <div className="restart-confirm" role="alert">
                  <p>{t.confirm}</p>
                  <button
                    onClick={() => {
                      cancelRequest();
                      setSession({ ...initial, player });
                      setConfirm(false);
                    }}
                  >
                    {t.newGame}
                  </button>
                  <button onClick={() => setConfirm(false)}>{t.cancel}</button>
                </div>
              )}
            </section>

            <section className="history-panel">
              <div className="section-heading">
                <h2>{t.moves}</h2>
                <span>
                  {moves.length} {t.move}
                </span>
              </div>
              <div className="history-scroll" ref={history}>
                {moves.length === 0 ? (
                  <div className="history-empty">
                    <span className="empty-board" aria-hidden="true">
                      <i />
                    </span>
                    <p>{t.empty}</p>
                    <small>{t.emptyHint}</small>
                  </div>
                ) : (
                  <ol className="move-list">
                    {moves.map((move, index) => (
                      <li
                        key={index}
                        className={index === moves.length - 1 ? "current" : ""}
                      >
                        <span className="move-index">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <i className={`mini-stone ${stoneAt(index)}`} />
                        <span>{stoneAt(index) === player ? t.you : t.ai}</span>
                        <strong>{coordinate(move)}</strong>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </section>
            <details className="rules">
              <summary>
                <CircleHelp size={16} />
                {t.rules}
              </summary>
              <p>{t.ruleText}</p>
            </details>
          </aside>
        </div>
      </main>
      <footer>
        <span>{t.footer}</span>
        <span className="connection-state">
          <i className={health === "ready" ? "online" : ""} />
          TypeSafe AI ·{" "}
          {health === "ready"
            ? t.connected
            : health === "checking"
              ? t.checking
              : t.unconfigured}
        </span>
      </footer>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
