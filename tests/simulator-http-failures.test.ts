import assert from "node:assert/strict";
import { once } from "node:events";
import { performance } from "node:perf_hooks";
import { test } from "node:test";
import Fastify from "fastify";
import WebSocket from "ws";
import type { PasoRequest } from "../backend/src/contracts/routing.ts";
import { RouteEngine } from "../backend/src/modules/routing/route-engine.ts";
import { routingPlugin } from "../backend/src/modules/routing/http-server.ts";
import { realtimePlugin } from "../backend/src/modules/realtime/http-plugin.ts";
import { simulatorPlugin } from "../backend/src/modules/simulator/http-plugin.ts";
import { createRoutingClient } from "../backend/src/modules/simulator/routing-client.ts";
import type { RoutingAlert } from "../backend/src/modules/simulator/routing-failure.ts";
import type { SimulationClock } from "../backend/src/modules/simulator/simulation-clock.ts";
import { SimulationRuntime } from "../backend/src/modules/simulator/simulation-runtime.ts";
import type { RoundId, TurnUpdate } from "../backend/src/modules/simulator/types.ts";
import { integratedScenario } from "./fixtures/integrated-scenario.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve };
}

// Libera la primera frontera de publicación; retiene las siguientes.
// El trabajo posterior se retiene también en sync para observar solo el primer lote.
function firstTickOnly(): SimulationClock {
  let first = true, offset = 0;
  return { now: () => performance.now() + offset, waitUntil: async (tick, signal) => {
    if (first) { first = false; offset = tick - performance.now(); return; }
    if (!signal.aborted) await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
  } };
}

type Fault = "non-adjacent" | "wrong-version" | "timeout" | "unauthorized" | "uncertain-sync";
const faults: Fault[] = ["non-adjacent", "wrong-version", "timeout", "unauthorized", "uncertain-sync"];
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

