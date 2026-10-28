import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";
import type { MantaGraph } from "../backend/src/contracts/types.ts";
import type { SyncResponse } from "../backend/src/contracts/routing.ts";
import type { RoundConfig, TelemetryMetrics } from "../backend/src/modules/simulator/types.ts";
import type { SimulationClock } from "../backend/src/modules/simulator/simulation-clock.ts";
import { createSimulationClock } from "../backend/src/modules/simulator/simulation-clock.ts";
import { SimulationRuntime } from "../backend/src/modules/simulator/simulation-runtime.ts";
import { simulatorPlugin } from "../backend/src/modules/simulator/http-plugin.ts";
import { TurnCoordinator } from "../backend/src/modules/simulator/turn-coordinator.ts";
import { createWorldState } from "../backend/src/modules/simulator/world-state.ts";
import { parseEdgeCommand, parsePauseCommand, parseStartCommand, SimulatorControlError } from "../backend/src/modules/simulator/controls.ts";
import type { RoutingClient, RoutingHttpResponse } from "../backend/src/modules/simulator/routing-client.ts";
import { routingPlugin } from "../backend/src/modules/routing/http-server.ts";
import { RouteEngine } from "../backend/src/modules/routing/route-engine.ts";

class AutoClock implements SimulationClock {
  time = 0;
  ticks: number[] = [];
  now() { return this.time; }
  async waitUntil(tick: number, signal: AbortSignal) { if (!signal.aborted) { this.ticks.push(tick); this.time = Math.max(this.time, tick); } }
}
class ManualClock implements SimulationClock {
  time = 0;
  waiters = new Set<{ tick: number; finish: () => void }>();
  now() { return this.time; }
  waitUntil(tick: number, signal: AbortSignal) {
    if (signal.aborted || this.time >= tick) return Promise.resolve();
    return new Promise<void>(resolve => {
      const waiter = { tick, finish: () => { this.waiters.delete(waiter); signal.removeEventListener("abort", waiter.finish); resolve(); } };
      this.waiters.add(waiter); signal.addEventListener("abort", waiter.finish, { once: true });
    });
  }
  advance(time: number) { this.time = time; for (const waiter of [...this.waiters]) if (time >= waiter.tick) waiter.finish(); }
}
const start = { gameId: "clock-fixture", roundId: 1 as const, seed: "unit-seed" };
const isoNow = () => "2026-10-27T00:00:00Z";
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve };
}

// Fixture mínima de pruebas; no es una configuración oficial ni una medición de aceptación.
function fixture(clock: SimulationClock = new AutoClock(), commitJitterToleranceMs = 10) {
  const graph: MantaGraph = { schemaVersion: "1.0.0", metadata: { ciudad: "Manta", graphVersion: "clock-fixture-v1",
    generatedAt: isoNow(), source: "OpenStreetMap", osmAttribution: "fixture" },
    nodos: ["A", "B", "R", "Z"].map(id => ({ id, lat: 0, lng: 0, zona: "Tarqui" })),
    aristas: [["A", "B"], ["B", "A"], ["B", "R"], ["R", "B"]].map(([origen, destino]) => ({
      id: origen + destino, segmentoId: [origen, destino].sort().join(""), origen, destino,
      tipo: "calle", factor_velocidad: 0.8, distancia_m: 1,
    })), refugios: [{ id: "REF", nodoId: "R", capacidad: 20 }] };
  const config: RoundConfig = { roundId: 1, durationMs: 300_000, turnIntervalMs: 2_000, turnCount: 150,
    survivorCount: 20, survivorSpawns: Array.from({ length: 20 }, (_, i) => ({ id: `S-${i}`, nodeId: "A" })),
    zombieSpawns: [{ id: "Z", tipo: "caminante", nodeId: "Z" }], eventPlan: [] };
  const metrics: TelemetryMetrics = { routeSamples: 0, routeLatencyP50Ms: 0, routeLatencyP95Ms: 0, routeLatencyP99Ms: 0,
    routeTimeouts: 0, invalidRouteResponses: 0, deadlineMisses: 0, activeSurvivors: 20, bittenSurvivors: 0,
    evacuatedSurvivors: 0, activeZombies: 1, wsClients: 0, snapshotQueueDepth: 0, lastSnapshotTurnId: null };
  let installed: SyncResponse | null = null;
  const syncs: number[] = [];
  const client: RoutingClient = {
    sync: async request => {
      syncs.push(request.turnId);
      installed = { turnId: request.turnId, worldVersion: request.baseWorldVersion + 1, graphVersion: graph.metadata.graphVersion,
        ready: true, workerCount: 1, buildLatencyMs: 0 };
      return { status: 200, body: installed };
    }, status: async gameId => ({ status: 200, body: { gameId, installed } }),
    step: async request => ({ status: 200, body: { gameId: request.gameId, turnId: request.turnId,
      worldVersion: request.worldVersion, survivorId: request.survivorId, fromNodeId: request.currentNodeId,
      toNodeId: request.currentNodeId, edgeId: null, targetShelterId: null, decision: "esperar", reason: "sin-ruta-segura",
      routeCost: null, latencyMs: 0 } }),
  };
  const failures: unknown[] = [];
  const options = { graph, rounds: { 1: config }, initialMetrics: () => metrics, clientFactory: () => client,
    syncTimeoutMs: 500, emitAlert: () => {}, onFailure: (event: unknown) => { failures.push(event); }, clock, isoNow, commitJitterToleranceMs };
  const runtime = new SimulationRuntime(options);
  const initial = () => createWorldState({ gameId: start.gameId, graph, roundConfig: config,
    initialMetrics: metrics, randomState: { seed: start.seed, algorithm: "sha256-counter", algorithmVersion: "1", strategy: "per-zombie-turn-draw" }, updatedAt: isoNow() });
  return { graph, config, metrics, client, options, runtime, syncs, failures, initial };
}
function expectStatus(run: () => unknown, status: number) {
  assert.throws(run, error => error instanceof SimulatorControlError && error.status === status);
}

