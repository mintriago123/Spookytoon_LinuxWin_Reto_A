import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createRoundPresets } from "../src/config/round-presets.ts";
import { loadGraph } from "../src/modules/graph/load-graph.ts";
import { RouteEngine } from "../src/modules/routing/route-engine.ts";
import { createBackendApp } from "../src/server.ts";
import { detectCameraObservations, parseCameraFixture } from "../src/modules/simulator/camera-surveillance.ts";
import { buildWorldSyncRequest } from "../src/modules/simulator/routing-world.ts";
import { createWorldSnapshot } from "../src/modules/simulator/world-snapshot.ts";
import { createInitialTelemetryMetrics, createWorldState } from "../src/modules/simulator/world-state.ts";

const { graph } = await loadGraph();
const rounds = createRoundPresets(graph);
const fixture = JSON.parse(await readFile(new URL("../data/camaras_ojos_de_aguila.manta.json", import.meta.url), "utf8")) as unknown;
const cameras = parseCameraFixture(fixture, graph);

function makeWorld() {
  return createWorldState({ gameId: "camera-sim-test", graph, roundConfig: rounds[1], cameras,
    initialMetrics: createInitialTelemetryMetrics(rounds[1]), updatedAt: "2026-10-28T00:00:00.000Z",
    randomState: { seed: "camera-test", algorithm: "sha256-counter", algorithmVersion: "1", strategy: "per-zombie-turn-draw" } });
}

test("fixture conserva referencias aproximadas, habilita tres sensores y excluye Paquisha", () => {
  assert.equal(cameras.length, 4);
  assert.equal(cameras.filter(camera => camera.enabled).length, 3);
  assert.equal(cameras.find(camera => camera.name.includes("Paquisha"))?.status, "reference-only-outside-current-graph");
});

test("snapshot publica metadatos simulados y solo observaciones aún vigentes", () => {
  const world = makeWorld();
  const camera = cameras[0];
  world.turnId = 5;
  world.cameraObservations = [
    { cameraId: camera.id, zombieId: "z1", nodeId: camera.nodeId!, detectedTurnId: 4, expiresAfterTurnId: 6 },
    { cameraId: camera.id, zombieId: "z2", nodeId: camera.nodeId!, detectedTurnId: 3, expiresAfterTurnId: 5 },
  ];
  const snapshot = createWorldSnapshot(world);
  assert.equal(snapshot.cameras.length, 4);
  assert.equal(snapshot.cameras[0].status, "simulated");
  assert.deepEqual(snapshot.cameraObservations.map(item => item.zombieId), ["z1"]);
});

test("composition root incorpora el fixture en el snapshot inicial del simulador", async () => {
  const { app, simulator } = await createBackendApp({ apiKey: "camera-simulation-test-key", logger: false });
  try {
    await app.ready();
    simulator.start({ gameId: "camera-http-test", roundId: 1, seed: "camera-test" });
    const snapshot = simulator.getCommittedSnapshot()!;
    assert.equal(snapshot.cameras.length, 4);
    assert.equal(snapshot.cameraObservations.length, 0);
    const response = await app.inject("/estado");
    assert.equal(response.statusCode, 200);
    assert.equal((response.json() as typeof snapshot).cameras.length, 4);
  } finally { await app.close(); }
});

test("detección simulada se limita a zombies activos y vence con TTL exclusivo", () => {
  const world = makeWorld();
  const camera = cameras.find(item => item.enabled)!;
  world.zombies = [{ ...world.zombies[0], estado: "activo", nodeId: camera.nodeId! }];
  const detected = detectCameraObservations(world, 12);
  assert.deepEqual(detected.map(item => [item.cameraId, item.zombieId, item.nodeId, item.expiresAfterTurnId]),
    [[camera.id, world.zombies[0].id, camera.nodeId, 14]]);
  world.cameraObservations = detected;
  const zombie = world.zombies[0];
  world.zombies = [];
  assert.equal(detectCameraObservations(world, 13).length, 1);
  assert.equal(detectCameraObservations(world, 14).length, 0);
  world.cameraObservations = [];
  world.zombies = [{ ...zombie, estado: "dormido", nodeId: camera.nodeId! }];
  assert.equal(detectCameraObservations(world, 12).length, 0);
});

test("una observación vigente se instala en routing y cambia el plan del nodo señalado", () => {
  const world = makeWorld();
  world.zombies = world.zombies.slice(0, 1).map(zombie => ({ ...zombie, estado: "activo" }));
  const request = buildWorldSyncRequest(world, 1);
  const withoutEngine = new RouteEngine(graph); withoutEngine.sync({ ...request, cameraObservations: [] });
  const withoutPlan = withoutEngine.getPlan(world.gameId)!.bestMoveByNode;
  const survivorNode = world.survivors[0].nodeId;
  const targetNode = withoutPlan[survivorNode].toNodeId;
  assert(targetNode);
  request.cameraObservations = [{ cameraId: cameras[0].id, zombieId: world.zombies[0].id,
    nodeId: targetNode, detectedTurnId: 1, expiresAfterTurnId: 3 }];
  const withEngine = new RouteEngine(graph); withEngine.sync(request);
  const withPlan = withEngine.getPlan(world.gameId)!.bestMoveByNode;
  assert.notDeepEqual(withPlan[survivorNode], withoutPlan[survivorNode]);
  const expired = { ...request, turnId: 3, cameraObservations: [] };
  const expiredEngine = new RouteEngine(graph); expiredEngine.sync(expired);
  assert.deepEqual(expiredEngine.getPlan(world.gameId)!.bestMoveByNode, withoutPlan);
});
