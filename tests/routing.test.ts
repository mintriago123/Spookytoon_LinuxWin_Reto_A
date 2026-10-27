import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadGraph } from "../backend/src/modules/graph/load-graph.ts";
import { RouteEngine } from "../backend/src/modules/routing/route-engine.ts";
import { createRoutingApp } from "../backend/src/modules/routing/http-server.ts";
import { RoutingError, type WorldSyncRequest } from "../backend/src/contracts/routing.ts";
import type { MantaGraph } from "../backend/src/contracts/types.ts";
import { createBackendApp } from "../backend/src/server.ts";

const secret = "test-routing-secret-value";

async function realGraph() {
  const manifest = JSON.parse(await readFile(new URL("../backend/data/graph-manifest.json", import.meta.url), "utf8")) as {
    graphVersion: string; sha256: string;
  };
  return (await loadGraph(new URL("../backend/data/grafo_manta.json", import.meta.url), manifest)).graph;
}

function twoStepCorridorGraph(): MantaGraph {
  const nodes = ["A", "B", "C"].map((id, index) => ({ id, lat: -0.95, lng: -80.71 + index * 0.001, zona: "Tarqui" as const }));
  const edge = (id: string, segment: string, origen: string, destino: string) => ({
    id, segmentoId: segment, origen, destino, distancia_m: 10, tipo: "calle" as const, factor_velocidad: 1,
  });
  return {
    schemaVersion: "1.0.0",
    metadata: { ciudad: "Manta", graphVersion: "corridor-test", generatedAt: "2026-10-27T00:00:00.000Z",
      source: "OpenStreetMap", osmAttribution: "© OpenStreetMap contributors" },
    nodos: nodes,
    aristas: [edge("ab", "AB", "A", "B"), edge("ba", "AB", "B", "A"),
      edge("bc", "BC", "B", "C"), edge("cb", "BC", "C", "B")],
    refugios: [{ id: "R-A", nodoId: "A", capacidad: 60 }],
  };
}

function syncRequest(graph: Awaited<ReturnType<typeof realGraph>>, count = 1): WorldSyncRequest {
  const shelterNodeIds = new Set(graph.refugios.map(shelter => shelter.nodoId));
  const startNodes = graph.nodos.filter(node => !shelterNodeIds.has(node.id));
  return {
    gameId: "game-routing-test", turnId: 1, baseWorldVersion: 0,
    survivors: Array.from({ length: count }, (_, index) => ({
      id: `S-${index.toString().padStart(3, "0")}`, nodeId: startNodes[index % startNodes.length].id,
      estado: "vivo" as const, targetShelterId: null, eliminadoEnTurno: null, evacuadoEnTurno: null,
    })),
    zombies: [],
    shelters: graph.refugios.map(shelter => ({ ...shelter, ocupantes: [], reservados: [] })),
    blockedEdges: [], zombieTraversals: [], dormantUncertaintyNodeIds: [],
  };
}

async function withApp(engine: RouteEngine, run: (app: Awaited<ReturnType<typeof createRoutingApp>>) => Promise<void>) {
  const app = await createRoutingApp({ engine, apiKey: secret });
  try { await app.ready(); await run(app); }
  finally { await app.close(); }
}

test("grafo peatonal publicado tiene bidireccionalidad, un SCC y refugios alcanzables desde todo nodo", async () => {
  const graph = await realGraph();
  const directed = new Set(graph.aristas.map(edge => `${edge.origen}\0${edge.destino}`));
  for (const edge of graph.aristas) assert(directed.has(`${edge.destino}\0${edge.origen}`), `Falta reversa de ${edge.id}`);
  const outgoing = new Map(graph.nodos.map(node => [node.id, [] as string[]]));
  for (const edge of graph.aristas) outgoing.get(edge.origen)!.push(edge.destino);
  const refugeIds = new Set(graph.refugios.map(shelter => shelter.nodoId));
  for (const start of graph.nodos) {
    const visited = new Set([start.id]); const queue = [start.id];
    for (let index = 0; index < queue.length; index++) for (const next of outgoing.get(queue[index])!) {
      if (!visited.has(next)) { visited.add(next); queue.push(next); }
    }
    assert.equal(visited.size, graph.nodos.length, `El componente desde ${start.id} no es fuerte`);
    for (const refugeId of refugeIds) assert(visited.has(refugeId), `${start.id} no alcanza ${refugeId}`);
  }
  assert.equal(graph.refugios.reduce((sum, shelter) => sum + shelter.capacidad, 0), 240);
});