test("reloj simulado calcula desde T0 y publica 150 turnos en fronteras 2000..300000", async () => {
  const clock = new AutoClock(); const env = fixture(clock);
  assert.deepEqual(env.runtime.start(start), { gameId: start.gameId, roundId: 1, status: "running", nextTurnId: 1 });
  await env.runtime.whenStopped();
  assert.equal(env.syncs.length, 150); assert.deepEqual(env.syncs, Array.from({ length: 150 }, (_, i) => i + 1));
  assert.deepEqual(clock.ticks, Array.from({ length: 150 }, (_, i) => (i + 1) * 2_000));
  assert.equal(clock.time, 300_000);
  assert.equal(env.runtime.getCommittedWorld()?.status, "completed");
  assert.equal(env.runtime.getCommittedWorld()?.turnId, 150); assert.equal(env.runtime.getCommittedWorld()?.worldVersion, 150);
  assert.equal(env.runtime.getCommittedWorld()?.metrics.deadlineMisses, 0); assert.deepEqual(env.failures, []);
  expectStatus(() => env.runtime.start(start), 409);
  await env.runtime.close();
});

test("tiempo de cálculo no acumula deriva en los ticks siguientes", async () => {
  const clock = new AutoClock(); const env = fixture(clock); const step = env.client.step;
  let lastTurn = 0;
  env.client.step = async (request, signal) => {
    if (request.turnId !== lastTurn) { clock.time += 100; lastTurn = request.turnId; }
    return step(request, signal);
  };
  const commits: number[] = [];
  env.runtime.subscribeCommitted(world => { if (world.turnId > 0) commits.push(clock.time); });
  env.runtime.start(start); await env.runtime.whenStopped();
  assert.deepEqual(clock.ticks.slice(0, 4), [2_000, 4_000, 6_000, 8_000]);
  assert.equal(clock.ticks.at(-1), 300_000); assert.equal(clock.time, 300_000);
  assert.deepEqual(commits, Array.from({ length: 150 }, (_, i) => (i + 1) * 2_000));
  assert.equal(env.runtime.getCommittedWorld()?.metrics.turnDurationMs, 100);
  assert.equal(env.runtime.getCommittedWorld()?.metrics.turnBudgetUsedPercent, 5);
  assert.equal(env.runtime.getCommittedWorld()?.metrics.deadlineMisses, 0);
});

