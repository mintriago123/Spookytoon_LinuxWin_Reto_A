import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import WebSocket from "ws";
import { createBackendApp, startBackendServer } from "../src/server.ts";
import { createRoundPresets } from "../src/config/round-presets.ts";
import type { TurnUpdate, CommittedWorldSnapshot as WorldSnapshot } from "../src/modules/simulator/types.ts";

const apiKey = "backend-e2e-local-test-key";

test("CORS permite HTTP autenticado local/producción y rechaza orígenes no configurados", async () => {
  const { app } = await createBackendApp({ apiKey, logger: false, frontendOrigin: "https://demo.example.test" });
  try {
    for (const origin of ["http://localhost:5173", "http://localhost:3000", "https://demo.example.test"]) {
      const response = await app.inject({ method: "OPTIONS", url: "/simulador/iniciar", headers: {
        origin, "access-control-request-method": "POST", "access-control-request-headers": "content-type,x-api-key",
      } });
      assert.equal(response.statusCode, 204);
      assert.equal(response.headers["access-control-allow-origin"], origin);
      assert.match(String(response.headers["access-control-allow-headers"]), /x-api-key/i);
      assert.match(String(response.headers["access-control-allow-methods"]), /POST/);
    }
    assert.equal((await app.inject({ method: "GET", url: "/estado", headers: { origin: "https://unknown.example" } })).statusCode, 403);
    assert.equal((await app.inject({ method: "POST", url: "/simulador/iniciar", payload: {} })).statusCode, 401);
  } finally { await app.close(); }
  const open = await createBackendApp({ apiKey, logger: false, frontendOrigin: "*" });
  try {
    assert.equal((await open.app.inject({ method: "OPTIONS", url: "/simulador/iniciar", headers: { origin: "https://other.example" } })).statusCode, 204);
  } finally { await open.app.close(); }
});

