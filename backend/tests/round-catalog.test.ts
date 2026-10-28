import assert from "node:assert/strict";
import { test } from "node:test";
import { createBackendApp } from "../src/server.ts";
import { createRoundPresets } from "../src/config/round-presets.ts";
import { loadGraph } from "../src/modules/graph/load-graph.ts";

const apiKey = "round-catalog-test-key-123456";

test("una configuración incompatible no se publica como preset válido", async () => {
  const { graph } = await loadGraph();
  const rounds = createRoundPresets(graph);
  const { app, simulator } = await createBackendApp({ apiKey, logger: false,
    simulator: { rounds: { 2: rounds[1] } } });
  try {
    const response = await app.inject({ url: "/simulador/rondas", headers: { "x-api-key": apiKey } });
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().error.code, "ROUND_NOT_CONFIGURED");
    assert.equal(simulator.getCommittedWorld(), null);
  } finally { await app.close(); }
});

test("catálogo autenticado refleja overrides y no crea ni modifica una partida", async () => {
  const { graph } = await loadGraph();
  const round = createRoundPresets(graph)[2];
  round.eventPlan[0].effectiveTurnId = 77;
  round.zombieSpawns.push({ id: "extra-walker", tipo: "caminante", nodeId: round.zombieSpawns[0].nodeId });
  const { app, simulator } = await createBackendApp({ apiKey, logger: false, simulator: { rounds: { 2: round } } });
  try {
    assert.equal((await app.inject("/simulador/rondas")).statusCode, 401);
    const login = await app.inject({ method: "POST", url: "/operador/sesion", payload: { password: apiKey } });
    const cookie = String(login.headers["set-cookie"]).split(";")[0];
    const response = await app.inject({ url: "/simulador/rondas", headers: { cookie } });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["cache-control"], "no-store");
    const catalog = response.json();
    assert.equal(catalog.graphVersion, graph.metadata.graphVersion);
    assert.deepEqual(catalog.rounds.map((item: { survivorCount: number }) => item.survivorCount), [20, 80, 200]);
    assert.equal(catalog.rounds[1].eventPlan[0].effectiveTurnId, 77);
    assert.equal(catalog.rounds[1].zombieCounts.caminante, 13);
    assert.equal(simulator.getCommittedWorld(), null);
    assert.equal(simulator.getCommittedSnapshot(), null);
    const start = await app.inject({ method: "POST", url: "/simulador/iniciar", headers: { cookie },
      payload: { gameId: "catalog-game", roundId: 2, seed: "same-seed" } });
    assert.equal(start.statusCode, 202);
    await app.inject({ method: "POST", url: "/simulador/pausar", headers: { cookie }, payload: { reason: "test" } });
    await simulator.whenStopped();
    const before = simulator.getCommittedSnapshot();
    await app.inject({ url: "/simulador/rondas", headers: { cookie } });
    assert.equal(simulator.getCommittedSnapshot(), before);
    assert.equal(simulator.getCommittedWorld()?.rngSeed, "same-seed");
  } finally { await app.close(); }
});