for (const finalCost of [1_900, 2_001]) test(`turno 150 con ${finalCost} ms de trabajo conserva frontera y métricas`, async () => {
  const clock = new AutoClock(); const env = fixture(clock); const sync = env.client.sync;
  const starts: number[] = [], commits: number[] = [];
  env.client.sync = async (request, signal) => {
    starts.push(clock.time); clock.time += request.turnId === 150 ? finalCost : 100;
    return sync(request, signal);
  };
  env.runtime.subscribeCommitted(world => { if (world.turnId > 0) commits.push(clock.time); });
  env.runtime.start(start); await env.runtime.whenStopped();
  const world = env.runtime.getCommittedWorld()!;
  assert.deepEqual(starts, Array.from({ length: 150 }, (_, i) => i * 2_000));
  assert.equal(world.turnId, 150); assert.equal(world.worldVersion, 150); assert.equal(world.status, "completed");
  assert.equal(commits.length, 150); assert.equal(commits[149], Math.max(300_000, 298_000 + finalCost));
  assert.equal(world.metrics.turnDurationMs, finalCost);
  assert.equal(world.metrics.deadlineMisses, finalCost > 2_000 ? 1 : 0);
  assert.equal(world.metrics.turnEfficiencyPercent, finalCost > 2_000 ? 99.3 : 100);
  assert.deepEqual(env.failures, []);
});

for (const delayedTurn of [1, 150]) test(`despertar fuera de tolerancia para publicar turno ${delayedTurn} registra incumplimiento sin inflar trabajo`, async () => {
  const clock = new AutoClock(); const env = fixture(clock); const sync = env.client.sync;
  env.client.sync = async (request, signal) => { clock.time += 100; return sync(request, signal); };
  const wait = clock.waitUntil.bind(clock);
  clock.waitUntil = async (tick, signal) => { await wait(tick, signal); if (tick === delayedTurn * 2_000) clock.time += 11; };
  env.runtime.start(start); await env.runtime.whenStopped();
  const world = env.runtime.getCommittedWorld()!;
  assert.equal(world.turnId, delayedTurn); assert.equal(world.metrics.deadlineMisses, 1);
  assert.equal(world.status, delayedTurn === 150 ? "completed" : "paused");
  assert.equal(world.metrics.turnDurationMs, 100); assert.equal(world.metrics.turnBudgetUsedPercent, 5);
  assert.equal(world.metrics.turnEfficiencyPercent, delayedTurn === 150 ? 99.3 : 0);
  assert.equal(clock.time, delayedTurn * 2_000 + 11);
  assert.equal(env.runtime.getLastTurnTiming()!.timerWakeDelayMs, 11);
  assert.equal(env.runtime.getLastTurnTiming()!.commitDelayMs, 11);
  assert.equal(env.runtime.getLastTurnTiming()!.commitJitterToleranceMs, 10);
});

for (const jitter of [0, 5, 10]) test(`jitter de ${jitter} ms queda registrado sin ampliar ventanas ni contar como trabajo`, async () => {
  const clock = new AutoClock(); const env = fixture(clock); const sync = env.client.sync;
  const starts: number[] = [];
  env.client.sync = async (request, signal) => { starts.push(clock.time); clock.time += 100; return sync(request, signal); };
  const wait = clock.waitUntil.bind(clock);
  clock.waitUntil = async (tick, signal) => { await wait(tick, signal); if (tick === 300_000) clock.time += jitter; };
  env.runtime.start(start); await env.runtime.whenStopped();
  const world = env.runtime.getCommittedSnapshot()!;
  assert.equal(world.status, "completed"); assert.equal(world.metrics.deadlineMisses, 0);
  assert.equal(world.metrics.turnDurationMs, 100); assert.equal(world.metrics.turnEfficiencyPercent, 100);
  assert.deepEqual(starts, Array.from({ length: 150 }, (_, i) => i * 2_000));
  const timing = env.runtime.getLastTurnTiming()!;
  assert(Object.isFrozen(timing)); assert.equal(timing.commitDelayMs, jitter); assert.equal(timing.deadlineMiss, false);
  assert.equal(timing.commitReadyAtMonotonicMs, 300_000 + jitter);
  assert.equal(timing.committedAtMonotonicMs, 300_000 + jitter);
  assert(!JSON.stringify(world).includes("commitDelayMs"));
});