test("sincroniza plan completo, respeta idempotencia y /paso hace lookup seguro", async () => {
  const graph = await realGraph(); const engine = new RouteEngine(graph); const body = syncRequest(graph, 4);
  const sync = engine.sync(body);
  assert.deepEqual(engine.sync(body), sync);
  const plan = engine.getPlan(body.gameId)!;
  assert.equal(Object.keys(plan.bestMoveByNode).length, graph.nodos.length);
  for (const shelter of body.shelters) {
    const entry = plan.bestMoveByNode[shelter.nodoId];
    assert.equal(entry.decision, "esperar"); assert.equal(entry.edgeId, null);
    assert.equal(entry.routeCost, null); assert.equal(entry.targetShelterId, shelter.id);
  }
  const edgeById = new Map(graph.aristas.map(edge => [edge.id, edge]));
  for (const entry of Object.values(plan.bestMoveByNode)) if (entry.edgeId) {
    const edge = edgeById.get(entry.edgeId)!;
    assert.equal(edge.origen, entry.fromNodeId); assert.equal(edge.destino, entry.toNodeId);
  }
  const survivor = body.survivors[0];
  const step = engine.step({ gameId: body.gameId, turnId: 1, worldVersion: 1, survivorId: survivor.id,
    currentNodeId: survivor.nodeId });
  assert.equal(step.fromNodeId, survivor.nodeId);
  assert(step.toNodeId === survivor.nodeId || graph.aristas.some(edge => edge.id === step.edgeId &&
    edge.origen === step.fromNodeId && edge.destino === step.toNodeId));
  (engine as unknown as { isSafeEntry: () => boolean }).isSafeEntry = () => false;
  const fallback = engine.step({ gameId: body.gameId, turnId: 1, worldVersion: 1, survivorId: survivor.id,
    currentNodeId: survivor.nodeId });
  assert.equal(fallback.toNodeId, survivor.nodeId); assert.equal(fallback.reason, "fallback-interno");
  const changed = structuredClone(body); changed.zombies.push({ id: "Z-1", tipo: "caminante", estado: "activo",
    nodeId: graph.nodos[10].id, despertadoEnTurno: null, siguienteMovimientoTurno: null });
  assert.throws(() => engine.sync(changed), (error: unknown) => error instanceof RoutingError && error.status === 409);
  const skippedTurn = structuredClone(body); skippedTurn.turnId = 3; skippedTurn.baseWorldVersion = 1;
  const skippedSync = engine.sync(skippedTurn);
  assert.equal(skippedSync.turnId, 3); assert.equal(skippedSync.worldVersion, 2);
  assert.deepEqual(engine.getStatus(body.gameId), { gameId: body.gameId, installed: skippedSync });
});

test("capacidad excluye refugios llenos y sin plazas devuelve espera segura", async () => {
  const graph = await realGraph(); const allSurvivors: WorldSyncRequest["survivors"] = [];
  const request = syncRequest(graph);
  const availableShelterId = graph.refugios[0].id;
  for (const shelter of request.shelters) {
    if (shelter.id === availableShelterId) continue;
    for (let index = 0; index < shelter.capacidad; index++) {
      const id = `ev-${shelter.id}-${index}`;
      allSurvivors.push({ id, nodeId: graph.nodos[index].id, estado: "evacuado", targetShelterId: shelter.id,
        eliminadoEnTurno: null, evacuadoEnTurno: 1 });
      shelter.ocupantes.push(id);
    }
  }
  request.survivors.push(...allSurvivors);
  const engine = new RouteEngine(graph); engine.sync(request);
  for (const entry of Object.values(engine.getPlan(request.gameId)!.bestMoveByNode)) assert.equal(entry.targetShelterId, availableShelterId);

  const full = syncRequest(graph); full.survivors = [];
  for (const shelter of full.shelters) for (let index = 0; index < shelter.capacidad; index++) {
    const id = `full-${shelter.id}-${index}`;
    full.survivors.push({ id, nodeId: graph.nodos[index].id, estado: "evacuado", targetShelterId: shelter.id,
      eliminadoEnTurno: null, evacuadoEnTurno: 1 }); shelter.ocupantes.push(id);
  }
  const noCapacity = new RouteEngine(graph); noCapacity.sync(full);
  assert(Object.values(noCapacity.getPlan(full.gameId)!.bestMoveByNode).every(entry =>
    entry.reason === "no-hay-refugio-disponible" && entry.toNodeId === entry.fromNodeId));
});

