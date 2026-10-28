import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import Fastify from "fastify";
import WebSocket from "ws";
import type { MantaGraph } from "../backend/src/contracts/types.ts";
import type { PasoRequest, PasoResponse, WorldSyncRequest } from "../backend/src/contracts/routing.ts";
import { RouteEngine } from "../backend/src/modules/routing/route-engine.ts";
import { routingPlugin } from "../backend/src/modules/routing/http-server.ts";
import { simulatorPlugin } from "../backend/src/modules/simulator/http-plugin.ts";
import { realtimePlugin } from "../backend/src/modules/realtime/http-plugin.ts";
import { SimulationRuntime } from "../backend/src/modules/simulator/simulation-runtime.ts";
import { createRoutingClient } from "../backend/src/modules/simulator/routing-client.ts";
import type { SimulationClock } from "../backend/src/modules/simulator/simulation-clock.ts";
import type { RoundConfig, TurnUpdate } from "../backend/src/modules/simulator/types.ts";
import { createInitialTelemetryMetrics } from "../backend/src/modules/simulator/world-state.ts";

class ManualClock implements SimulationClock {
  time = 0;
  private pending = new Set<{ tick: number; finish: () => void }>();
  now() { return this.time; }
  waitUntil(tick: number, signal: AbortSignal) {
    if (signal.aborted || tick <= this.time) return Promise.resolve();
    return new Promise<void>(resolve => {
      const waiter = { tick, finish: () => { this.pending.delete(waiter); signal.removeEventListener("abort", waiter.finish); resolve(); } };
      this.pending.add(waiter); signal.addEventListener("abort", waiter.finish, { once: true });
    });
  }
  advance(time: number) { this.time = time; for (const waiter of [...this.pending]) if (time >= waiter.tick) waiter.finish(); }
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve };
}
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer!: ReturnType<typeof setTimeout>;
  try { return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("No se alcanzó la frontera de turno esperada")), 3_000);
  })]); } finally { clearTimeout(timer); }
}

// Escenario mínimo sintético: el único camino al refugio pasa por B-C.
// El caminante aislado no altera la ruta; no representa un escenario oficial.
function fixture(reverse: boolean) {
  const path = reverse ? ["R", "C", "B", "A"] : ["A", "B", "C", "R"];
  const graph: MantaGraph = { schemaVersion: "1.0.0", metadata: { ciudad: "Manta", graphVersion: "segments-fixture",
    generatedAt: "2026-10-27T00:00:00Z", source: "OpenStreetMap", osmAttribution: "Fixture sintética" },
    nodos: ["A", "B", "C", "R", "Z"].map(id => ({ id, lat: 0, lng: 0, zona: "Tarqui" })),
    aristas: [["A", "B"], ["B", "C"], ["C", "R"]].flatMap(([a, b]) => [[a, b], [b, a]].map(([origen, destino]) => ({
      id: `${origen}-${destino}`, segmentoId: [origen, destino].sort().join(""), origen, destino,
      tipo: "calle", distancia_m: 1, factor_velocidad: 0.8,
    }))), refugios: [{ id: "REF", nodoId: path[3], capacidad: 20 }] };
  const config: RoundConfig = { roundId: 1, durationMs: 300_000, turnIntervalMs: 2_000, turnCount: 150,
    survivorCount: 20, survivorSpawns: Array.from({ length: 20 }, (_, i) => ({ id: `S${i}`, nodeId: path[0] })),
    zombieSpawns: [{ id: "Z", tipo: "caminante", nodeId: "Z" }], eventPlan: [] };
  return { graph, config, path };
}

const cases = [
  { name: "ruta libre de referencia cruza el segmento", reverse: false, close: false, failSync: false },
  { name: "bloqueo y desbloqueo impiden y restauran B→C", reverse: false, close: true, failSync: false },
  { name: "bloqueo y desbloqueo impiden y restauran C→B", reverse: true, close: true, failSync: false },
  { name: "sync fallida con bloqueo no reutiliza el plan anterior", reverse: false, close: true, failSync: true },
];