test("el jitter de cierre no acumula deriva a lo largo de 150 ventanas", async () => {
  const clock = new AutoClock(); const env = fixture(clock); const wait = clock.waitUntil.bind(clock);
  const starts: number[] = []; const sync = env.client.sync;
  clock.waitUntil = async (tick, signal) => { await wait(tick, signal); clock.time += 5; };
  env.client.sync = async (request, signal) => { starts.push(clock.time); clock.time += 100; return sync(request, signal); };
  env.runtime.start(start); await env.runtime.whenStopped();
  assert.deepEqual(clock.ticks, Array.from({ length: 150 }, (_, i) => (i + 1) * 2_000));
  assert.equal(starts[0], 0); assert.equal(starts[149], 298_005); assert.equal(clock.time, 300_005);
  assert.equal(env.runtime.getCommittedWorld()!.metrics.deadlineMisses, 0);
});

test("tolerancia cero conserva el criterio estricto para cierre tardío", async () => {
  const clock = new AutoClock(); const env = fixture(clock, 0); const wait = clock.waitUntil.bind(clock);
  clock.waitUntil = async (tick, signal) => { await wait(tick, signal); clock.time++; };
  env.runtime.start(start); await env.runtime.whenStopped();
  assert.equal(env.runtime.getCommittedWorld()!.metrics.deadlineMisses, 1);
  assert.equal(env.runtime.getLastTurnTiming()!.commitJitterToleranceMs, 0);
});

test("la preparación final se mide antes del cierre, y los observadores después", async () => {
  for (const preparationCost of [0, 11]) {
    const clock = new AutoClock(); const env = fixture(clock); const state = env.initial(); state.status = "running";
    const coordinator = new TurnCoordinator(state, { client: env.client, syncTimeoutMs: 500,
      now: () => clock.now(), isoNow: () => { clock.time += preparationCost; return isoNow(); }, emitAlert: () => {},
      onCommitted: () => { clock.time += 100; } });
    const result = await coordinator.runTurn(2_000, async () => { clock.time = 2_000; });
    const timing = coordinator.getLastTurnTiming()!;
    assert.equal(timing.timerWakeDelayMs, 0); assert.equal(timing.commitDelayMs, preparationCost);
    assert.equal(result.world.metrics.turnDurationMs, preparationCost);
    assert.equal(result.world.metrics.deadlineMisses, preparationCost > 10 ? 1 : 0);
    assert.equal(timing.committedAtMonotonicMs, 2_000 + preparationCost);
    assert.equal(clock.time, timing.committedAtMonotonicMs + 100, "El observador no altera el cierre medido");
  }
});

test("rechaza tolerancias de cierre inválidas", () => {
  const env = fixture();
  for (const tolerance of [-1, NaN, Infinity, 2_000]) assert.throws(() => new TurnCoordinator(env.initial(), {
    client: env.client, syncTimeoutMs: 500, isoNow, emitAlert: () => {}, commitJitterToleranceMs: tolerance,
  }), /tolerancia de cierre/);
});

test("trabajo de 100 ms queda privado hasta los 2000 ms sin inflar su duración", async () => {
  const clock = new ManualClock(); const env = fixture(clock); const sync = env.client.sync;
  env.client.sync = async (request, signal) => { clock.time += 100; return sync(request, signal); };
  env.runtime.start(start); await new Promise(done => setImmediate(done));
  assert.equal(clock.time, 100); assert.equal(env.runtime.getCommittedSnapshot()!.turnId, 0);
  assert.deepEqual(env.syncs, [1]);
  clock.advance(1_999); await new Promise(done => setImmediate(done));
  assert.equal(env.runtime.getCommittedSnapshot()!.turnId, 0);
  env.runtime.pause("detener tras la primera publicación"); clock.advance(2_000); await env.runtime.whenStopped();
  const world = env.runtime.getCommittedSnapshot()!;
  assert.equal(world.turnId, 1); assert.equal(world.status, "paused");
  assert.equal(world.metrics.turnDurationMs, 100); assert.equal(world.metrics.turnBudgetUsedPercent, 5);
  assert.equal(world.metrics.deadlineMisses, 0);
  await env.runtime.close();
});

test("deadline exacto o excedido compromete el turno y pausa antes del siguiente", async () => {
  for (const elapsed of [2_000, 2_001]) {
    const clock = new AutoClock(); const env = fixture(clock); const step = env.client.step;
    env.client.step = async (request, signal) => { clock.time = elapsed; return step(request, signal); };
    env.runtime.start(start); await env.runtime.whenStopped();
    const world = env.runtime.getCommittedWorld()!;
    assert.equal(world.turnId, 1); assert.equal(world.worldVersion, 1); assert.equal(world.status, "paused");
    assert.equal(world.metrics.deadlineMisses, 1); assert.equal(world.pause.status !== "none" && world.pause.cause, "deadline-miss");
    assert.deepEqual(env.syncs, [1]); assert.equal(world.activeTurn, null);
  }
});

