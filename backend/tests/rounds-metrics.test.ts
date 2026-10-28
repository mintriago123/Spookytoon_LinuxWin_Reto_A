import assert from "node:assert/strict";
import { test } from "node:test";
import { createRoundPresets } from "../src/config/round-presets.ts";
import { loadGraph } from "../src/modules/graph/load-graph.ts";
import { RouteEngine } from "../src/modules/routing/route-engine.ts";
import { validateRoundConfig } from "../src/modules/simulator/round-validation.ts";
import { createInitialTelemetryMetrics, createWorldState } from "../src/modules/simulator/world-state.ts";
import { resolveShelterAdmissions, resolveSurvivorDecisions } from "../src/modules/simulator/survivor-resolution.ts";
import { buildWorldSyncRequest } from "../src/modules/simulator/routing-world.ts";
import { SimulationRuntime } from "../src/modules/simulator/simulation-runtime.ts";
import { updateTurnMetrics } from "../src/modules/telemetry/turn-metrics.ts";
import type { DecisionBatch, RouteAttempt, RoundId } from "../src/modules/simulator/types.ts";

const { graph } = await loadGraph();
const rounds = createRoundPresets(graph);
function worldFor(roundId: RoundId = 1) {
  return createWorldState({ gameId: `test-${roundId}`, graph, roundConfig: rounds[roundId],
    initialMetrics: createInitialTelemetryMetrics(rounds[roundId]), updatedAt: "2026-10-28T00:00:00.000Z",
    randomState: { seed: "backend-tests", algorithm: "sha256-counter", algorithmVersion: "1", strategy: "per-zombie-turn-draw" } });
}

test("presets reproducibles de Manta cumplen población, zonas, amenazas y eventos de cada ronda", () => {
  assert.deepEqual(createRoundPresets(graph), rounds);
  const nodes = new Map(graph.nodos.map(node => [node.id, node]));
  const edges = new Map(graph.aristas.map(edge => [edge.id, edge]));
  for (const roundId of [1, 2, 3] as const) {
    const round = rounds[roundId];
    assert.doesNotThrow(() => validateRoundConfig(round, graph));
    assert.equal(round.survivorSpawns.length, [20, 80, 200][roundId - 1]);
    assert.equal(new Set(round.survivorSpawns.map(spawn => spawn.nodeId)).size, round.survivorCount);
    assert.equal(new Set(round.survivorSpawns.map(spawn => nodes.get(spawn.nodeId)!.zona)).size, 4);
    assert.equal(round.eventPlan.length, roundId - 1);
    for (const event of round.eventPlan) assert.equal(edges.get(event.edgeId)!.tipo, roundId === 2 ? "puente" : "calle");
    const initial = worldFor(roundId);
    assert.equal(initial.metrics.activeSurvivors, round.survivorCount);
    assert.equal(initial.metrics.survivalRatePercent, 100);
    assert(initial.shelters.every(shelter => shelter.capacidad === 60));
  }
  for (const zone of ["Tarqui", "Los Esteros", "Jocay", "Barbasquillo"]) {
    assert.equal(rounds[1].survivorSpawns.filter(spawn => nodes.get(spawn.nodeId)!.zona === zone).length, 5);
  }
  assert(rounds[1].zombieSpawns.every(zombie => zombie.tipo === "caminante"));
  assert.deepEqual(new Set(rounds[2].zombieSpawns.map(zombie => zombie.tipo)), new Set(["caminante", "corredor", "horda"]));
  assert.equal(rounds[2].eventPlan[0].effectiveTurnId, 75);
  assert.deepEqual(new Set(rounds[3].zombieSpawns.map(zombie => zombie.tipo)), new Set(["caminante", "corredor", "horda", "dormido"]));
});

