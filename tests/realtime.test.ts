import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import Fastify from "fastify";
import WebSocket from "ws";
import type { MantaGraph } from "../backend/src/contracts/types.ts";
import type { RoundConfig, TelemetryMetrics, TurnUpdate, WorldState } from "../backend/src/modules/simulator/types.ts";
import { createWorldState } from "../backend/src/modules/simulator/world-state.ts";
import { createWorldSnapshot } from "../backend/src/modules/simulator/world-snapshot.ts";
import { SimulationRuntime } from "../backend/src/modules/simulator/simulation-runtime.ts";
import type { SimulationClock } from "../backend/src/modules/simulator/simulation-clock.ts";
import type { RoutingClient } from "../backend/src/modules/simulator/routing-client.ts";
import { simulatorPlugin } from "../backend/src/modules/simulator/http-plugin.ts";
import { realtimePlugin } from "../backend/src/modules/realtime/http-plugin.ts";
import { MAX_MESSAGE_BYTES, RealtimeHub, type RealtimePeer } from "../backend/src/modules/realtime/realtime-hub.ts";
import { routingPlugin } from "../backend/src/modules/routing/http-server.ts";
import { RouteEngine } from "../backend/src/modules/routing/route-engine.ts";

const isoNow = () => "2026-10-27T00:00:00Z";
const start = { gameId: "realtime-fixture", roundId: 1 as const, seed: "private-seed" };
const apiKey = "fixture-realtime-key";
const publicMetricKeys = ["routeSamples", "routeLatencyP50Ms", "routeLatencyP95Ms", "routeLatencyP99Ms",
  "routeTimeouts", "invalidRouteResponses", "deadlineMisses", "activeSurvivors", "bittenSurvivors",
  "evacuatedSurvivors", "activeZombies", "wsClients", "snapshotQueueDepth", "lastSnapshotTurnId",
  "routeErrors", "routeAvailabilityPercent", "survivalRatePercent", "activeSurvivorsPercent",
  "bittenSurvivorsPercent", "evacuatedSurvivorsPercent", "turnDurationMs", "turnBudgetUsedPercent",
  "turnEfficiencyPercent"] as const;
class ManualClock implements SimulationClock {
  time = 0;
  private waiters = new Set<{ tick: number; finish: () => void }>();
  now() { return this.time; }
  waitUntil(tick: number, signal: AbortSignal) {
    if (signal.aborted || tick <= this.time) return Promise.resolve();
    return new Promise<void>(resolve => {
      const waiter = { tick, finish: () => { this.waiters.delete(waiter); signal.removeEventListener("abort", waiter.finish); resolve(); } };
      this.waiters.add(waiter); signal.addEventListener("abort", waiter.finish, { once: true });
    });
  }
  advance(tick: number) { this.time = tick; for (const waiter of [...this.waiters]) if (tick >= waiter.tick) waiter.finish(); }
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve };
}