test("el turno 150 termina completed aun con pausa solicitada y deadline miss", async () => {
  const clock = new AutoClock(); const env = fixture(clock); const state = env.initial(); state.status = "running"; state.turnId = 149;
  const step = env.client.step;
  env.client.step = async (request, signal) => { clock.time = 2_000; turn.requestPause("último turno"); return step(request, signal); };
  const turn = new TurnCoordinator(state, { client: env.client, syncTimeoutMs: 500, now: () => clock.now(), isoNow, emitAlert: () => {} });
  const result = await turn.runTurn(2_000);
  assert.equal(result.world.status, "completed"); assert.equal(result.world.turnId, 150);
  assert.equal(result.world.metrics.deadlineMisses, 1);
  await assert.rejects(turn.runTurn(), /no admite/);
});

test("pausa activa cierra el turno y reanuda con misma identidad y semilla sin reiniciar entidades", async () => {
  const env = fixture(); const entered = deferred<void>(); const gate = deferred<RoutingHttpResponse>();
  const sync = env.client.sync;
  env.client.sync = async (request, signal) => { entered.resolve(); await gate.promise; return sync(request, signal); };
  env.runtime.start(start); await entered.promise;
  assert.deepEqual(env.runtime.pause("revisión"), { status: "pausing", afterTurnId: 1 });
  assert.equal(env.runtime.getCommittedWorld()?.turnId, 0);
  expectStatus(() => env.runtime.start(start), 409);
  gate.resolve({ status: 200, body: null }); await env.runtime.whenStopped();
  assert.equal(env.runtime.getCommittedWorld()?.status, "paused"); assert.equal(env.runtime.getCommittedWorld()?.turnId, 1);
  for (const changes of [{ gameId: "other" }, { roundId: 3 as const }, { seed: "other" }]) expectStatus(() => env.runtime.start({ ...start, ...changes }), 409);
  const prior = env.runtime.getCommittedWorld()!;
  const step = env.client.step;
  env.client.step = async (request, signal) => { env.runtime.pause("segunda revisión"); return step(request, signal); };
  assert.equal(env.runtime.start(start).nextTurnId, 2); await env.runtime.whenStopped();
  const after = env.runtime.getCommittedWorld()!;
  assert.equal(after.turnId, 2); assert.equal(after.worldVersion, 2); assert.equal(after.rngSeed, prior.rngSeed);
  assert.deepEqual(after.survivors, prior.survivors); assert.deepEqual(env.syncs, [1, 2]);
});

test("pausar durante espera cierra en frontera y reanuda sin recuperar ventanas antiguas", async () => {
  const clock = new ManualClock(); const env = fixture(clock);
  env.runtime.start(start); await new Promise(done => setImmediate(done));
  assert.equal(env.runtime.getCommittedWorld()?.turnId, 0); assert.equal(clock.waiters.size, 1);
  const event = env.runtime.scheduleEdge({ eventId: "waiting-close", edgeId: "AB", bloqueada: true, motivo: "fixture" });
  assert.equal(event.effectiveTurnId, 2);
  assert.deepEqual(env.runtime.pause("entre cálculo y publicación"), { status: "pausing", afterTurnId: 1 });
  clock.advance(2_000); await env.runtime.whenStopped();
  assert.equal(env.runtime.getCommittedWorld()?.turnId, 1);
  assert.equal(env.runtime.getCommittedWorld()?.pendingCityEvents[0].aplicado, false);
  clock.advance(100_000); assert.equal(clock.waiters.size, 0);
  assert.equal(env.runtime.start(start).nextTurnId, 2);
  await new Promise(done => setImmediate(done));
  env.runtime.pause("segunda ventana"); clock.advance(102_000); await env.runtime.whenStopped();
  assert.equal(env.runtime.getCommittedWorld()?.turnId, 2); assert.deepEqual(env.syncs, [1, 2]);
  assert.equal(env.runtime.getCommittedWorld()?.pendingCityEvents[0].aplicado, true);
  assert.deepEqual(env.runtime.getCommittedWorld()?.blockedEdges[0].edgeIds, ["AB", "BA"]);
  assert.equal(env.runtime.getCommittedWorld()?.metrics.deadlineMisses, 0);
  await env.runtime.close(); expectStatus(() => env.runtime.start(start), 503);
});