test("métricas cuentan respuestas válidas hasta 500 ms, errores, bajas y porcentajes del mundo", () => {
  const world = worldFor();
  world.survivors[0].estado = "evacuado";
  world.survivors[1].estado = "mordido";
  const ids = world.survivors.slice(2, 7).map(survivor => survivor.id);
  const attempts: RouteAttempt[] = ids.map((id, index) => ({
    request: { gameId: world.gameId, turnId: 1, worldVersion: 1, survivorId: id, currentNodeId: world.survivors[index + 2].nodeId },
    elapsedMs: [10, 500, 500, 30, 40][index],
    ...(index === 2 ? { kind: "timeout" as const } : index === 4 ? { kind: "error" as const, error: "HTTP_ERROR" }
      : { kind: "response" as const, body: {} }),
  }));
  const decisions: DecisionBatch = { gameId: world.gameId, turnId: 1, worldVersion: 1, pauseCause: null, alertCode: null,
    decisions: ids.map((id, index) => ({ survivorId: id, decision: "esperar", nodeId: "unused", targetShelterId: null,
      cause: index === 2 ? "timeout" : index === 3 ? "invalid-response" : index === 4 ? "error" : "routing-wait" })) };
  const result = updateTurnMetrics(world, [], attempts, decisions, 100);
  assert.equal(result.metrics.routeSamples, 5);
  assert.equal(result.metrics.routeTimeouts, 1);
  assert.equal(result.metrics.invalidRouteResponses, 1);
  assert.equal(result.metrics.routeErrors, 1);
  assert.equal(result.metrics.routeAvailabilityPercent, 40);
  assert.equal(result.metrics.routeLatencyP95Ms, 500);
  assert.equal(result.metrics.activeSurvivors, 18);
  assert.equal(result.metrics.evacuatedSurvivors, 1);
  assert.equal(result.metrics.bittenSurvivors, 1);
  assert.equal(result.metrics.survivalRatePercent, 95);
  assert.equal(result.metrics.activeSurvivorsPercent, 90);
  assert.equal(result.metrics.evacuatedSurvivorsPercent, 5);
  assert.equal(result.metrics.bittenSurvivorsPercent, 5);
  assert.equal(result.metrics.turnBudgetUsedPercent, 5);
  assert.equal(result.metrics.turnEfficiencyPercent, 100);
  const previous = Array.from({ length: 1_000 }, () => ({ latencyMs: 2, available: true }));
  assert.equal(updateTurnMetrics(world, previous, attempts, decisions, 100).samples.length, 1_000);
  assert.equal(previous.length, 1_000);
});

test("admisión consume reservas, libera mordidos y nunca supera las 60 plazas", () => {
  const world = worldFor();
  const shelter = world.shelters[0];
  const base = world.survivors[0];
  const arrivals = Array.from({ length: 61 }, (_, index) => ({ ...base, id: `A-${String(index).padStart(3, "0")}`,
    nodeId: shelter.nodoId, targetShelterId: shelter.id }));
  arrivals.push({ ...base, id: "Z-reserved", nodeId: shelter.nodoId, targetShelterId: shelter.id });
  const future = { ...base, id: "future", targetShelterId: shelter.id };
  shelter.reservados = ["Z-reserved", "future"];
  const first = resolveShelterAdmissions({ turnId: 1, survivorsAfterBites: [...arrivals, future], shelters: world.shelters });
  assert.equal(first.shelters[0].ocupantes.length, 59);
  assert(first.shelters[0].ocupantes.includes("Z-reserved"));
  assert.deepEqual(first.shelters[0].reservados, ["future"]);
  assert.equal(first.survivors.filter(survivor => survivor.estado === "evacuado").length, 59);
  first.survivors.find(survivor => survivor.id === "future")!.estado = "mordido";
  const second = resolveShelterAdmissions({ turnId: 2, survivorsAfterBites: first.survivors, shelters: first.shelters });
  assert.equal(second.shelters[0].ocupantes.length, 60);
  assert.equal(second.shelters[0].reservados.length, 0);
  assert.equal(new Set(second.shelters[0].ocupantes).size, 60);
  const third = resolveShelterAdmissions({ turnId: 3, survivorsAfterBites: second.survivors, shelters: second.shelters });
  assert.equal(third.shelters[0].ocupantes.length, 60);
});

test("un cupo reservado permite rutear y validar movimientos aun con el refugio totalmente reservado", () => {
  const world = worldFor(2);
  world.zombies = [];
  const shelter = world.shelters[0];
  const reserved = world.survivors.slice(0, 60);
  shelter.reservados = reserved.map(survivor => survivor.id);
  for (const survivor of reserved) survivor.targetShelterId = shelter.id;
  const engine = new RouteEngine(graph);
  const installed = engine.sync(buildWorldSyncRequest(world, 1));
  const survivor = reserved[0];
  const request = { gameId: world.gameId, turnId: 1, worldVersion: installed.worldVersion,
    survivorId: survivor.id, currentNodeId: survivor.nodeId, targetShelterId: shelter.id };
  const response = engine.step(request);
  assert.equal(response.decision, "mover");
  assert.equal(response.targetShelterId, shelter.id);
  const decision = resolveSurvivorDecisions({ gameId: world.gameId, turnId: 1, worldVersion: installed.worldVersion,
    graph, survivors: world.survivors, visibleZombies: [], shelters: world.shelters, blockedEdges: [],
    hordeDangerNodeIds: [], zombieTraversals: [] }, { kind: "confirmed", installed: { ...installed, gameId: world.gameId },
    attempts: [{ kind: "response", request, body: response, elapsedMs: 10 }] });
  assert.equal(decision.decisions.find(item => item.survivorId === survivor.id)!.decision, "mover");
});