// Fixtures de publicación; no son escenarios oficiales ni resultados de aceptación.
function fixture() {
  const graph: MantaGraph = { schemaVersion: "1.0.0", metadata: { ciudad: "Manta", graphVersion: "ws-fixture",
    generatedAt: isoNow(), source: "OpenStreetMap", osmAttribution: "fixture" },
    nodos: ["A", "B", "R", "Z"].map(id => ({ id, zona: "Tarqui", lat: 0, lng: 0 })),
    aristas: [["A", "B"], ["B", "A"], ["B", "R"], ["R", "B"]].map(([origen, destino]) => ({
      id: origen + destino, segmentoId: [origen, destino].sort().join(""), origen, destino,
      distancia_m: 1, tipo: "calle", factor_velocidad: 0.8,
    })), refugios: [{ id: "REF", nodoId: "R", capacidad: 2 }] };
  const config: RoundConfig = { roundId: 1, durationMs: 300_000, turnIntervalMs: 2_000, turnCount: 150,
    survivorCount: 20, survivorSpawns: Array.from({ length: 20 }, (_, i) => ({ id: `S-${i}`, nodeId: "A" })),
    zombieSpawns: [{ id: "Z", tipo: "caminante", nodeId: "Z" }], eventPlan: [] };
  const metrics: TelemetryMetrics = { routeSamples: 0, routeLatencyP50Ms: 0, routeLatencyP95Ms: 0, routeLatencyP99Ms: 0,
    routeTimeouts: 0, invalidRouteResponses: 0, deadlineMisses: 0, activeSurvivors: 20, bittenSurvivors: 0,
    evacuatedSurvivors: 0, activeZombies: 1, wsClients: 0, snapshotQueueDepth: 0, lastSnapshotTurnId: null };
  const engine = new RouteEngine(graph);
  const client: RoutingClient = { sync: async request => ({ status: 200, body: engine.sync(request) }),
    status: async id => ({ status: 200, body: engine.getStatus(id) }),
    step: async request => ({ status: 200, body: engine.step(request) }) };
  const clock = new ManualClock();
  const runtime = new SimulationRuntime({ graph, rounds: { 1: config }, initialMetrics: () => metrics, clientFactory: () => client,
    clock, isoNow, syncTimeoutMs: 500, emitAlert: () => {}, onFailure: () => {} });
  const initial = () => createWorldState({ gameId: start.gameId, graph, roundConfig: config, initialMetrics: metrics,
    randomState: { seed: start.seed, algorithm: "sha256-counter", algorithmVersion: "1", strategy: "per-zombie-turn-draw" }, updatedAt: isoNow() });
  return { graph, engine, client, clock, runtime, initial };
}
async function application() {
  const env = fixture(); const app = Fastify();
  app.register(routingPlugin, { engine: env.engine, apiKey });
  app.register(simulatorPlugin, { runtime: env.runtime, apiKey });
  app.register(realtimePlugin, { runtime: env.runtime, allowedOrigins: ["https://frontend.test"] });
  const url = await app.listen({ host: "127.0.0.1", port: 0 });
  return { ...env, app, url, wsUrl: url.replace("http://", "ws://") + "/ws" };
}
async function connect(url: string, origin?: string) {
  const socket = new WebSocket(url, origin ? { origin } : {});
  const messages: TurnUpdate[] = [];
  socket.on("message", data => { messages.push(JSON.parse(data.toString()) as TurnUpdate); });
  socket.on("error", () => {});
  await once(socket, "open");
  async function update(predicate: (update: TurnUpdate) => boolean, after = 0): Promise<TurnUpdate> {
    const known = messages.slice(after).find(predicate); if (known) return known;
    return new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); socket.off("message", listener); socket.off("close", closed); };
      const listener = () => { const found = messages.slice(after).find(predicate); if (found) { cleanup(); resolve(found); } };
      const closed = () => { cleanup(); reject(new Error("WS cerró antes del snapshot esperado")); };
      const timer = setTimeout(() => { cleanup(); reject(new Error("No llegó el snapshot esperado")); }, 3_000);
      socket.on("message", listener); socket.on("close", closed);
    });
  }
  return { socket, messages, update };
}
class Peer implements RealtimePeer {
  readyState = 1; bufferedAmount = 0; sent: string[] = []; pings = 0; terminated = false;
  send(data: string, callback: (error?: Error) => void) { this.sent.push(data); callback(); }
  ping() { this.pings++; }
  terminate() { this.terminated = true; this.readyState = 3; }
}
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

test("el ejemplo TURN_UPDATE del SPEC incluye las mismas 23 métricas públicas", async () => {
  const spec = await readFile(new URL("../SPEC.md", import.meta.url), "utf8");
  const examples = [...spec.matchAll(/```json\r?\n([\s\S]*?)```/g)].flatMap(match => {
    try { return [JSON.parse(match[1])]; } catch { return []; }
  });
  const update = examples.find(example => example.event === "TURN_UPDATE");
  assert(update, "El SPEC debe conservar un ejemplo JSON de TURN_UPDATE");
  assert.deepEqual(Object.keys(update.world.metrics).sort(), [...publicMetricKeys].sort());
});

