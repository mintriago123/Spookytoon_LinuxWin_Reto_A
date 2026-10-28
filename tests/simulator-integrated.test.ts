import assert from "node:assert/strict";
import { once } from "node:events";
import { performance } from "node:perf_hooks";
import { test } from "node:test";
import Fastify from "fastify";
import WebSocket from "ws";
import { RouteEngine } from "../backend/src/modules/routing/route-engine.ts";
import { routingPlugin } from "../backend/src/modules/routing/http-server.ts";
import { SimulationRuntime } from "../backend/src/modules/simulator/simulation-runtime.ts";
import { createRoutingClient, type RoutingClient } from "../backend/src/modules/simulator/routing-client.ts";
import type { SimulationClock } from "../backend/src/modules/simulator/simulation-clock.ts";
import { simulatorPlugin } from "../backend/src/modules/simulator/http-plugin.ts";
import { realtimePlugin } from "../backend/src/modules/realtime/http-plugin.ts";
import type { RoundId, TurnUpdate } from "../backend/src/modules/simulator/types.ts";
import { integratedScenario } from "./fixtures/integrated-scenario.ts";

/** Omite solo la espera entre ticks. Dentro del turno transcurre tiempo monotónico real.
 * No prueba cadencia de pared, jitter del scheduler ni aceptación temporal oficial. */
class AcceleratedClock implements SimulationClock {
  private offset = -performance.now();
  private pending: { tick: number; release: () => void } | null = null;
  now() { return performance.now() + this.offset; }
  waitUntil(tick: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted || tick <= this.now()) return Promise.resolve();
    assert.equal(this.pending, null, "Los turnos no deben tener esperas solapadas");
    return new Promise(resolve => {
      const release = () => { this.pending = null; signal.removeEventListener("abort", release); resolve(); };
      this.pending = { tick, release }; signal.addEventListener("abort", release, { once: true });
    });
  }
  async next() {
    const deadline = performance.now() + 5_000;
    while (!this.pending && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 1));
    assert(this.pending, "El turno debe cerrar y esperar antes de avanzar el reloj");
    this.offset = this.pending.tick - performance.now(); this.pending.release();
  }
}

function distribution(samples: number[]) {
  assert(samples.length > 0);
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = (p: number) => Number(sorted[Math.ceil(p * sorted.length) - 1].toFixed(3));
  return { samples: samples.length, p50Ms: rank(0.5), p95Ms: rank(0.95), p99Ms: rank(0.99), maxMs: rank(1) };
}

