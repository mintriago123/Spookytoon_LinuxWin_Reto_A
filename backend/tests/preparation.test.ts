import assert from "node:assert/strict";
import { test } from "node:test";
import { createBackendApp } from "../src/server.ts";
import { createRoundPresets } from "../src/config/round-presets.ts";
import { loadGraph } from "../src/modules/graph/load-graph.ts";
import { parsePreparationCommand, parseStartCommand } from "../src/modules/simulator/controls.ts";
import { preparationRevision } from "../src/modules/simulator/preparation.ts";
import { SimulationRuntime } from "../src/modules/simulator/simulation-runtime.ts";
import { createInitialTelemetryMetrics } from "../src/modules/simulator/world-state.ts";

const apiKey = "preparation-test-api-key-12345";
const { graph } = await loadGraph();
const command = { gameId: "prepared-game", roundId: 1 as const, seed: " reproducible ", graphVersion: graph.metadata.graphVersion };

test("prevalidar no usa reloj, routing, telemetría ni publicaciones, ni consume identidad o semilla", async () => {
  const rounds = createRoundPresets(graph);
  let sideEffects = 0;
  const unexpected = (): never => { sideEffects++; throw new Error("Efecto inesperado"); };
  const runtime = new SimulationRuntime({ graph, rounds, syncTimeoutMs: 500,
    clientFactory: unexpected, initialMetrics: unexpected, emitAlert: unexpected, onFailure: unexpected,
    clock: { now: unexpected, waitUntil: unexpected }, isoNow: unexpected, getPersistenceProgress: unexpected });
  runtime.subscribeCommitted(unexpected);
  try {
    const first = runtime.prevalidate(command);
    const second = runtime.prevalidate(command);
    assert.deepEqual(first, second);
    assert.equal(first.seed, command.seed);
    assert.equal(first.round.survivorCount, 20);
    assert.equal(runtime.getCommittedWorld(), null);
    assert.equal(runtime.getCommittedSnapshot(), null);
    assert.equal(sideEffects, 0);
    assert.equal(runtime.prevalidate({ ...command, seed: "otra" }).seed, "otra");
  } finally { await runtime.close(); }
});

test("huella canónica conserva orden de arrays e incluye grafo, configuración, identidad, semilla y cámaras", () => {
  const config = createRoundPresets(graph)[1];
  const original = preparationRevision(command, graph, config);
  const reorderedGraph = Object.fromEntries(Object.entries(graph).reverse()) as unknown as typeof graph;
  assert.equal(preparationRevision(command, reorderedGraph, config), original);
  assert.notEqual(preparationRevision({ ...command, gameId: "other" }, graph, config), original);
  assert.notEqual(preparationRevision({ ...command, seed: "other" }, graph, config), original);
  const changedGraph = structuredClone(graph);
  changedGraph.nodos[0].lat += 0.00001;
  assert.notEqual(preparationRevision(command, changedGraph, config), original);
  assert.notEqual(preparationRevision(command, graph, { ...config, survivorSpawns: [...config.survivorSpawns].reverse() }), original);
  // No hace falta configurar cámaras nuevas para comprobar que el catálogo vigente participa.
  const camera = { id: "C1", name: "simulada", lat: 0, lng: 0, accuracyMeters: 1,
    nodeId: graph.nodos[0].id, snapDistanceMeters: 0, coverageRadiusMeters: 10, alertTtlTurns: 2,
    enabled: true, status: "simulated" as const, reportedLocation: "escenario", networkAffiliation: "simulada" };
  assert.notEqual(preparationRevision(command, graph, config, [camera]), original);
});

test("validadores cerrados mantienen la semilla intacta y rechazan revisiones inválidas", () => {
  assert.equal(parsePreparationCommand(command).seed, " reproducible ");
  assert.throws(() => parsePreparationCommand({ ...command, extra: true }), /esquema cerrado/);
  assert.throws(() => parsePreparationCommand({ ...command, seed: " " }), /seed/);
  assert.throws(() => parseStartCommand({ gameId: command.gameId, roundId: 1, seed: "s", preparationRevision: "bad" }), /preparationRevision/);
});

