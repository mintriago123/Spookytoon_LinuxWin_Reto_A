import assert from "node:assert/strict";
import { test } from "node:test";
import { createBackendApp } from "../src/server.ts";
import { loadGraph } from "../src/modules/graph/load-graph.ts";
import { createRoundPresets } from "../src/config/round-presets.ts";
import { createWorldState, createInitialTelemetryMetrics } from "../src/modules/simulator/world-state.ts";
import { InMemoryPersistenceAdapter } from "../src/modules/persistence/adapter.ts";
import { SimulationRuntime } from "../src/modules/simulator/simulation-runtime.ts";
import { parseRestartCommand } from "../src/modules/simulator/controls.ts";

const { graph } = await loadGraph();
function fixture() {
  const config = createRoundPresets(graph)[1];
  const world = createWorldState({ gameId: "source-game", graph, roundConfig: config,
    randomState: { seed: "same-seed", algorithm: "sha256-counter", algorithmVersion: "1", strategy: "per-zombie-turn-draw" },
    initialMetrics: createInitialTelemetryMetrics(config), updatedAt: "2026-10-28T00:00:00.000Z" });
  world.status = "paused";
  return { config, world };
}

test("repetir usa la configuración guardada y reiniciar usa el preset vigente; ambos crean identidad nueva", async () => {
  const { config, world } = fixture();
  world.survivors[0].nodeId = world.survivors[1].nodeId;
  world.survivors[0].targetShelterId = world.shelters[0].id;
  world.shelters[0].reservados = [world.survivors[0].id];
  const persistence = new InMemoryPersistenceAdapter();
  await persistence.initialize();
  await persistence.save(world);
  config.zombieSpawns.push({ ...config.zombieSpawns[0], id: "extra-in-current-preset" });
  const apiKey = "restart-source-test-api-key";
  const { app, simulator } = await createBackendApp({ apiKey, logger: false, persistence,
    simulator: { rounds: { 1: config } } });
  const headers = { "x-api-key": apiKey };
  const post = (url: string, payload: Record<string, unknown>) => app.inject({ method: "POST", url, headers, payload });
  try {
    await app.ready();
    simulator.scheduleEdge({ eventId: "manual-source-only", edgeId: graph.aristas[0].id,
      bloqueada: true, motivo: "manual", effectiveTurnId: 50 });
    const source = simulator.getCommittedWorld()!;
    const command = { gameId: "repeated-game", roundId: 1, seed: world.rngSeed,
      graphVersion: graph.metadata.graphVersion, restart: { sourceGameId: source.gameId,
        sourceConfigurationRevision: source.configurationIdentity.revision, reuseSavedConfig: true } };
    const prepared = await post("/simulador/prevalidar", command);
    assert.equal(prepared.statusCode, 200);
    assert.equal(prepared.json().round.zombieCounts.caminante, 8);
    assert.equal(simulator.getCommittedWorld(), source);
    assert.equal((await post("/simulador/prevalidar", { ...command, seed: "different" })).statusCode, 409);
    assert.equal((await post("/simulador/prevalidar", { ...command, gameId: source.gameId })).statusCode, 409);
    const body = { gameId: command.gameId, roundId: 1, seed: command.seed,
      restart: command.restart, preparationRevision: prepared.json().preparationRevision };
    assert.equal((await post("/simulador/reiniciar", { ...body, restart: { ...body.restart, reuseSavedConfig: false } })).json().error.code, "PREPARATION_CONFLICT");
    assert.equal((await post("/simulador/reiniciar", { ...body, restart: { ...body.restart, sourceGameId: "stale" } })).json().error.code, "GAME_IDENTITY_CONFLICT");
    assert.equal(simulator.getCommittedWorld(), source);
    assert.equal((await post("/simulador/reiniciar", body)).statusCode, 202);
    const repeated = simulator.getCommittedWorld()!;
    assert.equal(repeated.gameId, "repeated-game");
    assert.equal(repeated.turnId, 0);
    assert.equal(repeated.rngSeed, world.rngSeed);
    assert.equal(repeated.configurationIdentity.revision, world.configurationIdentity.revision);
    assert.deepEqual(repeated.roundConfig, world.roundConfig);
    assert.equal(repeated.survivors[0].nodeId, world.roundConfig.survivorSpawns[0].nodeId);
    assert.equal(repeated.survivors[0].targetShelterId, null);
    assert(repeated.shelters.every(shelter => shelter.reservados.length === 0));
    assert(!repeated.pendingCityEvents.some(event => event.eventId === "manual-source-only"));
    assert.equal((await post("/simulador/prevalidar", { ...command, gameId: "while-running" })).statusCode, 409);
    await post("/simulador/pausar", { reason: "test" });
    await simulator.whenStopped();
    const next = { ...command, gameId: "restarted-game", seed: "fresh-seed", restart: {
      sourceGameId: repeated.gameId, sourceConfigurationRevision: repeated.configurationIdentity.revision, reuseSavedConfig: false,
    } };
    const preview = await post("/simulador/prevalidar", next);
    assert.equal(preview.statusCode, 200);
    assert.equal(preview.json().round.zombieCounts.caminante, 9);
    const latestBody = { gameId: next.gameId, roundId: 1, seed: next.seed, restart: next.restart,
      preparationRevision: preview.json().preparationRevision };
    assert.equal((await post("/simulador/reiniciar", body)).json().error.code, "GAME_IDENTITY_CONFLICT");
    assert.equal((await post("/simulador/reiniciar", latestBody)).statusCode, 202);
    const restarted = simulator.getCommittedWorld()!;
    assert.equal(restarted.gameId, next.gameId);
    assert.equal(restarted.rngSeed, "fresh-seed");
    assert.equal(restarted.roundConfig.zombieSpawns.length, 9);
    assert.notEqual(restarted.configurationIdentity.revision, world.configurationIdentity.revision);
    await post("/simulador/pausar", { reason: "test" });
    await simulator.whenStopped();
    const reference = { sourceGameId: restarted.gameId, sourceConfigurationRevision: restarted.configurationIdentity.revision, reuseSavedConfig: false };
    const competitors = await Promise.all(["competitor-a", "competitor-b"].map(async gameId => {
      const candidate = { gameId, roundId: 1, seed: "next-seed", graphVersion: graph.metadata.graphVersion, restart: reference };
      const validation = await post("/simulador/prevalidar", candidate);
      assert.equal(validation.statusCode, 200);
      return { gameId, roundId: 1, seed: "next-seed", restart: reference, preparationRevision: validation.json().preparationRevision };
    }));
    const results = await Promise.all(competitors.map(body => post("/simulador/reiniciar", body)));
    assert.deepEqual(results.map(result => result.statusCode).sort(), [202, 409]);
    assert(["competitor-a", "competitor-b"].includes(simulator.getCommittedWorld()!.gameId));
    await post("/simulador/pausar", { reason: "test" });
    await simulator.whenStopped();
  } finally { await app.close(); }
});