test("proyección pública es cerrada, independiente e inmutable y no filtra datos internos", () => {
  const world = fixture().initial();
  Object.assign(world.survivors[0], { privateField: "do-not-leak" });
  Object.assign(world.metrics, { privateField: "do-not-leak" });
  const additionalMetrics = { routeErrors: 7, routeAvailabilityPercent: 91, survivalRatePercent: 85,
    activeSurvivorsPercent: 60, bittenSurvivorsPercent: 15, evacuatedSurvivorsPercent: 25,
    turnDurationMs: 100, turnBudgetUsedPercent: 5, turnEfficiencyPercent: 95 };
  Object.assign(world.metrics, additionalMetrics);
  const metricsBefore = structuredClone(world.metrics);
  const snapshot = createWorldSnapshot(world);
  assert.deepEqual(Object.keys(snapshot).sort(), ["schemaVersion", "gameId", "roundId", "status", "turnId", "worldVersion",
    "graphVersion", "updatedAt", "zombies", "survivors", "shelters", "blockedEdges", "cameras", "cameraObservations", "metrics"].sort());
  assert.equal(Object.keys(snapshot.metrics).length, 23);
  assert.deepEqual(Object.keys(snapshot.metrics).sort(), [...publicMetricKeys].sort());
  for (const key of publicMetricKeys) assert.equal(snapshot.metrics[key], metricsBefore[key]);
  assert.deepEqual(world.metrics, metricsBefore, "Proyectar no modifica métricas internas");
  for (const [key, value] of Object.entries(additionalMetrics)) assert.equal(snapshot.metrics[key as keyof typeof additionalMetrics], value);
  for (const field of ["privateField", "rngSeed", "randomState", "pendingCityEvents", "pause", "routing", "activeTurn", "graph"]) {
    assert(!JSON.stringify(snapshot).includes(`"${field}"`));
  }
  assert(!JSON.stringify(snapshot).includes(start.seed));
  world.survivors[0].nodeId = "B"; world.shelters[0].ocupantes.push("S-0");
  world.metrics.activeSurvivors = 3;
  assert.equal(snapshot.metrics.activeSurvivors, metricsBefore.activeSurvivors);
  assert.equal(snapshot.survivors[0].nodeId, "A"); assert.deepEqual(snapshot.shelters[0].ocupantes, []);
  assert(Object.isFrozen(snapshot)); assert(Object.isFrozen(snapshot.survivors[0]));
  assert(Object.isFrozen(snapshot.metrics));
  assert.throws(() => { (snapshot.metrics as TelemetryMetrics).activeSurvivors = 2; }, TypeError);
});

test("HTTP y WS publican las mismas 23 métricas, incluidas disponibilidad y eficiencia", async () => {
  const env = await application();
  try {
    const client = await connect(env.wsUrl);
    env.runtime.start(start);
    for (const turnId of [0, 1]) {
      const update = await client.update(update => update.world.turnId === turnId);
      const response = await env.app.inject({ method: "GET", url: "/estado" });
      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json(), update.world);
      assert.deepEqual(Object.keys(update.world.metrics).sort(), [...publicMetricKeys].sort());
      const internal = env.runtime.getCommittedWorld()!.metrics;
      for (const key of publicMetricKeys) assert.equal(update.world.metrics[key], internal[key]);
      assert(Object.hasOwn(internal, "turnDurationMs"));
      assert(Object.hasOwn(update.world.metrics, "turnDurationMs"));
      assert(Object.isFrozen(env.runtime.getCommittedSnapshot()!.metrics));
      if (turnId === 0) env.clock.advance(2_000);
    }
  } finally { await env.app.close(); }
});

test("antes de crear partida GET devuelve 503 no-store y WS conecta sin mundo inventado", async () => {
  const env = await application();
  try {
    const response = await env.app.inject({ method: "GET", url: "/estado" });
    assert.equal(response.statusCode, 503); assert.equal(response.json().error.code, "GAME_NOT_STARTED");
    assert.equal(response.headers["cache-control"], "no-store");
    const client = await connect(env.wsUrl); await flush();
    assert.deepEqual(client.messages, []);
    assert.equal((await env.app.inject({ method: "GET", url: "/ws" })).statusCode, 426);
  } finally { await env.app.close(); }
});

test("HTTP y WS muestran la misma copia comprometida y no las fases del turno activo", async () => {
  const env = await application(); const entered = deferred<void>(); const gate = deferred<void>(); const step = env.client.step;
  env.client.step = async (request, signal) => { entered.resolve(); await gate.promise; return step(request, signal); };
  try {
    const client = await connect(env.wsUrl);
    const created = await env.app.inject({ method: "POST", url: "/simulador/iniciar", headers: { "x-api-key": apiKey }, payload: start });
    assert.equal(created.statusCode, 202);
    await entered.promise;
    const zero = await client.update(update => update.world.turnId === 0);
    const during = await env.app.inject({ method: "GET", url: "/estado" });
    assert.deepEqual(during.json(), zero.world); assert.equal(during.json().worldVersion, 0);
    assert(during.json().survivors.every((s: { nodeId: string }) => s.nodeId === "A"));
    assert(!client.messages.some(update => update.world.turnId === 1));
    gate.resolve(); await flush(); env.clock.advance(2_000);
    const first = await client.update(update => update.world.turnId === 1);
    const after = await env.app.inject({ method: "GET", url: "/estado" });
    assert.deepEqual(after.json(), first.world); assert.equal(after.statusCode, 200);
    assert(first.world.survivors.every(s => s.nodeId === "B"));
    assert.deepEqual(Object.keys(first).sort(), ["event", "emittedAt", "world"].sort());
    assert(!after.body.includes(start.seed)); assert(!after.body.includes(apiKey));
  } finally { gate.resolve(); await env.app.close(); }
});