for (const scenario of cases) test(`segmentos HTTP/WS: ${scenario.name}`, { timeout: 10_000 }, async () => {
  const { graph, config, path } = fixture(scenario.reverse);
  const app = Fastify({ logger: false }); const clock = new ManualClock();
  const apiKey = "segments-fixture-key"; const entered = deferred(), release = deferred();
  const syncs: WorldSyncRequest[] = [], steps: PasoRequest[] = [], decisions: PasoResponse[] = [];
  const order: string[] = [], alerts: unknown[] = [], failures: unknown[] = [];
  const reconciledTurns: (number | null)[] = [];
  let url = "";
  const runtime = new SimulationRuntime({ graph, rounds: { 1: config }, initialMetrics: () => createInitialTelemetryMetrics(config),
    clock, clientFactory: () => createRoutingClient({ baseUrl: url, apiKey }), syncTimeoutMs: 500,
    emitAlert: alert => alerts.push(alert), onFailure: event => failures.push(event) });

  // Instrumentación de prueba sobre el HTTP real; no cambia el módulo routing.
  app.addHook("preHandler", async (request, reply) => {
    if (request.url === "/motor/sincronizar") {
      const body = request.body as WorldSyncRequest; syncs.push(structuredClone(body)); order.push(`sync:${body.turnId}`);
      if (scenario.failSync && body.turnId === 2) return reply.code(503).send({ error: { code: "FIXTURE_SYNC_FAILURE" } });
    }
    if (request.url === "/paso") {
      const body = request.body as PasoRequest; steps.push(structuredClone(body)); order.push(`step:${body.turnId}`);
    }
  });
  app.addHook("onSend", async (request, reply, payload) => {
    if (request.url === "/motor/sincronizar" && reply.statusCode === 200) {
      const body = JSON.parse(String(payload));
      if (body.turnId === 1) { entered.resolve(); await release.promise; }
      order.push(`confirmed:${body.turnId}`);
    }
    if (request.url.startsWith("/motor/estado/") && reply.statusCode === 200) {
      const body = JSON.parse(String(payload)); reconciledTurns.push(body.installed?.turnId ?? null); order.push("status");
    }
    if (request.url === "/paso" && reply.statusCode === 200) decisions.push(JSON.parse(String(payload)) as PasoResponse);
    return payload;
  });
  app.register(routingPlugin, { engine: new RouteEngine(graph), apiKey });
  app.register(simulatorPlugin, { runtime, apiKey }); app.register(realtimePlugin, { runtime });
  let socket: WebSocket | undefined;
  const updates: TurnUpdate[] = [];
  try {
    url = await app.listen({ host: "127.0.0.1", port: 0 });
    socket = new WebSocket(url.replace("http://", "ws://") + "/ws");
    socket.on("message", data => { updates.push(JSON.parse(data.toString()) as TurnUpdate); });
    socket.on("error", () => {}); await bounded(once(socket, "open"));
    async function update(turnId: number) {
      const find = () => updates.find(u => u.world.turnId === turnId);
      while (!find()) await bounded(once(socket!, "message"));
      return find()!.world;
    }
    async function post(endpoint: string, body: unknown) {
      const response = await fetch(`${url}${endpoint}`, { method: "POST", headers: {
        "content-type": "application/json", "x-api-key": apiKey }, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    }
    async function state() {
      const response = await fetch(`${url}/estado`); assert.equal(response.status, 200); return response.json();
    }
    const started = await post("/simulador/iniciar", { gameId: "segments-fixture", roundId: 1, seed: "synthetic-only" });
    assert.equal(started.status, 202); const zero = await update(0);
    clock.advance(2_000); await bounded(entered.promise);
    const closeCommand = { eventId: "close", edgeId: "B-C", bloqueada: true, motivo: "cierre sintético" };
    if (scenario.close) {
      const accepted = await post("/simulador/bloquear-arista", closeCommand);
      assert.deepEqual(accepted, { status: 202, body: { eventId: "close", segmentoId: "BC", effectiveTurnId: 2, status: "programado" } });
      assert.deepEqual(await post("/simulador/bloquear-arista", closeCommand), accepted, "Replay idempotente en vuelo");
      assert.equal((await post("/simulador/bloquear-arista", { ...closeCommand, motivo: "conflicto" })).status, 409);
    }
    assert.deepEqual(await state(), zero, "202 no aplica el evento ni publica una fase parcial");
    assert.equal(steps.length, 0, "No calcular rutas antes de confirmar sync");
    assert.deepEqual(syncs[0].blockedEdges, [], "El control en vuelo no modifica el snapshot ya enviado");
    assert.deepEqual(updates.map(u => u.world.turnId), [0]);
    release.resolve();
    const first = await update(1); assert(first.survivors.every(s => s.nodeId === path[1]));
    assert.deepEqual(first.blockedEdges, []); assert.deepEqual(await state(), first);
    if (scenario.close) {
      const pending = runtime.getCommittedWorld()!.pendingCityEvents;
      assert.equal(pending.length, 1); assert.equal(pending[0].aplicado, false);
    }
    clock.advance(4_000); const second = await update(2);
    assert.deepEqual(await state(), second);
    if (!scenario.close) {
      assert(second.survivors.every(s => s.nodeId === path[2]));
      assert.equal(decisions.filter(d => d.turnId === 2).length, 20);
      assert(decisions.filter(d => d.turnId === 2).every(d => d.edgeId === "B-C" && d.decision === "mover"));
      assert.equal(steps.filter(r => r.turnId === 2).length, 20); return;
    }
    assert(second.survivors.every(s => s.nodeId === path[1]), "El cierre corta la única ruta al refugio");
    const blocked = { segmentoId: "BC", edgeIds: ["B-C", "C-B"], motivo: "cierre sintético", origen: "control",
      bloqueadaDesdeTurno: 2, desbloqueadaEnTurno: null };
    assert.deepEqual(second.blockedEdges, [blocked]); assert.deepEqual(syncs[1].blockedEdges, [blocked]);
    assert(runtime.getCommittedWorld()!.pendingCityEvents[0].aplicado);
    if (scenario.failSync) {
      assert.deepEqual(reconciledTurns, [1], "El motor conserva el plan del turno anterior");
      assert.equal(runtime.getCommittedWorld()!.routing.confirmed?.turnId, 1);
      assert.equal(steps.filter(r => r.turnId === 2).length, 0, "Ni siquiera consultar el plan anterior");
    } else {
      assert.equal(steps.filter(r => r.turnId === 2).length, 20);
      assert.equal(decisions.filter(d => d.turnId === 2).length, 20);
      assert(decisions.filter(d => d.turnId === 2).every(d => d.decision === "esperar" && d.edgeId === null));
    }
    // Desbloquear a través de la arista opuesta también afecta el segmento completo.
    const openCommand = { eventId: "open", edgeId: "C-B", bloqueada: false, motivo: "reapertura sintética", effectiveTurnId: 4 };
    const opened = await post("/simulador/bloquear-arista", openCommand);
    assert.deepEqual(opened, { status: 202, body: { eventId: "open", segmentoId: "BC", effectiveTurnId: 4, status: "programado" } });
    assert.deepEqual(await state(), second, "Programar reapertura no abre anticipadamente");
    clock.advance(6_000); const third = await update(3);
    assert(third.survivors.every(s => s.nodeId === path[1])); assert.deepEqual(third.blockedEdges, [blocked]);
    assert.deepEqual(await state(), third);
    clock.advance(8_000); const fourth = await update(4);
    assert(fourth.survivors.every(s => s.nodeId === path[2]), "Se vuelve a cruzar exactamente al desbloquear");
    const reopened = { ...blocked, desbloqueadaEnTurno: 4 };
    assert.deepEqual(fourth.blockedEdges, [reopened]); assert.deepEqual(syncs[3].blockedEdges, [reopened]);
    assert.deepEqual(await state(), fourth);
    assert(runtime.getCommittedWorld()!.pendingCityEvents.every(e => e.aplicado));
    assert.deepEqual(await post("/simulador/bloquear-arista", closeCommand), { status: 202,
      body: { eventId: "close", segmentoId: "BC", effectiveTurnId: 2, status: "programado" } });
    assert.deepEqual(await post("/simulador/bloquear-arista", openCommand), opened);
    assert.deepEqual(await state(), fourth, "Replay tras aplicar no repite ni revierte eventos");
    for (const turnId of [1, 2, 3, 4]) {
      const requests = steps.filter(r => r.turnId === turnId);
      if (scenario.failSync && turnId === 2) continue;
      assert.equal(requests.length, 20);
      const expectedVersion = scenario.failSync && turnId >= 3 ? turnId - 1 : turnId;
      assert(requests.every(r => r.worldVersion === expectedVersion));
      assert(order.includes(`confirmed:${turnId}`));
      assert(order.indexOf(`confirmed:${turnId}`) < order.indexOf(`step:${turnId}`));
    }
    assert.equal(decisions.filter(d => d.turnId === 4).length, 20);
    assert(decisions.filter(d => d.turnId === 4).every(d => d.edgeId === `${path[1]}-${path[2]}`));
    assert.deepEqual(updates.map(u => u.world.turnId), [0, 1, 2, 3, 4]);
    assert.deepEqual(alerts, []); assert.deepEqual(failures, []);
  } finally { release.resolve(); socket?.terminate(); await app.close(); }
});