test("bloqueos de segmento se aplican al plan y la incertidumbre añade coste blando", async () => {
  const graph = await realGraph(); const refugeNodes = new Set(graph.refugios.map(shelter => shelter.nodoId));
  const start = graph.nodos.find(node => !refugeNodes.has(node.id) && graph.aristas.some(edge => edge.origen === node.id))!;
  const edge = graph.aristas.find(candidate => candidate.origen === start.id && !refugeNodes.has(candidate.destino))!;
  const segmentEdges = graph.aristas.filter(candidate => candidate.segmentoId === edge.segmentoId).map(candidate => candidate.id);
  const blockedRequest = syncRequest(graph); blockedRequest.survivors[0].nodeId = start.id;
  blockedRequest.blockedEdges = [{ segmentoId: edge.segmentoId, edgeIds: segmentEdges, motivo: "calle cerrada",
    origen: "evento-ciudad", bloqueadaDesdeTurno: 1, desbloqueadaEnTurno: null }];
  const partialBlock = structuredClone(blockedRequest); partialBlock.blockedEdges[0].edgeIds = [edge.id];
  assert.throws(() => new RouteEngine(graph).sync(partialBlock),
    (error: unknown) => error instanceof RoutingError && error.status === 400);
  const blockedEngine = new RouteEngine(graph); blockedEngine.sync(blockedRequest);
  assert.notEqual(blockedEngine.getPlan(blockedRequest.gameId)!.bestMoveByNode[start.id].edgeId, edge.id);

  const plainRequest = syncRequest(graph); plainRequest.survivors[0].nodeId = start.id;
  const plainEngine = new RouteEngine(graph); plainEngine.sync(plainRequest);
  const baseline = plainEngine.getPlan(plainRequest.gameId)!.bestMoveByNode[start.id].routeCost!;
  const uncertainRequest = structuredClone(plainRequest);
  uncertainRequest.dormantUncertaintyNodeIds = graph.nodos.map(node => node.id);
  const uncertainEngine = new RouteEngine(graph); uncertainEngine.sync(uncertainRequest);
  const penalized = uncertainEngine.getPlan(uncertainRequest.gameId)!.bestMoveByNode[start.id].routeCost!;
  assert(penalized > baseline);

  const corridorNode = graph.nodos.find(node => node.id !== start.id && !refugeNodes.has(node.id))!;
  const corridorRequest = syncRequest(graph); corridorRequest.survivors[0].nodeId = start.id;
  corridorRequest.zombies = [{ id: "C-1", tipo: "corredor", estado: "activo", nodeId: corridorNode.id,
    despertadoEnTurno: null, siguienteMovimientoTurno: null }];
  const corridorEngine = new RouteEngine(graph); corridorEngine.sync(corridorRequest);
  const corridorCost = corridorEngine.getPlan(corridorRequest.gameId)!.bestMoveByNode[start.id].routeCost!;
  assert(corridorCost >= baseline);
});

test("hordas bloquean nodo y vecinos; el cruce frontal se excluye del primer paso", async () => {
  const graph = await realGraph(); const shelterNodes = new Set(graph.refugios.map(shelter => shelter.nodoId));
  const outgoing = new Map(graph.nodos.map(node => [node.id, graph.aristas.filter(edge => edge.origen === node.id)]));
  const hordeNode = graph.nodos.find(node => !shelterNodes.has(node.id) && (outgoing.get(node.id)?.length ?? 0) > 2)!.id;
  const body = syncRequest(graph);
  const walkerNode = graph.nodos.find(node => !shelterNodes.has(node.id) && node.id !== hordeNode &&
    !outgoing.get(hordeNode)!.some(edge => edge.destino === node.id))!.id;
  body.zombies = [
    { id: "H-1", tipo: "horda", estado: "activo", nodeId: hordeNode, despertadoEnTurno: null, siguienteMovimientoTurno: null },
    { id: "Z-1", tipo: "caminante", estado: "activo", nodeId: walkerNode, despertadoEnTurno: null, siguienteMovimientoTurno: null },
  ];
  const hordeArea = new Set([hordeNode, ...outgoing.get(hordeNode)!.map(edge => edge.destino),
    ...graph.aristas.filter(edge => edge.destino === hordeNode).map(edge => edge.origen)]);
  hordeArea.add(walkerNode);
  const engine = new RouteEngine(graph); engine.sync(body);
  for (const entry of Object.values(engine.getPlan(body.gameId)!.bestMoveByNode)) if (entry.decision === "mover") {
    assert(!hordeArea.has(entry.toNodeId));
  }

  const originEdge = graph.aristas.find(edge => !shelterNodes.has(edge.origen) && !shelterNodes.has(edge.destino) &&
    outgoing.get(edge.origen)!.length > 1)!;
  const cross = syncRequest(graph);
  cross.survivors[0].nodeId = originEdge.origen;
  cross.zombies = [{ id: "Z-cross", tipo: "caminante", estado: "activo", nodeId: originEdge.origen,
    despertadoEnTurno: null, siguienteMovimientoTurno: null }];
  const reverseEdge = graph.aristas.find(edge => edge.origen === originEdge.destino && edge.destino === originEdge.origen)!;
  cross.zombieTraversals = [{ zombieId: "Z-cross", stepIndex: 1, edgeId: reverseEdge.id,
    fromNodeId: originEdge.destino, toNodeId: originEdge.origen }];
  const crossingEngine = new RouteEngine(graph); crossingEngine.sync(cross);
  const entry = crossingEngine.getPlan(cross.gameId)!.bestMoveByNode[originEdge.origen];
  assert.notEqual(entry.edgeId, originEdge.id);
});