test("pausa al cerrar y reanudación notifican status con el mismo turno y versión", async () => {
  const env = await application(); const next = deferred<void>(); const entered = deferred<void>(); const sync = env.client.sync;
  env.client.sync = async (request, signal) => { if (request.turnId === 2) { entered.resolve(); await next.promise; } return sync(request, signal); };
  try {
    const client = await connect(env.wsUrl);
    env.runtime.start(start); await flush();
    assert.equal(env.runtime.pause("revisión").status, "pausing");
    env.clock.advance(2_000); await env.runtime.whenStopped();
    const paused = await client.update(update => update.world.turnId === 1 && update.world.status === "paused");
    assert.equal(paused.world.worldVersion, 1);
    assert.deepEqual((await env.app.inject({ method: "GET", url: "/estado" })).json(), paused.world);
    const afterPause = client.messages.length;
    env.runtime.start(start); await entered.promise;
    const resumed = await client.update(update => update.world.turnId === 1 && update.world.status === "running", afterPause);
    assert.equal(resumed.world.worldVersion, paused.world.worldVersion);
    assert.equal(env.runtime.getCommittedSnapshot()?.status, "running");
    assert.deepEqual((await env.app.inject({ method: "GET", url: "/estado" })).json(), resumed.world);
  } finally { next.resolve(); await env.app.close(); }
});

test("reconexión recibe el estado vigente y GET recupera un turno perdido", async () => {
  const env = await application();
  try {
    const first = await connect(env.wsUrl); env.runtime.start(start); await flush();
    env.clock.advance(2_000);
    await first.update(update => update.world.turnId === 1);
    const closed = once(first.socket, "close"); first.socket.close(); await closed;
    env.clock.advance(4_000); await flush();
    assert.equal(env.runtime.getCommittedSnapshot()?.turnId, 2);
    const recovered = (await env.app.inject({ method: "GET", url: "/estado" })).json();
    const second = await connect(env.wsUrl);
    const replay = await second.update(update => update.world.turnId === 2);
    assert.deepEqual(replay.world, recovered);
    assert.equal(replay.world.survivors.filter(s => s.estado === "evacuado").length, 2);
  } finally { await env.app.close(); }
});

test("CORS y upgrade aceptan solo el origen configurado; no requieren clave de controles", async () => {
  const env = await application();
  try {
    const denied = await env.app.inject({ method: "GET", url: "/estado", headers: { origin: "https://other.test" } });
    assert.equal(denied.statusCode, 403); assert.equal(denied.headers["access-control-allow-origin"], undefined);
    const allowed = await env.app.inject({ method: "GET", url: "/estado", headers: { origin: "https://frontend.test" } });
    assert.equal(allowed.statusCode, 503); assert.equal(allowed.headers["access-control-allow-origin"], "https://frontend.test");
    const options = await env.app.inject({ method: "OPTIONS", url: "/estado", headers: { origin: "https://frontend.test" } });
    assert.equal(options.statusCode, 204); assert.equal(options.headers["access-control-allow-methods"], "GET");
    await connect(env.wsUrl, "https://frontend.test");
    const rejected = new WebSocket(env.wsUrl, { origin: "https://other.test" });
    rejected.on("error", () => {});
    const response = await new Promise<number | undefined>(resolve => rejected.on("unexpected-response", (_request, reply) => {
      reply.resume(); resolve(reply.statusCode); rejected.terminate();
    }));
    assert.equal(response, 403);
    assert.equal((await env.app.inject({ method: "GET", url: "/health/live" })).statusCode, 200);
    assert.equal((await env.app.inject({ method: "POST", url: "/simulador/pausar", payload: { reason: "sin clave" } })).statusCode, 401);
  } finally { await env.app.close(); }
});

test("WS es de solo lectura y mensajes del cliente no ejecutan controles", async () => {
  const env = await application();
  try {
    const client = await connect(env.wsUrl); const closed = once(client.socket, "close");
    client.socket.send(JSON.stringify({ event: "iniciar", ...start }));
    const [code] = await closed; assert.equal(code, 1008); assert.equal(env.runtime.getCommittedWorld(), null);
  } finally { await env.app.close(); }
});

test("ws rechaza un mensaje entrante mayor de 1 MiB antes de tratarlo como comando", async () => {
  const env = await application();
  try {
    const client = await connect(env.wsUrl); const closed = once(client.socket, "close");
    client.socket.send(Buffer.alloc(MAX_MESSAGE_BYTES + 1));
    const [code] = await closed; assert([1006, 1009].includes(code as number));
    assert.equal(env.runtime.getCommittedWorld(), null);
  } finally { await env.app.close(); }
});