test("una respuesta 401 pausa a todos sin convertir otras respuestas válidas en inválidas", () => {
  const world = worldFor(); world.zombies = [];
  const engine = new RouteEngine(graph);
  const installed = engine.sync(buildWorldSyncRequest(world, 1));
  const attempts: RouteAttempt[] = world.survivors.slice(0, 3).map((survivor, index) => {
    const request = { gameId: world.gameId, turnId: 1, worldVersion: 1, survivorId: survivor.id, currentNodeId: survivor.nodeId };
    return index === 0 ? { kind: "error", status: 401, error: "HTTP_ERROR", request, elapsedMs: 10 }
      : { kind: "response", request, body: engine.step(request), elapsedMs: 10 };
  });
  const decisions = resolveSurvivorDecisions({ gameId: world.gameId, turnId: 1, worldVersion: 1,
    graph, survivors: world.survivors, visibleZombies: [], shelters: world.shelters, blockedEdges: [],
    hordeDangerNodeIds: [], zombieTraversals: [] }, { kind: "confirmed", installed: { ...installed, gameId: world.gameId }, attempts });
  assert(decisions.decisions.every(decision => decision.decision === "esperar" && decision.cause === "authorization-failed"));
  assert.equal(decisions.pauseCause, "routing-unauthorized");
  const result = updateTurnMetrics(world, [], attempts, decisions, 10);
  assert.equal(result.metrics.routeAvailabilityPercent, 66.7);
  assert.equal(result.metrics.routeErrors, 1);
  assert.equal(result.metrics.invalidRouteResponses, 0);
});

test("el reloj espera el primer intervalo y programa 150 ticks entre 2.000 y 300.000 ms", async () => {
  let time = 0;
  const ticks: number[] = [];
  const engine = new RouteEngine(graph);
  const runtime = new SimulationRuntime({ graph, rounds, initialMetrics: roundId => createInitialTelemetryMetrics(rounds[roundId]),
    clock: { now: () => time, waitUntil: async (tick, signal) => { if (!signal.aborted) { ticks.push(tick); time = tick; } } },
    syncTimeoutMs: 500, emitAlert: () => {}, onFailure: () => assert.fail("El reloj no debe fallar"),
    clientFactory: () => ({ sync: async request => ({ status: 200, body: engine.sync(request) }),
      step: async request => ({ status: 200, body: engine.step(request) }),
      status: async gameId => ({ status: 200, body: engine.getStatus(gameId) }) }) });
  try {
    runtime.start({ gameId: "clock-round", roundId: 1, seed: "clock" });
    assert.equal(runtime.getCommittedWorld()!.turnId, 0);
    await runtime.whenStopped();
    assert.deepEqual(ticks, Array.from({ length: 150 }, (_, index) => (index + 1) * 2_000));
    assert.equal(time, 300_000);
    assert.equal(runtime.getCommittedWorld()!.status, "completed");
    assert.equal(runtime.getCommittedWorld()!.metrics.deadlineMisses, 0);
  } finally { await runtime.close(); }
});

test("un turno que supera el presupuesto publica deadlineMisses, eficiencia y pausa", async () => {
  let time = 0;
  let advanced = false;
  const engine = new RouteEngine(graph);
  const runtime = new SimulationRuntime({ graph, rounds, initialMetrics: roundId => createInitialTelemetryMetrics(rounds[roundId]),
    clock: { now: () => time, waitUntil: async tick => { time = tick; } }, syncTimeoutMs: 500,
    emitAlert: () => {}, onFailure: () => assert.fail("El exceso debe ser una pausa controlada"),
    clientFactory: () => ({ sync: async request => ({ status: 200, body: engine.sync(request) }),
      step: async request => { if (!advanced) { time += 2_001; advanced = true; } return { status: 200, body: engine.step(request) }; },
      status: async gameId => ({ status: 200, body: engine.getStatus(gameId) }) }) });
  try {
    runtime.start({ gameId: "deadline-round", roundId: 1, seed: "deadline" });
    await runtime.whenStopped();
    const world = runtime.getCommittedSnapshot()!;
    assert.equal(world.turnId, 1);
    assert.equal(world.status, "paused");
    assert.equal(world.metrics.deadlineMisses, 1);
    assert.equal(world.metrics.turnEfficiencyPercent, 0);
    assert(world.metrics.turnBudgetUsedPercent! > 100);
    assert.equal(world.metrics.routeTimeouts, 20);
    assert.equal(world.metrics.routeAvailabilityPercent, 0);
  } finally { await runtime.close(); }
});