test("un fallo al construir el reemplazo mantiene mundo, snapshot y cliente anteriores", async () => {
  for (const failure of ["metrics", "client"] as const) {
    const { world, config } = fixture();
    let fail = false;
    let closed = 0;
    const runtime = new SimulationRuntime({ graph, rounds: { 1: config }, syncTimeoutMs: 500,
      initialMetrics: () => { if (fail && failure === "metrics") throw new Error("metrics unavailable"); return createInitialTelemetryMetrics(config); },
      clientFactory: () => {
        if (fail && failure === "client") throw new Error("client unavailable");
        return { sync: async () => { throw new Error("unused"); }, status: async () => { throw new Error("unused"); },
          step: async () => { throw new Error("unused"); }, close: () => { closed++; } };
      }, emitAlert: () => {}, onFailure: () => {} });
    try {
      runtime.restorePaused(world);
      const before = runtime.getCommittedWorld();
      const snapshot = runtime.getCommittedSnapshot();
      fail = true;
      await assert.rejects(runtime.restart({ gameId: "candidate", roundId: 1, seed: "new" }));
      assert.equal(runtime.getCommittedWorld(), before);
      assert.equal(runtime.getCommittedSnapshot(), snapshot);
      assert.equal(closed, 0);
    } finally { await runtime.close(); }
  }
});

test("referencias de reinicio usan esquema cerrado y booleano explícito", () => {
  const base = { gameId: "next", roundId: 1, seed: "seed" };
  assert.deepEqual(parseRestartCommand(base), base);
  assert.throws(() => parseRestartCommand({ ...base, restart: { sourceGameId: "old", sourceConfigurationRevision: "a".repeat(64), reuseSavedConfig: "true" } }), /inválida/);
  assert.throws(() => parseRestartCommand({ ...base, restart: { sourceGameId: "old", sourceConfigurationRevision: "a".repeat(64), reuseSavedConfig: true, extra: 1 } }), /esquema cerrado/);
});
