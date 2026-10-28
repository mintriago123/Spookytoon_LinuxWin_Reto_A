import assert from "node:assert/strict";
import { test } from "node:test";
import { createBackendApp } from "../src/server.ts";
import { InMemoryPersistenceAdapter } from "../src/modules/persistence/index.ts";
import { RoutingWorkerPool } from "../src/modules/routing/worker-pool.ts";
import { RouteEngine } from "../src/modules/routing/route-engine.ts";
import { loadGraph } from "../src/modules/graph/load-graph.ts";
import { createRoundPresets } from "../src/config/round-presets.ts";
import { createInitialTelemetryMetrics, createWorldState } from "../src/modules/simulator/world-state.ts";
import { buildWorldSyncRequest } from "../src/modules/simulator/routing-world.ts";

test("readiness 200 antes de sincronizar; pierde readiness si el pool deja de operar", async () => {
  const { app, workers, engine } = await createBackendApp({ apiKey: "workers-readiness-key", logger: false });
  try {
    assert.equal((await app.inject("/health/ready")).statusCode, 200);
    assert.equal(engine.isReady(), false, "No existe plan de partida, pero el servicio está preparado");
    assert.deepEqual((await app.inject("/estado")).json(), { status: "idle" });
    await workers.close();
    assert.equal((await app.inject("/health/ready")).statusCode, 503);
    assert.equal((await app.inject("/health/live")).statusCode, 200);
  } finally { await app.close(); }
});

test("fallo de inicialización de persistencia no produce falso ready", async () => {
  const persistence = new InMemoryPersistenceAdapter();
  persistence.initialize = async () => { throw new Error("table unavailable"); };
  const { app, workers } = await createBackendApp({ apiKey: "workers-readiness-key", logger: false, persistence });
  try { await assert.rejects(async () => { await app.ready(); }, /table unavailable/); assert.equal(workers.isReady(), false); }
  finally { await app.close(); }
});

test("dos workers calculan plan equivalente, lookup queda local y cola responde 429", async () => {
  const { graph } = await loadGraph(); const config = createRoundPresets(graph)[3];
  const world = createWorldState({ graph, gameId: "workers-fixture", roundConfig: config,
    randomState: { seed: "workers", algorithm: "sha256-counter", algorithmVersion: "1", strategy: "per-zombie-turn-draw" },
    initialMetrics: createInitialTelemetryMetrics(config), updatedAt: "2026-10-28T00:00:00.000Z" });
  const pool = new RoutingWorkerPool(graph, { size: 2, queueLimit: 1 });
  try {
    await pool.initialize(); const request = buildWorldSyncRequest(world, 1);
    const pending = pool.compute(request);
    await assert.rejects(pool.compute(request), (e: any) => e.status === 429);
    const computed = await pending;
    const engine = new RouteEngine(graph, { workerCount: 2 });
    const sync = engine.sync(request, computed); assert.equal(sync.workerCount, 2);
    assert(Object.isFrozen(engine.getPlan(world.gameId)!.bestMoveByNode));
    const reference = new RouteEngine(graph); reference.sync(request);
    assert.deepEqual(engine.getPlan(world.gameId)!.bestMoveByNode, reference.getPlan(world.gameId)!.bestMoveByNode);
    await pool.close();
    for (const survivor of world.survivors) {
      const req = { gameId: world.gameId, turnId: 1, worldVersion: 1, survivorId: survivor.id, currentNodeId: survivor.nodeId };
      const { latencyMs: _a, ...actual } = engine.step(req);
      const { latencyMs: _b, ...expected } = reference.step(req);
      assert.deepEqual(actual, expected);
    }
    assert.deepEqual(engine.sync(request), sync);
    assert.throws(() => engine.sync({ ...request, baseWorldVersion: 100 }));
  } finally { await pool.close(); }
});


test("configuración inválida del pool HTTP falla antes de readiness", async () => {
  await assert.rejects(createBackendApp({ apiKey: "workers-readiness-key", logger: false, routingMaxSockets: 0 }), /ROUTING_HTTP_MAX_SOCKETS/);
});