test("cliente lento se desconecta sin bloquear ni perjudicar a otro cliente", async () => {
  const hub = new RealtimeHub(isoNow); const world = fixture().initial(); hub.publish(createWorldSnapshot(world));
  const healthy = new Peer(); const slow = new Peer(); hub.add(healthy); hub.add(slow);
  slow.bufferedAmount = MAX_MESSAGE_BYTES;
  world.turnId = 1; world.worldVersion = 1; hub.publish(createWorldSnapshot(world));
  assert.equal(healthy.sent.length, 1); // Broadcast diferido, no I/O durante el commit.
  await flush(); assert(slow.terminated); assert(!healthy.terminated); assert.equal(healthy.sent.length, 2);
  assert.equal(JSON.parse(healthy.sent[1]).world.turnId, 1); assert.equal(hub.clientCount, 1); hub.close();
});

test("heartbeat conserva clientes con pong y elimina conexiones que dejan de responder", () => {
  const hub = new RealtimeHub(); const live = new Peer(); const dead = new Peer(); hub.add(live); hub.add(dead);
  hub.heartbeat(); assert.equal(live.pings, 1); assert.equal(dead.pings, 1);
  hub.pong(live); hub.heartbeat(); assert(dead.terminated); assert(!live.terminated); assert.equal(live.pings, 2);
  hub.pong(live); hub.heartbeat(); assert(!live.terminated); hub.close(); assert(live.terminated);
});

test("límite de 1 MiB usa bytes UTF-8 y nunca envía un snapshot incompleto", async () => {
  const hub = new RealtimeHub(); const peer = new Peer(); hub.add(peer); const world = fixture().initial();
  world.blockedEdges = [{ segmentoId: "AB", edgeIds: ["AB", "BA"], motivo: "é".repeat(600_000),
    origen: "control", bloqueadaDesdeTurno: 1, desbloqueadaEnTurno: null }];
  hub.publish(createWorldSnapshot(world)); await flush(); assert(peer.terminated); assert.deepEqual(peer.sent, []); hub.close();
});

test("un cliente que conecta con publicaciones pendientes no recibe turnos anteriores ni estados viejos", async () => {
  const hub = new RealtimeHub(isoNow); const old = new Peer(); hub.add(old); const world = fixture().initial();
  world.turnId = 1; world.worldVersion = 1; world.status = "running"; hub.publish(createWorldSnapshot(world));
  world.status = "paused"; hub.publish(createWorldSnapshot(world));
  const late = new Peer(); hub.add(late); await flush();
  assert.equal(late.sent.length, 1); assert.equal(JSON.parse(late.sent[0]).world.status, "paused");
  assert.equal(old.sent.length, 2); assert.equal(JSON.parse(old.sent[0]).world.status, "running"); hub.close();
});

test("saturación de publicaciones mantiene memoria acotada y permite recuperar el último estado", async () => {
  const hub = new RealtimeHub(); const peer = new Peer(); hub.add(peer); const world = fixture().initial();
  for (let turnId = 1; turnId <= 9; turnId++) { world.turnId = turnId; world.worldVersion = turnId; hub.publish(createWorldSnapshot(world)); }
  assert(peer.terminated); await flush(); const recovered = new Peer(); hub.add(recovered);
  assert.equal(JSON.parse(recovered.sent[0]).world.turnId, 9); hub.close();
});

test("excepción de un observador no detiene la partida ni revierte el snapshot comprometido", async () => {
  const env = fixture(); let seen = 0;
  const committed = deferred<void>();
  const unsubscribe = env.runtime.subscribeCommitted(() => { throw new Error("observer failure"); });
  env.runtime.subscribeCommitted(snapshot => { seen++; if (snapshot.turnId === 1) committed.resolve(); });
  env.runtime.start(start); await flush(); env.clock.advance(2_000); await committed.promise;
  assert.equal(env.runtime.getCommittedSnapshot()?.turnId, 1); assert.equal(seen, 2); unsubscribe();
  env.runtime.pause("done"); await env.runtime.close(); assert.equal(seen, 3);
});

test("cerrar Fastify termina conexiones WS abiertas y cancela su heartbeat", async () => {
  const env = await application(); const client = await connect(env.wsUrl); const closed = once(client.socket, "close");
  await env.app.close(); await closed; assert.equal(client.socket.readyState, WebSocket.CLOSED);
});