test("cierres en vuelo empiezan en el siguiente turno; se conservan hasta aplicar ambos sentidos", async () => {
  const env = fixture(); const entered = deferred<void>(); const gate = deferred<void>(); const sync = env.client.sync;
  env.client.sync = async (request, signal) => { if (request.turnId === 1) { entered.resolve(); await gate.promise; } return sync(request, signal); };
  env.runtime.start(start); await entered.promise;
  const command = { eventId: "control-1", edgeId: "AB", bloqueada: true, motivo: "fixture" };
  const accepted = env.runtime.scheduleEdge(command);
  assert.equal(accepted.effectiveTurnId, 2); assert.equal(accepted.segmentoId, "AB");
  assert.deepEqual(env.runtime.scheduleEdge(command), accepted);
  expectStatus(() => env.runtime.scheduleEdge({ ...command, motivo: "otro" }), 409);
  expectStatus(() => env.runtime.scheduleEdge({ ...command, eventId: "old", effectiveTurnId: 1 }), 400);
  expectStatus(() => env.runtime.scheduleEdge({ ...command, eventId: "same-segment", edgeId: "BA" }), 409);
  env.runtime.pause("inspeccionar"); gate.resolve(); await env.runtime.whenStopped();
  assert.equal(env.runtime.getCommittedWorld()?.pendingCityEvents[0].aplicado, false);
  const step = env.client.step;
  env.client.step = async (request, signal) => { env.runtime.pause("revisar cierre"); return step(request, signal); };
  env.runtime.start(start); await env.runtime.whenStopped();
  assert.deepEqual(env.runtime.getCommittedWorld()?.blockedEdges[0].edgeIds, ["AB", "BA"]);
  assert.equal(env.runtime.getCommittedWorld()?.pendingCityEvents[0].aplicado, true);
  assert.deepEqual(env.runtime.scheduleEdge(command), accepted); // Replay tras avanzar: no reprograma el evento.
  expectStatus(() => env.runtime.scheduleEdge({ eventId: "missing", edgeId: "unknown", bloqueada: true, motivo: "fixture", effectiveTurnId: 3 }), 404);
  expectStatus(() => env.runtime.scheduleEdge({ eventId: "implicit-paused", edgeId: "BR", bloqueada: true, motivo: "fixture" }), 400);
  assert.equal(env.runtime.scheduleEdge({ eventId: "open", edgeId: "AB", bloqueada: false, motivo: "fixture", effectiveTurnId: 3 }).effectiveTurnId, 3);
});

test("sin roster completo o métricas iniciales no se crea una partida ni se envía sync", () => {
  const env = fixture();
  const empty = new SimulationRuntime({ ...env.options, rounds: undefined });
  expectStatus(() => empty.start(start), 503); assert.equal(empty.getCommittedWorld(), null);
  const noMetrics = new SimulationRuntime({ ...env.options, initialMetrics: undefined });
  expectStatus(() => noMetrics.start(start), 503);
  env.config.survivorSpawns = [];
  expectStatus(() => env.runtime.start(start), 503); assert.equal(env.runtime.getCommittedWorld(), null);
  assert.deepEqual(env.syncs, []);
});

test("una partida completed exige otro gameId; una nueva empieza en turno 1 sin reutilizar estado", async () => {
  const env = fixture(); env.runtime.start(start); await env.runtime.whenStopped();
  const old = env.runtime.getCommittedWorld()!;
  expectStatus(() => env.runtime.start({ ...start, seed: "new" }), 409);
  assert.equal(env.runtime.start({ ...start, gameId: "second" }).nextTurnId, 1);
  env.runtime.pause("antes del primer turno"); await env.runtime.whenStopped();
  const fresh = env.runtime.getCommittedWorld()!;
  assert.equal(fresh.gameId, "second"); assert.equal(fresh.turnId, 0); assert.equal(fresh.worldVersion, 0);
  assert.equal(old.turnId, 150); assert.deepEqual(fresh.routing, { confirmed: null, uncertain: false, attemptedRequest: null });
});