for (const roundId of [1, 2, 3] as RoundId[]) for (const fault of faults) {
  test(`fixture sintética R${roundId}: ${fault} por HTTP conserva estado seguro y publicación consistente`,
    { timeout: 15_000 }, async () => {
      const { graph, config, metrics } = integratedScenario(roundId);
      const app = Fastify({ logger: false }); const apiKey = "http-failure-fixture-key";
      const releaseLate = deferred(), lateReturned = deferred();
      const requests: PasoRequest[] = [], order: string[] = [], alerts: RoutingAlert[] = [], failures: unknown[] = [];
      let faultHits = 0, aborts = 0, statusQueries = 0, syncs = 0;
      let url = "";
      const runtime = new SimulationRuntime({ graph, rounds: { [roundId]: config }, initialMetrics: () => metrics,
        clock: firstTickOnly(), syncTimeoutMs: 500,
        clientFactory: () => {
          const client = createRoutingClient({ baseUrl: url, apiKey });
          return { ...client, sync: (request, signal) => request.turnId === 1 ? client.sync(request, signal)
            : new Promise((_, reject) => {
              if (signal.aborted) { reject(new Error("fixture stopped")); return; }
              signal.addEventListener("abort", () => reject(new Error("fixture stopped")), { once: true });
            }), step: (request, signal) => {
            signal.addEventListener("abort", () => { aborts++; }, { once: true });
            return client.step(request, signal);
          } };
        }, emitAlert: alert => alerts.push(alert), onFailure: event => failures.push(event) });

      // Hooks exclusivos de este servidor de prueba: el motor real sigue instalando
      // planes y calculando respuestas. Solo se altera el transporte de una respuesta.
      app.addHook("preHandler", async request => {
        if (request.url === "/motor/sincronizar") { syncs++; order.push("sync"); }
        if (request.url.startsWith("/motor/estado/")) { statusQueries++; order.push("status"); }
        if (request.url === "/paso") { requests.push(request.body as PasoRequest); order.push("step"); }
      });
      app.addHook("onSend", async (request, reply, payload) => {
        if (fault === "uncertain-sync" && request.url === "/motor/sincronizar") {
          faultHits++; const body = JSON.parse(String(payload));
          return JSON.stringify({ ...body, worldVersion: body.worldVersion + 1 });
        }
        if (request.url !== "/paso" || (request.body as PasoRequest).survivorId !== "S000" || fault === "uncertain-sync") return payload;
        faultHits++;
        if (fault === "timeout") {
          await releaseLate.promise; lateReturned.resolve(); return payload;
        }
        if (fault === "unauthorized") {
          reply.code(401);
          return JSON.stringify({ error: { code: "UNAUTHORIZED", message: "fixture-rejected-secret" } });
        }
        const body = JSON.parse(String(payload));
        return JSON.stringify(fault === "wrong-version" ? { ...body, worldVersion: body.worldVersion + 1 }
          : { ...body, toNodeId: "N149", edgeId: "N0-N149" });
      });
      app.register(routingPlugin, { engine: new RouteEngine(graph), apiKey });
      app.register(simulatorPlugin, { runtime, apiKey }); app.register(realtimePlugin, { runtime });
      let socket: WebSocket | undefined;
      const updates: TurnUpdate[] = [];
      let notify: (() => void) | undefined;
      try {
        url = await app.listen({ host: "127.0.0.1", port: 0 });
        socket = new WebSocket(url.replace("http://", "ws://") + "/ws");
        socket.on("message", data => { updates.push(JSON.parse(data.toString()) as TurnUpdate); notify?.(); });
        socket.on("error", () => {}); await once(socket, "open");
        const start = await fetch(`${url}/simulador/iniciar`, { method: "POST",
          headers: { "content-type": "application/json", "x-api-key": apiKey },
          body: JSON.stringify({ gameId: `synthetic-fault-r${roundId}-${fault}`, roundId, seed: "fault-fixture-only" }) });
        assert.equal(start.status, 202); await start.text();
        const find = () => updates.find(update => update.world.turnId === 1);
        if (!find()) await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => { notify = undefined; reject(new Error("Falta el commit del turno con fallo")); }, 5_000);
          notify = () => { if (find()) { clearTimeout(timer); notify = undefined; resolve(); } };
        });
        const world = find()!.world;
        assert.equal(world.turnId, 1); assert.equal(world.worldVersion, 1);
        assert.equal(world.metrics.deadlineMisses, 0); assert.equal(faultHits, 1);
        assert.equal(syncs, 1); assert.equal(statusQueries, fault === "uncertain-sync" ? 1 : 0);
        assert.equal(requests.length, config.survivorCount, "Sin reintentos de /paso");
        assert.equal(new Set(requests.map(request => request.survivorId)).size, config.survivorCount);
        assert(requests.every(request => request.turnId === 1 && request.worldVersion === 1 && request.currentNodeId === "N0"));
        if (fault === "uncertain-sync") {
          assert.deepEqual(order.slice(0, 3), ["sync", "status", "step"], "Reconciliar antes de consultar rutas");
          assert(world.survivors.every(s => s.nodeId === "N1"));
          assert.equal(runtime.getCommittedWorld()!.routing.uncertain, false);
          assert.equal(runtime.getCommittedWorld()!.routing.confirmed?.worldVersion, 1);
        } else if (fault === "unauthorized") {
          assert(world.survivors.every(s => s.nodeId === "N0"), "Un 401 invalida el lote completo antes de pausar");
        } else {
          assert.equal(world.survivors.find(s => s.id === "S000")!.nodeId, "N0", "El afectado espera");
          assert(world.survivors.filter(s => s.id !== "S000").every(s => s.nodeId === "N1"), "Los demás avanzan");
        }
        assert.equal(world.status, fault === "unauthorized" ? "paused" : "running");
        assert.equal(aborts, fault === "timeout" ? 1 : 0);
        assert.equal(alerts.length, fault === "unauthorized" ? 1 : 0);
        if (fault === "unauthorized") {
          await runtime.whenStopped();
          assert.equal(alerts[0].code, "ROUTING_UNAUTHORIZED");
          const pause = runtime.getCommittedWorld()!.pause;
          assert(pause.status === "effective"); assert.equal(pause.cause, "routing-unauthorized");
        }
        const response = await fetch(`${url}/estado`); assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), world);
        const serialized = JSON.stringify({ updates, alerts });
        assert(!serialized.includes(apiKey)); assert(!serialized.includes("fixture-rejected-secret"));
        assert(!serialized.includes("fault-fixture-only")); assert.deepEqual(failures, []);
        if (fault === "timeout") {
          // Devuelve la respuesta del servidor después de que el cliente abortó.
          // No debe aparecer un segundo commit ni moverse retrospectivamente S000.
          releaseLate.resolve(); await lateReturned.promise; await flush();
          const recovered = await fetch(`${url}/estado`);
          assert.equal(recovered.status, 200); assert.deepEqual(await recovered.json(), world);
        }
        assert.deepEqual(updates.map(update => update.world.turnId), [0, 1]);
      } finally { releaseLate.resolve(); socket?.terminate(); await app.close(); }
    });
}
