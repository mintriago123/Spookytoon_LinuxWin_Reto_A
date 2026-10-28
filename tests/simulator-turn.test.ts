import assert from "node:assert/strict";
import { test } from "node:test";
import type { MantaGraph } from "../backend/src/contracts/types.ts";
import { RoutingError, type PasoRequest, type PasoResponse, type SyncResponse, type WorldSyncRequest } from "../backend/src/contracts/routing.ts";
import { RouteEngine } from "../backend/src/modules/routing/route-engine.ts";
import { createRoutingApp } from "../backend/src/modules/routing/http-server.ts";
import { createWorldState } from "../backend/src/modules/simulator/world-state.ts";
import { TurnCoordinator } from "../backend/src/modules/simulator/turn-coordinator.ts";
import { createRoutingClient, type RoutingClient, type RoutingHttpResponse } from "../backend/src/modules/simulator/routing-client.ts";
import { parseRoutingStatus, parseSyncResponse } from "../backend/src/modules/simulator/routing-responses.ts";
import { buildWorldSyncRequest, hordeDangerNodes } from "../backend/src/modules/simulator/routing-world.ts";
import type { RoutingAlert } from "../backend/src/modules/simulator/routing-failure.ts";
import type { RoundConfig, TelemetryMetrics, WorldState } from "../backend/src/modules/simulator/types.ts";