test("acepta los dos recorridos ordenados de un corredor y bloquea ambos cruces frontales", () => {
  const graph = twoStepCorridorGraph();
  const request: WorldSyncRequest = {
    gameId: "two-step-corridor", turnId: 1, baseWorldVersion: 0,
    survivors: [{ id: "S-1", nodeId: "C", estado: "vivo", targetShelterId: null,
      eliminadoEnTurno: null, evacuadoEnTurno: null }],
    zombies: [{ id: "C-1", tipo: "corredor", estado: "activo", nodeId: "C",
      despertadoEnTurno: null, siguienteMovimientoTurno: null }],
    shelters: graph.refugios.map(shelter => ({ ...shelter, ocupantes: [], reservados: [] })),
    blockedEdges: [],
    zombieTraversals: [
      { zombieId: "C-1", stepIndex: 1, edgeId: "ab", fromNodeId: "A", toNodeId: "B" },
      { zombieId: "C-1", stepIndex: 2, edgeId: "bc", fromNodeId: "B", toNodeId: "C" },
    ],
    dormantUncertaintyNodeIds: [],
  };
  const engine = new RouteEngine(graph);
  engine.sync(request);
  const move = engine.getPlan(request.gameId)!.bestMoveByNode.C;
  assert.equal(move.toNodeId, "C");
  assert.equal(move.edgeId, null);

  const discontinuous = structuredClone(request);
  discontinuous.zombieTraversals[1].fromNodeId = "A";
  assert.throws(() => new RouteEngine(graph).sync(discontinuous),
    (error: unknown) => error instanceof RoutingError && error.status === 400);
});

test("Fastify exige x-api-key, reconcilia estado y devuelve una respuesta vecina", async () => {
  const graph = await realGraph(); const engine = new RouteEngine(graph); const body = syncRequest(graph, 1);
  await withApp(engine, async app => {
    assert.equal((await app.inject({ method: "GET", url: "/health/ready" })).statusCode, 503);
    assert.equal((await app.inject({ method: "POST", url: "/motor/sincronizar", payload: body })).statusCode, 401);
    assert.equal((await app.inject({ method: "GET", url: `/motor/estado/${body.gameId}` })).statusCode, 401);
    const syncResponse = await app.inject({ method: "POST", url: "/motor/sincronizar", payload: body,
      headers: { "x-api-key": secret } });
    assert.equal(syncResponse.statusCode, 200);
    const syncResult = syncResponse.json() as { turnId: number; worldVersion: number; graphVersion: string; buildLatencyMs: number };
    assert.equal(syncResult.graphVersion, graph.metadata.graphVersion);
    assert(syncResult.buildLatencyMs >= 0);
    const status = await app.inject({ method: "GET", url: `/motor/estado/${body.gameId}`,
      headers: { "x-api-key": secret } });
    assert.deepEqual(status.json(), { gameId: body.gameId, installed: syncResult });
    const step = await app.inject({ method: "POST", url: "/paso", payload: {
      gameId: body.gameId, turnId: 1, worldVersion: syncResult.worldVersion, survivorId: body.survivors[0].id,
      currentNodeId: body.survivors[0].nodeId,
    }, headers: { "x-api-key": secret } });
    assert.equal(step.statusCode, 200);
    const response = step.json() as { fromNodeId: string; toNodeId: string; edgeId: string | null };
    assert(response.toNodeId === response.fromNodeId || graph.aristas.some(edge => edge.id === response.edgeId &&
      edge.origen === response.fromNodeId && edge.destino === response.toNodeId));
    assert.equal((await app.inject({ method: "GET", url: "/health/ready" })).statusCode, 200);
  });
});

test("composition root carga el grafo y registra routing en la aplicación compartida", async () => {
  const { app, engine, graph } = await createBackendApp({ apiKey: secret });
  try {
    const response = await app.inject({ method: "GET", url: "/health/live" });
    assert.equal(response.statusCode, 200);
    assert.equal(engine.graph.metadata.graphVersion, graph.metadata.graphVersion);
  } finally {
    await app.close();
  }
});