for (const roundId of [1, 2, 3] as RoundId[]) {
  test(`integración HTTP/WS con fixture de ronda ${roundId}: 150 turnos y carga sostenida`, { timeout: 120_000 }, async t => {
    const { graph, config, metrics } = integratedScenario(roundId);
    const app = Fastify({ logger: false });
    const clock = new AcceleratedClock(); const apiKey = "integration-fixture-key";
    const routeMs: number[] = [], buildMs: number[] = [], turnMs: number[] = [];
    const failures: unknown[] = [], alerts: unknown[] = [];
    let inFlight = 0, maxInFlight = 0, httpErrors = 0, aborted = 0, turnStarted = 0;
    let client: RoutingClient;
    const runtime = new SimulationRuntime({ graph, rounds: { [roundId]: config }, initialMetrics: () => metrics, clock,
      clientFactory: () => ({
        async sync(request, signal) {
          assert.equal(inFlight, 0); turnStarted = performance.now();
          const response = await client.sync(request, signal);
          assert.equal(response.status, 200);
          const body = response.body as { buildLatencyMs: number; turnId: number; worldVersion: number };
          assert.equal(body.turnId, request.turnId); assert.equal(body.worldVersion, request.baseWorldVersion + 1);
          buildMs.push(body.buildLatencyMs); return response;
        },
        status: (id, signal) => client.status(id, signal),
        async step(request, signal) {
          const started = performance.now(); inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
          try {
            const response = await client.step(request, signal);
            if (response.status !== 200) httpErrors++;
            return response;
          } finally {
            routeMs.push(signal.aborted ? 500 : performance.now() - started);
            if (signal.aborted) aborted++; inFlight--;
          }
        },
      }), syncTimeoutMs: 500, emitAlert: alert => alerts.push(alert), onFailure: event => failures.push(event) });
    const committed: TurnUpdate["world"][] = [];
    runtime.subscribeCommitted(world => {
      if (world.turnId > 0) { turnMs.push(performance.now() - turnStarted); committed.push(world); }
    });
    app.register(routingPlugin, { engine: new RouteEngine(graph), apiKey });
    app.register(simulatorPlugin, { runtime, apiKey }); app.register(realtimePlugin, { runtime });
    let socket: WebSocket | undefined;
    const started = performance.now();
    try {
      const url = await app.listen({ host: "127.0.0.1", port: 0 });
      client = createRoutingClient({ baseUrl: url, apiKey });
      socket = new WebSocket(url.replace("http://", "ws://") + "/ws");
      const updates: TurnUpdate[] = [];
      let waiting: (() => void) | undefined;
      socket.on("message", data => { updates.push(JSON.parse(data.toString()) as TurnUpdate); waiting?.(); });
      socket.on("error", () => {});
      await once(socket, "open");
      async function update(turnId: number) {
        const find = () => updates.find(value => value.world.turnId === turnId);
        if (!find()) await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => { waiting = undefined; reject(new Error(`Falta TURN_UPDATE ${turnId}`)); }, 5_000);
          waiting = () => { if (find()) { clearTimeout(timer); waiting = undefined; resolve(); } };
        });
        return find()!;
      }
      const initial = await fetch(`${url}/estado`); assert.equal(initial.status, 503); await initial.text();
      const response = await fetch(`${url}/simulador/iniciar`, { method: "POST",
        headers: { "content-type": "application/json", "x-api-key": apiKey },
        body: JSON.stringify({ gameId: `integration-fixture-${roundId}`, roundId, seed: "integration-only" }) });
      assert.equal(response.status, 202); await response.text();
      for (let turnId = 1; turnId <= 150; turnId++) {
        await clock.next(); // Liberar el cierre preparado antes de esperar su publicación.
        const message = await update(turnId); const world = message.world;
        assert.equal(message.event, "TURN_UPDATE"); assert.equal(world.worldVersion, turnId);
        assert.equal(world.survivors.length, config.survivorCount);
        assert.equal(world.status, turnId === 150 ? "completed" : "running");
        assert(world.survivors.every(s => s.nodeId === `N${turnId}`), "Un movimiento seguro por turno");
        assert.equal(world.metrics.deadlineMisses, 0);
        assert.equal(world.blockedEdges.length, config.eventPlan.filter(e => e.effectiveTurnId <= turnId).length);
        for (const blocked of world.blockedEdges) {
          assert.equal(blocked.edgeIds.length, 2);
          assert(blocked.edgeIds.every(id => graph.aristas.find(e => e.id === id)?.segmentoId === blocked.segmentoId));
        }
        const state = await fetch(`${url}/estado`); assert.equal(state.status, 200);
        assert.deepEqual(await state.json(), world, "GET y WS deben coincidir en todo el snapshot");
      }
      await runtime.whenStopped();
      assert.deepEqual(committed.map(w => w.turnId), Array.from({ length: 150 }, (_, i) => i + 1));
      assert.deepEqual(updates.map(u => u.world.turnId), Array.from({ length: 151 }, (_, i) => i));
      const final = runtime.getCommittedWorld()!;
      assert.equal(final.shelters[0].ocupantes.length, config.survivorCount / 2);
      assert.deepEqual([...final.shelters[0].ocupantes].sort(), config.survivorSpawns.slice(0, config.survivorCount / 2).map(s => s.id));
      assert.equal(final.survivors.filter(s => s.estado === "evacuado").length, config.survivorCount / 2);
      assert.equal(final.survivors.filter(s => s.estado === "vivo").length, config.survivorCount / 2);
      assert(final.pendingCityEvents.every(e => e.aplicado));
      assert.equal(routeMs.length, config.survivorCount * 150); assert.equal(maxInFlight, config.survivorCount);
      assert.equal(inFlight, 0); assert.equal(aborted, 0); assert.equal(httpErrors, 0);
      assert.deepEqual(failures, []); assert.deepEqual(alerts, []);
      const routes = distribution(routeMs);
      t.diagnostic(JSON.stringify({ kind: "synthetic-integration-only", roundId, survivors: config.survivorCount,
        turns: committed.length, clock: "accelerated-between-ticks", wallElapsedMs: Number((performance.now() - started).toFixed(3)),
        routes, maxInFlight, httpErrors, aborted, build: distribution(buildMs), turnFromSync: distribution(turnMs),
        observedDeadlineMisses: final.metrics.deadlineMisses, localP95Within150Ms: routes.p95Ms <= 150,
        officialAcceptance: false, telemetryIntegrated: false }));
    } finally { socket?.terminate(); await app.close(); }
  });
}