test("controles rechazan esquemas extra, identidad inválida y turnos fuera de rango", () => {
  for (const value of [null, {}, [], { ...start, extra: true }, { ...start, roundId: 4 }, { ...start, seed: "" }]) assert.throws(() => parseStartCommand(value));
  assert.throws(() => parsePauseCommand({ reason: "" })); assert.throws(() => parsePauseCommand({ reason: "ok", extra: 1 }));
  for (const changes of [{ bloqueada: "true" }, { effectiveTurnId: 0 }, { effectiveTurnId: 151 }, { effectiveTurnId: null }, { extra: true }]) {
    assert.throws(() => parseEdgeCommand({ eventId: "E", edgeId: "AB", bloqueada: true, motivo: "fixture", ...changes }));
  }
});

test("Fastify compartido exige clave en controles y mantiene health de routing accesible", async () => {
  const clock = new ManualClock(); const env = fixture(clock); const app = Fastify(); const apiKey = "fixture-control-key";
  app.register(routingPlugin, { engine: new RouteEngine(env.graph), apiKey });
  app.register(simulatorPlugin, { runtime: env.runtime, apiKey });
  try {
    assert.equal((await app.inject({ method: "GET", url: "/health/live" })).statusCode, 200);
    for (const url of ["/simulador/iniciar", "/simulador/pausar", "/simulador/bloquear-arista"]) {
      const response = await app.inject({ method: "POST", url, payload: start }); assert.equal(response.statusCode, 401);
      assert(!response.body.includes(apiKey));
    }
    const headers = { "x-api-key": apiKey };
    assert.equal((await app.inject({ method: "POST", url: "/simulador/iniciar", headers, payload: { ...start, extra: true } })).statusCode, 400);
    const created = await app.inject({ method: "POST", url: "/simulador/iniciar", headers, payload: start });
    assert.equal(created.statusCode, 202); assert.equal(created.json().nextTurnId, 1); assert(!created.body.includes(start.seed));
    assert.equal((await app.inject({ method: "POST", url: "/simulador/iniciar", headers, payload: start })).statusCode, 409);
    assert.equal((await app.inject({ method: "POST", url: "/simulador/pausar", headers, payload: { reason: "inspección" } })).statusCode, 202);
    await new Promise(done => setImmediate(done)); clock.advance(2_000);
    await env.runtime.whenStopped();
    const closure = await app.inject({ method: "POST", url: "/simulador/bloquear-arista", headers,
      payload: { eventId: "close", edgeId: "AB", bloqueada: true, motivo: "fixture", effectiveTurnId: 2 } });
    assert.equal(closure.statusCode, 202); assert.equal(closure.json().segmentoId, "AB");
  } finally { await app.close(); }
});

test("HTTP no permite iniciar la configuración geográfica como si fuera un roster", async () => {
  const env = fixture(); const app = Fastify();
  app.register(simulatorPlugin, { runtime: new SimulationRuntime({ ...env.options, rounds: {} }), apiKey: "fixture-control-key" });
  try {
    const response = await app.inject({ method: "POST", url: "/simulador/iniciar", headers: { "x-api-key": "fixture-control-key" }, payload: start });
    assert.equal(response.statusCode, 503); assert.equal(response.json().error.code, "ROUND_NOT_CONFIGURED");
  } finally { await app.close(); }
});

test("un fallo interno detiene el reloj, conserva el último commit y emite solo un código seguro", async () => {
  const env = fixture(); env.options.clock = { now: () => 0, waitUntil: async () => { throw new Error("secret"); } };
  const runtime = new SimulationRuntime(env.options); runtime.start(start); await runtime.whenStopped();
  assert.equal(runtime.getCommittedWorld()?.turnId, 0); assert.equal(runtime.getCommittedWorld()?.status, "paused");
  assert.deepEqual(env.failures, [{ code: "SIMULATOR_TURN_FAILED", gameId: start.gameId, turnId: 1 }]);
  assert(!JSON.stringify(env.failures).includes("secret"));
});

test("el reloj real cancela su espera al pausar sin esperar al próximo tick", async () => {
  const clock = createSimulationClock(); const controller = new AbortController();
  const wait = clock.waitUntil(clock.now() + 60_000, controller.signal);
  controller.abort(); await wait;
  await assert.rejects(clock.waitUntil(Infinity, new AbortController().signal), /inválido/);
});