test("API protege prevalidación, rechaza preparación obsoleta y conserva una partida pausada al rechazar reinicio", async () => {
  const config = createRoundPresets(graph)[1];
  const { app, simulator } = await createBackendApp({ apiKey, logger: false, simulator: {
    rounds: { 1: config }, initialMetrics: () => createInitialTelemetryMetrics(config),
  } });
  try {
    assert.equal((await app.inject({ method: "POST", url: "/simulador/prevalidar", payload: command })).statusCode, 401);
    const login = await app.inject({ method: "POST", url: "/operador/sesion", payload: { password: apiKey } });
    const headers = { cookie: String(login.headers["set-cookie"]).split(";")[0] };
    const prepare = (body: Record<string, unknown>) => app.inject({ method: "POST", url: "/simulador/prevalidar", headers, payload: body });
    assert.equal((await prepare({ ...command, graphVersion: "other-graph" })).json().error.code, "GRAPH_VERSION_CONFLICT");
    assert.equal((await prepare({ ...command, extra: true })).statusCode, 400);
    const first = await prepare(command);
    assert.equal(first.statusCode, 200);
    assert.equal(first.headers["cache-control"], "no-store");
    assert.equal(simulator.getCommittedWorld(), null);
    const startBody = { gameId: command.gameId, roundId: 1, seed: command.seed,
      preparationRevision: first.json().preparationRevision };
    const start = (body: Record<string, unknown>) => app.inject({ method: "POST", url: "/simulador/iniciar", headers, payload: body });
    const wrongSeed = await start({ ...startBody, seed: "different" });
    assert.equal(wrongSeed.statusCode, 409);
    assert.equal(wrongSeed.json().error.code, "PREPARATION_CONFLICT");
    config.zombieSpawns.push({ ...config.zombieSpawns[0], id: "extra-zombie" });
    assert.equal((await start(startBody)).json().error.code, "PREPARATION_CONFLICT");
    assert.equal(simulator.getCommittedSnapshot(), null);
    const fresh = (await prepare(command)).json();
    const next = (await prepare({ ...command, gameId: "restart-game" })).json();
    assert.notEqual(fresh.preparationRevision, first.json().preparationRevision);
    assert.equal((await start({ ...startBody, preparationRevision: fresh.preparationRevision })).statusCode, 202);
    const runningWorld = simulator.getCommittedWorld();
    const competing = { gameId: "restart-game", roundId: 1, seed: command.seed, preparationRevision: next.preparationRevision };
    assert.equal((await start(competing)).json().error.code, "GAME_STATE_CONFLICT");
    assert.equal(simulator.getCommittedWorld(), runningWorld);
    assert.equal((await prepare({ ...command, gameId: "another" })).statusCode, 409);
    await app.inject({ method: "POST", url: "/simulador/pausar", headers, payload: { reason: "test" } });
    await simulator.whenStopped();
    const before = simulator.getCommittedWorld();
    assert.equal(before?.rngSeed, command.seed);
    assert.equal((await prepare({ ...command, gameId: "another" })).statusCode, 409);
    assert.equal(simulator.getCommittedWorld(), before);
    assert.equal((await start(competing)).json().error.code, "GAME_STATE_CONFLICT");
    assert.equal(simulator.getCommittedWorld(), before);
    config.zombieSpawns.push({ ...config.zombieSpawns[0], id: "second-extra-zombie" });
    const restart = await app.inject({ method: "POST", url: "/simulador/reiniciar", headers,
      payload: { gameId: "restart-game", roundId: 1, seed: command.seed, preparationRevision: next.preparationRevision } });
    assert.equal(restart.statusCode, 409);
    assert.equal(restart.json().error.code, "PREPARATION_CONFLICT");
    assert.equal(simulator.getCommittedWorld(), before);
  } finally { await app.close(); }
});
