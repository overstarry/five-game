import "dotenv/config";
import express from "express";
import { resolve } from "node:path";
import { createApp } from "./app.js";

const app = createApp({
  apiKey: process.env.TYPESAFE_API_KEY?.trim() ?? "",
  model: process.env.TYPESAFE_MODEL || "jev-latest",
});
if (process.argv.includes("--production")) {
  app.use(express.static(resolve("dist")));
  app.get("/{*path}", (_req, res) => res.sendFile(resolve("dist/index.html")));
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 3000);
app.listen(port, host, () =>
  console.log(`Five Stones: http://${host}:${port}`),
);