// Fixtures de integración. No son roster ni escenario oficial aprobado de Manta.
function initial(roundId: 1 | 3 = 1): WorldState {
  const ids = ["A", "B", "R", "Z", "U", "V", "W", "D", "E", "F", "H", "X", "Y"];
  const pairs = [["A", "B"], ["B", "R"], ["U", "V"], ["V", "W"], ["D", "E"], ["E", "F"]];
  const graph: MantaGraph = {
    schemaVersion: "1.0.0", metadata: { ciudad: "Manta", graphVersion: "turn-fixture-v1",
      generatedAt: "2026-10-27T00:00:00Z", source: "OpenStreetMap", osmAttribution: "fixture" },
    nodos: ids.map(id => ({ id, zona: "Tarqui", lat: 0, lng: 0 })),
    aristas: pairs.flatMap(([a, b]) => [[a, b], [b, a]].map(([origen, destino]) => ({
      id: origen + destino, segmentoId: [origen, destino].sort().join(""), origen, destino,
      distancia_m: 1, tipo: "calle", factor_velocidad: 0.8,
    }))),
    refugios: [{ id: "REF", nodoId: "R", capacidad: 3 }],
  };
  const survivorCount = roundId === 1 ? 20 : 200;
  const roundConfig: RoundConfig = { roundId, durationMs: 300_000, turnIntervalMs: 2_000, turnCount: 150,
    survivorCount, survivorSpawns: Array.from({ length: survivorCount }, (_, i) => ({ id: `S-${i.toString().padStart(3, "0")}`, nodeId: "A" })),
    zombieSpawns: [{ id: "walk", tipo: "caminante", nodeId: "Z" }, ...(roundId === 3 ? [
      { id: "runner", tipo: "corredor" as const, nodeId: "U" }, { id: "horde", tipo: "horda" as const, nodeId: "H" },
      { id: "hidden", tipo: "dormido" as const, nodeId: "D" },
    ] : [])],
    eventPlan: roundId === 1 ? [] : [
      { eventId: "close-uv", edgeId: "UV", effectiveTurnId: 150, reason: "bloqueo-calle" },
      { eventId: "close-vw", edgeId: "VW", effectiveTurnId: 150, reason: "bloqueo-calle" },
    ],
  };
  const initialMetrics: TelemetryMetrics = { routeSamples: 0, routeLatencyP50Ms: 0, routeLatencyP95Ms: 0, routeLatencyP99Ms: 0,
    routeTimeouts: 0, invalidRouteResponses: 0, deadlineMisses: 0, activeSurvivors: survivorCount,
    bittenSurvivors: 0, evacuatedSurvivors: 0, activeZombies: roundId === 1 ? 1 : 3,
    wsClients: 0, snapshotQueueDepth: 0, lastSnapshotTurnId: null };
  const state = createWorldState({ gameId: "turn-game", graph, roundConfig,
    randomState: { seed: "unit-seed", algorithm: "sha256-counter", algorithmVersion: "1", strategy: "per-zombie-turn-draw" },
    initialMetrics, updatedAt: "2026-10-27T00:00:00Z" });
  state.status = "running"; // Simula el control de inicio, que se implementará en Etapa 6.
  return state;
}
function engineClient(engine: RouteEngine): RoutingClient {
  async function call(run: () => unknown): Promise<RoutingHttpResponse> {
    try { return { status: 200, body: run() }; }
    catch (error) { return { status: error instanceof RoutingError ? error.status : 503, body: null }; }
  }
  return { sync: request => call(() => engine.sync(request)), status: id => call(() => engine.getStatus(id)),
    step: request => call(() => engine.step(request)) };
}
function coordinator(state: WorldState, client: RoutingClient, overrides: Partial<ConstructorParameters<typeof TurnCoordinator>[1]> = {}) {
  return new TurnCoordinator(state, { client, syncTimeoutMs: 30, isoNow: () => "2026-10-27T00:00:01Z",
    emitAlert: () => {}, ...overrides });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function stepResponse(request: PasoRequest): PasoResponse {
  return { ...request, fromNodeId: request.currentNodeId, toNodeId: "B", edgeId: "AB", decision: "mover",
    targetShelterId: "REF", reason: "ruta-segura", routeCost: 2, latencyMs: 0 };
}

test("dos turnos completos consumen el Fastify real por loopback, mueven y admiten sin exceder capacidad", async () => {
  const state = initial(); const before = structuredClone(state);
  const app = await createRoutingApp({ engine: new RouteEngine(state.graph as MantaGraph), apiKey: "fixture-routing-key" });
  try {
    const url = await app.listen({ host: "127.0.0.1", port: 0 });
    const turn = coordinator(state, createRoutingClient({ baseUrl: url, apiKey: "fixture-routing-key" }), { syncTimeoutMs: 500 });
    const first = await turn.runTurn();
    assert.equal(first.attempts.length, 20); assert(first.world.survivors.every(s => s.nodeId === "B"));
    assert.deepEqual([first.world.turnId, first.world.worldVersion, first.world.routing.confirmed?.worldVersion], [1, 1, 1]);
    const second = await turn.runTurn();
    assert.equal(second.world.survivors.filter(s => s.estado === "evacuado").length, 3);
    assert.deepEqual(second.world.shelters[0].ocupantes, ["S-000", "S-001", "S-002"]);
    assert.equal(second.world.activeTurnId, null); assert.equal(second.world.activeTurn, null);
    assert.equal(first.world.turnId, 1); assert(first.world.survivors.every(s => s.nodeId === "B"));
    assert.deepEqual(state, before); assert(Object.isFrozen(second.world.survivors[0]));
  } finally { await app.close(); }
});

test("payload cerrado incluye recorridos, agregado de dormidos y observaciones simuladas", async () => {
  const state = initial(3); const engine = new RouteEngine(state.graph as MantaGraph); const client = engineClient(engine);
  let sent!: WorldSyncRequest;
  const turn = coordinator(state, { ...client, sync: async (request, signal) => {
    sent = structuredClone(request); return client.sync(request, signal);
  } });
  await turn.runTurn();
  assert.deepEqual(Object.keys(sent).sort(), ["gameId", "turnId", "baseWorldVersion", "survivors", "zombies", "shelters",
    "blockedEdges", "zombieTraversals", "dormantUncertaintyNodeIds", "cameraObservations"].sort());
  assert.equal(sent.zombieTraversals.filter(t => t.zombieId === "runner").length, 2);
  assert.deepEqual(sent.dormantUncertaintyNodeIds, ["D", "E", "F"]);
  assert(!JSON.stringify(sent).includes("hidden"));
  assert(!sent.zombies.some(z => z.tipo === "dormido"));
});

test("eventos son efectivos antes del sync y de las rutas", async () => {
  const state = initial();
  state.pendingCityEvents.push({ eventId: "close", tipo: "bloquear-segmento", edgeId: "AB", motivo: "fixture",
    effectiveTurnId: 1, aplicado: false, origen: "control" });
  const engine = new RouteEngine(state.graph as MantaGraph);
  const result = await coordinator(state, engineClient(engine)).runTurn();
  assert.deepEqual(result.world.blockedEdges[0].edgeIds, ["AB", "BA"]);
  assert.equal(result.world.pendingCityEvents[0].aplicado, true);
  assert(result.world.survivors.every(s => s.nodeId === "A"));
});

test("el coordinador rechaza entrar a una observación vigente y permite entrar al vencer", async () => {
  const state = initial(); state.turnId = 1; state.worldVersion = 1;
  state.cameraObservations = [{ cameraId: "simulated-camera", zombieId: "walk", nodeId: "B",
    detectedTurnId: 1, expiresAfterTurnId: 3 }];
  const engine = new RouteEngine(state.graph as MantaGraph); const client = engineClient(engine);
  const syncs: WorldSyncRequest[] = [];
  const turn = coordinator(state, { ...client,
    sync: (request, signal) => { syncs.push(structuredClone(request)); return client.sync(request, signal); },
    // Inyecta una propuesta insegura para comprobar la defensa autoritativa;
    // sincronización y demás decisiones siguen consumiendo el motor real.
    step: (request, signal) => {
      if (request.survivorId !== "S-000") return client.step(request, signal);
      const { currentNodeId, ...identity } = request;
      return Promise.resolve({ status: 200, body: { ...identity, fromNodeId: currentNodeId,
        toNodeId: "B", edgeId: "AB", decision: "mover", targetShelterId: "REF",
        reason: "ruta-segura", routeCost: 2, latencyMs: 0 } });
    },
  });
  const blocked = await turn.runTurn();
  assert.equal(syncs[0].cameraObservations!.length, 1);
  assert.equal(blocked.decisions.decisions[0].decision, "esperar");
  assert.equal(blocked.decisions.decisions[0].decision === "esperar" && blocked.decisions.decisions[0].cause, "invalid-response");
  assert.equal(blocked.world.survivors[0].nodeId, "A");
  assert.equal(blocked.world.metrics.invalidRouteResponses, 1);
  const expired = await turn.runTurn();
  assert.deepEqual(syncs[1].cameraObservations, []);
  assert.equal(expired.decisions.decisions[0].decision, "mover");
  assert.equal(expired.world.survivors[0].nodeId, "B");
  assert.equal(expired.world.metrics.invalidRouteResponses, 1);
});

test("sync expirada pero instalada se reconcilia antes de consultar rutas", async () => {
  const state = initial(); const engine = new RouteEngine(state.graph as MantaGraph); const client = engineClient(engine);
  let syncs = 0; let queries = 0;
  const turn = coordinator(state, { ...client,
    sync: async request => { syncs++; engine.sync(request); return new Promise(() => {}); },
    status: async (id, signal) => { queries++; return client.status(id, signal); },
  });
  const result = await turn.runTurn();
  assert.equal(syncs, 1); assert.equal(queries, 1); assert.equal(result.attempts.length, 20);
  assert.equal(result.world.routing.uncertain, false); assert(result.world.survivors.every(s => s.nodeId === "B"));
});

test("sync no instalada cierra con mordidas; siguiente turno salta la versión local sin reutilizar plan", async () => {
  const state = initial();
  const extra = [{ id: "ZB", segmentoId: "BZ", origen: "Z", destino: "B", distancia_m: 1, tipo: "calle" as const, factor_velocidad: 0.8 }];
  state.graph = { ...state.graph, aristas: [...state.graph.aristas, ...extra] };
  const engine = new RouteEngine(state.graph as MantaGraph); const client = engineClient(engine);
  const sent: WorldSyncRequest[] = [];
  const turn = coordinator(state, { ...client, sync: async (request, signal) => {
    sent.push(request);
    return request.turnId === 2 ? { status: 503, body: null } : client.sync(request, signal);
  } });
  await turn.runTurn();
  const failed = await turn.runTurn();
  assert.equal(failed.attempts.length, 0); assert(failed.world.survivors.every(s => s.estado === "mordido"));
  assert.equal(failed.world.routing.confirmed?.turnId, 1); assert.equal(failed.world.routing.uncertain, false);
  assert.deepEqual(failed.world.shelters[0].ocupantes, []);
  const next = await turn.runTurn();
  assert.deepEqual([sent[2].turnId, sent[2].baseWorldVersion], [3, 1]);
  assert.deepEqual([next.world.worldVersion, next.world.routing.confirmed?.worldVersion], [3, 2]);
});

test("una sync incierta no conciliable pausa al cierre y conserva el intento exacto", async () => {
  const state = initial(); const engine = new RouteEngine(state.graph as MantaGraph); const client = engineClient(engine);
  const result = await coordinator(state, { ...client,
    sync: async () => ({ status: 503, body: null }), status: async () => ({ status: 503, body: null }),
  }).runTurn();
  assert.equal(result.world.turnId, 1); assert.equal(result.world.status, "paused");
  assert.equal(result.world.pause.status !== "none" && result.world.pause.cause, "routing-sync-uncertain");
  assert.equal(result.world.routing.uncertain, true); assert.equal(result.world.routing.attemptedRequest?.turnId, 1);
  assert.equal(result.attempts.length, 0);
});

test("las rutas usan la versión instalada aunque la versión comprometida del simulador sea mayor", async () => {
  const state = initial(); const engine = new RouteEngine(state.graph as MantaGraph); const client = engineClient(engine);
  const turn = coordinator(state, { ...client, sync: async (request, signal) =>
    request.turnId === 1 ? { status: 503, body: null } : client.sync(request, signal) });
  const first = await turn.runTurn();
  assert.equal(first.attempts.length, 0); assert.equal(first.world.worldVersion, 1);
  const second = await turn.runTurn();
  assert.equal(second.world.worldVersion, 2); assert.equal(second.world.routing.confirmed?.worldVersion, 1);
  assert.equal(second.attempts.length, 20);
  assert(second.attempts.every(attempt => attempt.request.turnId === 2 && attempt.request.worldVersion === 1));
  assert(second.world.survivors.every(s => s.nodeId === "B"));
});

test("un intento de turno previo se concilia antes de instalar el payload nuevo", async () => {
  const state = initial(); const engine = new RouteEngine(state.graph as MantaGraph); const client = engineClient(engine);
  const first = await coordinator(state, { ...client, sync: async request => {
    engine.sync(request); return { status: 503, body: null };
  }, status: async () => ({ status: 503, body: null }) }).runTurn();
  const resumed = structuredClone(first.world) as WorldState;
  resumed.status = "running"; resumed.pause = { status: "none" }; // Fixture de reanudación, no control oficial.
  const order: string[] = [];
  const next = await coordinator(resumed, { ...client,
    status: async (id, signal) => { order.push("status"); return client.status(id, signal); },
    sync: async (request, signal) => { order.push(`sync:${request.turnId}:${request.baseWorldVersion}`); return client.sync(request, signal); },
  }).runTurn();
  assert.deepEqual(order, ["status", "sync:2:1"]); assert.equal(next.world.routing.confirmed?.turnId, 2);
});

test("HTTP 401 en sync, consulta de estado o paso espera, pausa y emite una alerta sin secretos", async () => {
  for (const endpoint of ["sync", "status", "step"] as const) {
    const state = initial(); const engine = new RouteEngine(state.graph as MantaGraph); const client = engineClient(engine);
    const alerts: RoutingAlert[] = [];
    const bad = async () => ({ status: 401, body: { secret: "do-not-leak" } });
    const selected = { ...client, [endpoint]: bad };
    if (endpoint === "status") selected.sync = async () => ({ status: 503, body: null });
    const turn = coordinator(state, selected, { emitAlert: alert => { assert.equal(turn.getCommittedWorld().turnId, 1); alerts.push(alert); } });
    const result = await turn.runTurn();
    assert.equal(result.world.status, "paused"); assert.equal(alerts.length, 1);
    assert(result.world.survivors.every(s => s.nodeId === "A"));
    assert.equal(result.world.pause.status !== "none" && result.world.pause.cause, "routing-unauthorized");
    assert(!JSON.stringify(result).includes("do-not-leak"));
    await assert.rejects(turn.runTurn(), /no admite/);
  }
});

test("un timeout individual de 500 ms no espera una promesa colgada ni aplica una respuesta posterior", async () => {
  const state = initial(); const engine = new RouteEngine(state.graph as MantaGraph); const client = engineClient(engine);
  const late = deferred<RoutingHttpResponse>(); let aborted = false; let calls = 0; let request!: PasoRequest;
  const turn = coordinator(state, { ...client, step: async (item, signal) => {
    calls++;
    if (item.survivorId === "S-000") { request = item; signal.addEventListener("abort", () => { aborted = true; }); return late.promise; }
    return client.step(item, signal);
  } });
  const result = await turn.runTurn();
  assert.equal(calls, 20); assert(aborted);
  assert.equal(result.attempts[0].kind, "timeout"); assert.equal(result.attempts[0].elapsedMs, 500);
  assert.equal(result.world.survivors[0].nodeId, "A"); assert.equal(result.world.survivors[1].nodeId, "B");
  late.resolve({ status: 200, body: stepResponse(request) }); await new Promise(done => setImmediate(done));
  assert.equal(turn.getCommittedWorld().survivors[0].nodeId, "A"); assert.equal(turn.getCommittedWorld().turnId, 1);
});

test("errores y respuestas inválidas afectan solo al sobreviviente correspondiente", async () => {
  const state = initial(); const engine = new RouteEngine(state.graph as MantaGraph); const client = engineClient(engine);
  const turn = coordinator(state, { ...client, step: async (request, signal) => {
    if (request.survivorId === "S-000") throw new Error("do-not-leak");
    if (request.survivorId === "S-001") return { status: 200, body: { ...stepResponse(request), worldVersion: 0 } };
    if (request.survivorId === "S-002") return { status: 409, body: "stale" };
    return client.step(request, signal);
  } });
  const result = await turn.runTurn();
  assert.deepEqual(result.world.survivors.slice(0, 4).map(s => s.nodeId), ["A", "A", "A", "B"]);
  assert(!JSON.stringify(result).includes("do-not-leak"));
});

test("descarta respuesta tardía por reloj monotónico aunque el callback del timer todavía no haya corrido", async () => {
  const state = initial(); const client = engineClient(new RouteEngine(state.graph as MantaGraph));
  let elapsed = 0;
  const turn = coordinator(state, { ...client, step: async request => {
    elapsed = 501; return { status: 200, body: stepResponse(request) };
  } }, { now: () => elapsed });
  const result = await turn.runTurn();
  assert(result.attempts.every(attempt => attempt.kind === "timeout"));
  assert(result.world.survivors.every(s => s.nodeId === "A"));
});

test("hasta 200 solicitudes simultáneas, un solo turno activo y ninguna fase parcial visible", async () => {
  const state = initial(3); const engine = new RouteEngine(state.graph as MantaGraph); const client = engineClient(engine);
  const gate = deferred<void>(); const entered = deferred<void>(); let count = 0; let inFlight = 0; let max = 0;
  const turn = coordinator(state, { ...client, step: async (request, signal) => {
    count++; inFlight++; max = Math.max(max, inFlight); if (count === 200) entered.resolve();
    await gate.promise;
    try { return await client.step(request, signal); } finally { inFlight--; }
  } });
  const pending = turn.runTurn(); await entered.promise;
  assert.equal(turn.getCommittedWorld().turnId, 0); assert(turn.getCommittedWorld().survivors.every(s => s.nodeId === "A"));
  await assert.rejects(turn.runTurn(), /en curso/);
  gate.resolve(); const result = await pending;
  assert.equal(count, 200); assert.equal(max, 200); assert.equal(inFlight, 0);
  assert.equal(result.world.turnId, 1); assert.equal(result.world.worldVersion, 1);
  assert(result.attempts.every(a => a.request.turnId === 1 && a.request.worldVersion === 1));
});

test("no acepta sync/status fuera de esquema, NaN o un grafo incorrecto", async () => {
  const valid: SyncResponse = { turnId: 1, worldVersion: 1, graphVersion: "test", workerCount: 1, buildLatencyMs: 0, ready: true };
  for (const body of [null, {}, { ...valid, extra: true }, { ...valid, ready: false }, { ...valid, buildLatencyMs: NaN },
    { ...valid, workerCount: 0 }, { ...valid, turnId: "1" }]) assert.throws(() => parseSyncResponse(body));
  assert.throws(() => parseRoutingStatus({ gameId: "game", installed: valid, extra: true }));
  assert.throws(() => parseRoutingStatus({ gameId: "game", installed: {} }));
  const state = initial(); const engine = new RouteEngine(state.graph as MantaGraph); const client = engineClient(engine);
  const result = await coordinator(state, { ...client,
    sync: async () => ({ status: 200, body: { ...valid, graphVersion: "other" } }),
    status: async () => ({ status: 200, body: { gameId: state.gameId, installed: { ...valid, graphVersion: "other" } } }),
  }).runTurn();
  assert.equal(result.attempts.length, 0); assert.equal(result.world.status, "paused");
});

test("el cliente rechaza destinos externos, credenciales en URL y redirecciones implícitas", () => {
  for (const baseUrl of ["https://example.com", "http://example.com", "http://127.0.0.1/path", "http://u:p@localhost", "http://localhost?key=x"]) {
    assert.throws(() => createRoutingClient({ baseUrl, apiKey: "fixture-routing-key" }), /loopback/);
  }
});

test("el mundo se compromete aunque falle el emisor de alerta", async () => {
  const state = initial(); const client = engineClient(new RouteEngine(state.graph as MantaGraph));
  const turn = coordinator(state, { ...client, sync: async () => ({ status: 401, body: null }) },
    { emitAlert: () => { throw new Error("sink failure"); } });
  const result = await turn.runTurn();
  assert.equal(result.world.turnId, 1); assert.equal(result.world.status, "paused"); assert(result.alertDeliveryFailed);
});

test("horda conserva peligros entrantes/salientes y la proyección no serializa metadatos internos", () => {
  const state = initial(3);
  const danger = hordeDangerNodes({ ...state.graph, aristas: [...state.graph.aristas,
    { ...state.graph.aristas[0], id: "HA", origen: "H", destino: "A" },
    { ...state.graph.aristas[0], id: "BH", origen: "B", destino: "H" }] }, state.zombies);
  assert.deepEqual(danger, ["A", "B", "H"]);
  const payload = JSON.stringify(buildWorldSyncRequest(state, 1));
  for (const field of ["randomState", "rngSeed", "pause", "activeTurn", "metrics"]) assert(!payload.includes(`"${field}"`));
});
