import express from "express";
import { ApiError, chooseMove } from "./ai.js";
import { replay } from "../shared/game.js";

export function createApp(config: {
  apiKey: string;
  model: string;
  fetcher?: typeof fetch;
}) {
  const app = express();
  app.disable("x-powered-by");
  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use("/api", (req, res, next) => {
    const origin = req.get("origin");
    if (origin && new URL(origin).host !== req.get("host")) {
      res.status(403).json({ error: "FORBIDDEN" });
      return;
    }
    next();
  });
  app.use(express.json({ limit: "16kb" }));
  app.get("/api/health", (_req, res) =>
    res.json({ configured: Boolean(config.apiKey), model: config.model }),
  );
  let active = 0;
  app.post("/api/move", async (req, res) => {
    const { moves, player } = req.body ?? {};
    if (player !== "black" && player !== "white") {
      res.status(400).json({ error: "INVALID_HISTORY" });
      return;
    }
    try {
      replay(moves);
    } catch {
      res.status(400).json({ error: "INVALID_HISTORY" });
      return;
    }
    if (active >= 4) {
      res.status(429).json({ error: "AI_RATE_LIMIT" });
      return;
    }
    active++;
    const controller = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) controller.abort();
    });
    try {
      res.json(
        await chooseMove(moves, player, {
          ...config,
          signal: controller.signal,
        }),
      );
    } catch (error) {
      const failure =
        error instanceof ApiError ? error : new ApiError("AI_UNAVAILABLE", 502);
      if (!res.destroyed)
        res.status(failure.status).json({ error: failure.code });
    } finally {
      active--;
    }
  });
  app.use("/api", (_req, res) => res.status(404).json({ error: "NOT_FOUND" }));
  app.use(
    (
      error: { status?: number },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res
        .status(error.status === 413 ? 413 : 400)
        .json({ error: "INVALID_REQUEST" });
    },
  );
  return app;
}
