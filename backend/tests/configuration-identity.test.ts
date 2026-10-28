import assert from "node:assert/strict";
import { test } from "node:test";
import { createBackendApp } from "../src/server.ts";
import { loadGraph } from "../src/modules/graph/load-graph.ts";
import { createRoundPresets } from "../src/config/round-presets.ts";
import { createWorldState, createInitialTelemetryMetrics } from "../src/modules/simulator/world-state.ts";
import { InMemoryPersistenceAdapter, toStoredGame } from "../src/modules/persistence/adapter.ts";
import { recoverWorld } from "../src/modules/persistence/recovery.ts";

const { graph } = await loadGraph();
const randomState = { seed: " original seed ", algorithm: "sha256-counter", algorithmVersion: "1",
  strategy: "per-zombie-turn-draw" as const };
function fixture() {
  const config = createRoundPresets(graph)[1];
  const world = createWorldState({ gameId: "frozen-game", graph, roundConfig: config,
    randomState, initialMetrics: createInitialTelemetryMetrics(config), updatedAt: "2026-10-28T00:00:00.000Z" });
  world.status = "paused";
  return { config, world };
}

test("la huella identifica grafo+ronda, queda congelada y no depende de identidad o semilla", () => {
  const { world, config } = fixture();
  const before = world.configurationIdentity.revision;
  config.zombieSpawns.push({ ...config.zombieSpawns[0], id: "extra" });
  assert.equal(world.roundConfig.zombieSpawns.length, 8);
  assert.equal(world.configurationIdentity.revision, before);
  assert.equal(Object.isFrozen(world.configurationIdentity), true);
  assert.equal(Reflect.set(world.roundConfig.survivorSpawns[0], "nodeId", "bad"), false);
  const other = createWorldState({ gameId: "another-game", graph, roundConfig: world.roundConfig,
    randomState: { ...randomState, seed: "another-seed" }, initialMetrics: world.metrics, updatedAt: world.updatedAt });
  assert.equal(other.configurationIdentity.revision, before);
});

test("recuperar preserva la versión y vuelve a congelar copias independientes del checkpoint", () => {
  const { world } = fixture();
  const stored = toStoredGame(world);
  const recovered = recoverWorld(stored, structuredClone(graph));
  assert.deepEqual(recovered.configurationIdentity, world.configurationIdentity);
  assert.deepEqual(recovered.randomState, randomState);
  assert.equal(Object.isFrozen(recovered.roundConfig), true);
  assert.equal(Object.isFrozen(recovered.graph.nodos[0]), true);
  Reflect.set(stored.roundConfig.survivorSpawns[0], "nodeId", "changed-after-recovery");
  stored.randomState.seed = "changed-after-recovery";
  assert.notEqual(recovered.roundConfig.survivorSpawns[0].nodeId, "changed-after-recovery");
  assert.equal(recovered.randomState.seed, randomState.seed);
  assert.throws(() => recoverWorld({ ...toStoredGame(world), roundId: 2 }, graph), /ronda/);
});

test("recuperación detecta cambios del grafo con igual graphVersion y de configuración válida", () => {
  const { world } = fixture();
  const stored = toStoredGame(world);
  const changedGraph = structuredClone(graph);
  changedGraph.nodos[0].lat += 0.00001;
  assert.throws(() => recoverWorld(stored, changedGraph), /huella/);
  const changed = toStoredGame(world);
  changed.roundConfig = { ...changed.roundConfig, zombieSpawns: [...changed.roundConfig.zombieSpawns,
    { ...changed.roundConfig.zombieSpawns[0], id: "extra" }] };
  assert.throws(() => recoverWorld(changed, graph), /huella/);
  const legacy = toStoredGame(world);
  delete legacy.configurationIdentity;
  const recovered = recoverWorld(legacy, graph);
  assert.equal(recovered.configurationIdentity.provenance, "derived-from-legacy-checkpoint");
  assert.equal(recoverWorld(toStoredGame(recovered), graph).configurationIdentity.provenance, "derived-from-legacy-checkpoint");
});

test("API de partida recuperada usa su configuración guardada, con identidad exacta y autenticación", async () => {
  const { world, config } = fixture();
  const persistence = new InMemoryPersistenceAdapter();
  await persistence.initialize();
  await persistence.save(world);
  config.zombieSpawns.push({ ...config.zombieSpawns[0], id: "preset-changed-after-save" });
  const apiKey = "saved-configuration-test-key";
  const { app, simulator } = await createBackendApp({ apiKey, logger: false, persistence,
    simulator: { rounds: { 1: config } } });
  try {
    const url = `/simulador/configuracion/${world.gameId}`;
    assert.equal((await app.inject(url)).statusCode, 401);
    const login = await app.inject({ method: "POST", url: "/operador/sesion", payload: { password: apiKey } });
    const headers = { cookie: String(login.headers["set-cookie"]).split(";")[0] };
    const before = simulator.getCommittedWorld();
    const response = await app.inject({ url, headers });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.equal(response.json().round.zombieCounts.caminante, 8);
    assert.equal(response.json().random.seed, randomState.seed);
    assert.deepEqual(response.json().configurationIdentity, world.configurationIdentity);
    assert.equal(simulator.getCommittedWorld(), before);
    assert.equal((await app.inject({ url: "/simulador/configuracion/another-game", headers })).statusCode, 404);
    assert.equal((await app.inject("/estado")).json().configurationIdentity, undefined);
  } finally { await app.close(); }
});
