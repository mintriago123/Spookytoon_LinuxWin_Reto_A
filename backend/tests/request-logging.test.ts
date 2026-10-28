import assert from "node:assert/strict";
import { test } from "node:test";
import { Writable } from "node:stream";
import { createBackendApp } from "../src/server.ts";

test("logs acotados conservan controles y errores sin API key, seed ni payload completo", async () => {
  const lines: string[] = [];
  const stream = new Writable({ write(chunk, _encoding, callback) { lines.push(chunk.toString()); callback(); } });
  const key = "logging-private-test-key", seed = "logging-private-test-seed";
  const { app } = await createBackendApp({ apiKey: key, logger: { level: "info", stream }, requestLogging: false });
  try {
    assert.equal((await app.inject("/health/ready")).statusCode, 200);
    assert.equal((await app.inject({ method: "POST", url: "/simulador/iniciar", headers: { "x-api-key": key },
      payload: { gameId: "logging-game", roundId: 1, seed } })).statusCode, 202);
    assert.equal((await app.inject({ method: "POST", url: "/simulador/pausar", payload: { reason: seed } })).statusCode, 401);
  } finally { await app.close(); }
  const text = lines.join(""); assert(!text.includes(key)); assert(!text.includes(seed));
  const records = text.trim().split("\n").map(line => JSON.parse(line));
  assert(records.some(r => r.event === "http-response" && r.statusCode === 202 && r.gameId === "logging-game" && r.requestId));
  assert(records.some(r => r.event === "http-response" && r.statusCode === 401));
  assert(!records.some(r => r.req || r.msg === "incoming request"));
});