for (const roundId of [1, 2, 3] as const) {
  test(`R${roundId}: startBackendServer mueve entidades y publica métricas iguales por HTTP/WS con reloj real`, { timeout: 20_000 }, async t => {
    const { app, engine, graph, simulator } = await startBackendServer({ apiKey, port: 0, logger: false,
      frontendOrigin: "https://demo.example.test" });
    const address = app.server.address();
    assert(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const origin = ["http://localhost:5173", "https://demo.example.test", "http://localhost:3000"][roundId - 1];
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`, { origin });
    const worlds: WorldSnapshot[] = [];
    const observers = new Set<(world: WorldSnapshot) => void>();
    socket.on("message", data => {
      const message = JSON.parse(data.toString()) as TurnUpdate;
      if (message.event === "TURN_UPDATE") {
        worlds.push(message.world);
        if (message.world.status === "paused" && message.world.metrics.deadlineMisses > 0) {
          t.diagnostic(JSON.stringify({ roundId, timing: simulator.getLastTurnTiming() }));
        }
        for (const observer of observers) observer(message.world);
      }
    });
    function waitFor(turnId: number, status = "running"): Promise<WorldSnapshot> {
      const deadlineFailure = (world: WorldSnapshot) => world.turnId === turnId && status === "running" &&
        world.status === "paused" && world.metrics.deadlineMisses > 0;
      const failure = () => new Error(`El turno ${turnId} pausó por incumplimiento: ${JSON.stringify(simulator.getLastTurnTiming())}`);
      if (worlds.some(deadlineFailure)) return Promise.reject(failure());
      const existing = worlds.find(world => world.turnId === turnId && world.status === status);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { observers.delete(observer); reject(new Error(`No llegó WS turno ${turnId} ${status}`)); }, 8_000);
        const observer = (world: WorldSnapshot) => {
          if (deadlineFailure(world)) { clearTimeout(timer); observers.delete(observer); reject(failure()); return; }
          if (world.turnId !== turnId || world.status !== status) return;
          clearTimeout(timer); observers.delete(observer); resolve(world);
        };
        observers.add(observer);
      });
    }
    async function control(path: string, payload: unknown) {
      const response = await fetch(`${base}${path}`, { method: "POST", headers: {
        origin, "content-type": "application/json", "x-api-key": apiKey,
      }, body: JSON.stringify(payload) });
      const body = await response.json();
      assert.equal(response.status, 202, JSON.stringify(body));
      assert.equal(response.headers.get("access-control-allow-origin"), origin);
      return body;
    }
    try {
      await once(socket, "open");
      const gameId = `manta-smoke-r${roundId}`;
      await control("/simulador/iniciar", { gameId, roundId, seed: "manta-smoke" });
      const initial = await waitFor(0);
      assert.equal(initial.survivors.length, [20, 80, 200][roundId - 1]);
      assert.equal(initial.metrics.activeSurvivors, initial.survivors.length);
      assert.equal(initial.metrics.wsClients, 1);
      assert.equal(initial.metrics.routeSamples, 0);
      const beforeTick = await fetch(`${base}/estado`).then(response => response.json()) as WorldSnapshot;
      assert.equal(beforeTick.turnId, 0);

      const events = createRoundPresets(graph)[roundId].eventPlan;
      for (const [index, event] of events.entries()) {
        await control("/simulador/bloquear-arista", { eventId: `live-${roundId}-${index}`, edgeId: event.edgeId,
          bloqueada: true, motivo: "Verificación de bloqueo en vivo", effectiveTurnId: 2 });
      }
      let previous = initial;
      let movementCount = 0;
      for (const turn of [1, 2, 3]) {
        const world = await waitFor(turn);
        const response = await fetch(`${base}/estado`, { headers: { origin } });
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), world);
        const prior = new Map(previous.survivors.map(survivor => [survivor.id, survivor.nodeId]));
        movementCount += world.survivors.filter(survivor => survivor.nodeId !== prior.get(survivor.id)).length;
        assert.equal(world.metrics.activeSurvivors, world.survivors.filter(survivor => survivor.estado === "vivo").length);
        assert.equal(world.metrics.bittenSurvivors, world.survivors.filter(survivor => survivor.estado === "mordido").length);
        assert.equal(world.metrics.evacuatedSurvivors, world.survivors.filter(survivor => survivor.estado === "evacuado").length);
        assert.equal(world.metrics.activeSurvivors + world.metrics.bittenSurvivors + world.metrics.evacuatedSurvivors, initial.survivors.length);
        assert(world.metrics.routeSamples > 0);
        assert(world.metrics.routeLatencyP95Ms > 0);
        assert.equal(world.metrics.routeAvailabilityPercent, 100);
        assert.equal(world.metrics.deadlineMisses, 0);
        assert.equal(world.metrics.turnEfficiencyPercent, 100);
        assert(world.metrics.turnDurationMs! > 0 && world.metrics.turnDurationMs! < 2_000);
        assert(world.shelters.every(shelter => shelter.capacidad === 60 && shelter.ocupantes.length + shelter.reservados.length <= 60));
        const installed = engine.getStatus(gameId).installed!;
        // WS es posterior al commit: el cálculo siguiente puede haber sincronizado.
        assert(installed.turnId === turn || installed.turnId === turn + 1);
        assert.equal(installed.worldVersion, installed.turnId);
        assert.equal(installed.graphVersion, world.graphVersion);
        assert(world.survivors.some(survivor => survivor.targetShelterId !== null));
        if (turn >= 2) assert.equal(world.blockedEdges.filter(block => block.desbloqueadaEnTurno === null).length, events.length);
        previous = world;
      }
      assert(movementCount > 0, "Los sobrevivientes deben cambiar de nodo");
      const pausing = await control("/simulador/pausar", { reason: "Fin de prueba de humo" });
      assert(pausing.afterTurnId === 3 || pausing.afterTurnId === 4);
      const paused = await waitFor(pausing.afterTurnId, "paused");
      assert.equal(paused.worldVersion, previous.worldVersion + pausing.afterTurnId - 3);
      t.diagnostic(JSON.stringify({ roundId, survivors: initial.survivors.length, turns: 3, movements: movementCount,
        p95Ms: previous.metrics.routeLatencyP95Ms, availability: previous.metrics.routeAvailabilityPercent,
        evacuated: previous.metrics.evacuatedSurvivors, bitten: previous.metrics.bittenSurvivors,
        deadlineMisses: previous.metrics.deadlineMisses }));
    } finally { socket.terminate(); await app.close(); }
  });
}
