import assert from "node:assert/strict";
import { test } from "node:test";
import type { MantaGraph } from "../backend/src/contracts/types.ts";
import type { RoundConfig, RoundId, TelemetryMetrics } from "../backend/src/modules/simulator/types.ts";
import { validateRoundConfig } from "../backend/src/modules/simulator/round-validation.ts";
import { createWorldState } from "../backend/src/modules/simulator/world-state.ts";

// Fixtures unitarias mínimas; no representan un escenario aprobado ni se usan para iniciar rondas.
function graph(): MantaGraph {
  const pairs = [
    ["AB", "A", "B", "calle"], ["BC", "B", "C", "puente"],
    ["CD", "C", "D", "calle"], ["BH", "B", "H", "calle"],
  ] as const;
  return {
    schemaVersion: "1.0.0", metadata: { ciudad: "Manta", graphVersion: "unit-test",
      generatedAt: "2026-10-27T00:00:00Z", source: "OpenStreetMap", osmAttribution: "test" },
    nodos: ["A", "B", "C", "D", "H", "R", "Q"].map(id => ({ id, lat: 0, lng: 0, zona: "Tarqui" })),
    aristas: pairs.flatMap(([segmentoId, from, to, tipo]) => [[from, to], [to, from]].map(([origen, destino], index) => ({
      id: `${segmentoId}-${index}`, segmentoId, origen, destino, tipo,
      distancia_m: 1, factor_velocidad: tipo === "puente" ? 0.9 : 0.8,
    }))),
    refugios: [{ id: "REF", nodoId: "R", capacidad: 60 }],
  };
}
function config(roundId: RoundId = 1): RoundConfig {
  const survivorCount = roundId === 1 ? 20 : roundId === 2 ? 80 : 200;
  return {
    roundId, durationMs: 300_000, turnIntervalMs: 2_000, turnCount: 150, survivorCount,
    survivorSpawns: Array.from({ length: survivorCount }, (_, i) => ({ id: `S-${i}`, nodeId: "A" })),
    zombieSpawns: [
      { id: "Z-walk", tipo: "caminante", nodeId: "C" },
      ...(roundId >= 2 ? [
        { id: "Z-run", tipo: "corredor" as const, nodeId: "D" },
        { id: "Z-horde", tipo: "horda" as const, nodeId: "H" },
      ] : []),
      ...(roundId === 3 ? [{ id: "Z-sleep", tipo: "dormido" as const, nodeId: "Q" }] : []),
    ],
    eventPlan: roundId === 1 ? [] : roundId === 2
      ? [{ eventId: "bridge", edgeId: "BC-0", effectiveTurnId: 1, reason: "colapso-puente" }]
      : [
          { eventId: "street-1", edgeId: "AB-0", effectiveTurnId: 1, reason: "bloqueo-calle" },
          { eventId: "street-2", edgeId: "CD-0", effectiveTurnId: 150, reason: "bloqueo-calle" },
        ],
  };
}
function metrics(roundId: RoundId = 1): TelemetryMetrics {
  return { routeSamples: 0, routeLatencyP50Ms: 0, routeLatencyP95Ms: 0, routeLatencyP99Ms: 0,
    routeTimeouts: 0, invalidRouteResponses: 0, deadlineMisses: 0,
    activeSurvivors: roundId === 1 ? 20 : roundId === 2 ? 80 : 200,
    bittenSurvivors: 0, evacuatedSurvivors: 0, activeZombies: roundId === 1 ? 1 : 3,
    wsClients: 0, snapshotQueueDepth: 0, lastSnapshotTurnId: null };
}
function input(roundId: RoundId = 1) {
  return { gameId: "game", graph: graph(), roundConfig: config(roundId),
    randomState: { seed: "unit-seed", algorithm: "test-descriptor-only", algorithmVersion: "test-only",
      strategy: "per-zombie-turn-draw" as const },
    initialMetrics: metrics(roundId), updatedAt: "2026-10-27T00:00:00Z" };
}

test("valida las tres rondas sin completar ni modificar la configuración", () => {
  for (const roundId of [1, 2, 3] as const) {
    const source = config(roundId); const before = structuredClone(source);
    const validated = validateRoundConfig(source, graph());
    assert.deepEqual(validated, before);
    validated.survivorSpawns[0].nodeId = "B";
    assert.deepEqual(source, before);
  }
});

test("rechaza configuración ausente, campos faltantes, extras y listas no explícitas", () => {
  for (const value of [undefined, null, [], "round", {}, { ...config(), extra: true }]) {
    assert.throws(() => validateRoundConfig(value, graph()), /Configuración de ronda inválida/);
  }
  for (const key of Object.keys(config())) {
    const missing = { ...config() } as Record<string, unknown>; delete missing[key];
    assert.throws(() => validateRoundConfig(missing, graph()));
  }
  for (const key of ["survivorSpawns", "zombieSpawns", "eventPlan"]) {
    assert.throws(() => validateRoundConfig({ ...config(), [key]: {} }, graph()), /lista explícita/);
  }
  assert.throws(() => validateRoundConfig({ ...config(), survivorSpawns: new Array(20) }, graph()), /debe ser un objeto/);
});

test("no acepta duración, intervalo, turnos ni cantidades incompatibles con cada ronda", () => {
  for (const changes of [{ roundId: 4 }, { roundId: "1" }, { durationMs: 1 },
    { turnIntervalMs: 1 }, { turnCount: 149 }, { survivorCount: 80 }]) {
    assert.throws(() => validateRoundConfig({ ...config(), ...changes }, graph()));
  }
  for (const roundId of [1, 2, 3] as const) {
    const source = config(roundId); source.survivorSpawns.pop();
    assert.throws(() => validateRoundConfig(source, graph()), /survivorCount/);
  }
});

test("rechaza composiciones zombie incompletas o tipos no admitidos por ronda", () => {
  for (const roundId of [1, 2, 3] as const) {
    for (const zombie of config(roundId).zombieSpawns) {
      const source = config(roundId);
      source.zombieSpawns = source.zombieSpawns.filter(spawn => spawn.id !== zombie.id);
      assert.throws(() => validateRoundConfig(source, graph()), /composición/);
    }
  }
  for (const tipo of ["corredor", "horda", "dormido"] as const) {
    const source = config(); source.zombieSpawns.push({ id: "extra", tipo, nodeId: "Q" });
    assert.throws(() => validateRoundConfig(source, graph()), /composición/);
  }
  const source = config(2); source.zombieSpawns.push({ id: "sleeper", tipo: "dormido", nodeId: "Q" });
  assert.throws(() => validateRoundConfig(source, graph()), /composición/);
  assert.throws(() => validateRoundConfig({ ...config(), zombieSpawns: [{ id: "Z", tipo: "alien", nodeId: "Q" }] }, graph()), /tipo zombie/);
});

test("IDs únicos, nodos existentes y esquema de spawns son obligatorios", () => {
  const duplicate = config(); duplicate.survivorSpawns[1].id = duplicate.survivorSpawns[0].id;
  assert.throws(() => validateRoundConfig(duplicate, graph()), /duplicado/);
  const collision = config(); collision.zombieSpawns[0].id = collision.survivorSpawns[0].id;
  assert.throws(() => validateRoundConfig(collision, graph()), /duplicado/);
  for (const key of ["survivorSpawns", "zombieSpawns"] as const) {
    const source = config(); source[key][0].nodeId = "unknown";
    assert.throws(() => validateRoundConfig(source, graph()), /nodo desconocido/);
    source[key][0].nodeId = "A"; source[key][0].id = " ";
    assert.throws(() => validateRoundConfig(source, graph()), /texto no vacío/);
  }
  const source = config();
  assert.throws(() => validateRoundConfig({ ...source,
    survivorSpawns: [{ ...source.survivorSpawns[0], extra: true }, ...source.survivorSpawns.slice(1)] }, graph()), /campos/);
});

test("no permite sobrevivientes en zombies, refugios o vecindad de horda", () => {
  for (const nodeId of ["C", "R", "H", "B", "Q"]) {
    const source = config(3); source.survivorSpawns[0].nodeId = nodeId;
    assert.throws(() => validateRoundConfig(source, graph()), /inicia en/);
  }
  // La adyacencia de horda incluye ambos sentidos, aun con una sola dirección en la fixture.
  const source = config(3); source.survivorSpawns[0].nodeId = "B";
  for (const removed of ["BH-0", "BH-1"]) {
    const g = graph(); g.aristas = g.aristas.filter(edge => edge.id !== removed);
    assert.throws(() => validateRoundConfig(source, g), /inicia en/);
  }
});

test("cada ronda exige cantidad exacta de eventos con segmento y motivo compatibles", () => {
  for (const roundId of [2, 3] as const) {
    const source = config(roundId); source.eventPlan.pop();
    assert.throws(() => validateRoundConfig(source, graph()), /requiere/);
  }
  const first = config(); first.eventPlan = config(2).eventPlan;
  assert.throws(() => validateRoundConfig(first, graph()), /incompatible/);
  const bridge = config(2); bridge.eventPlan[0].edgeId = "AB-0";
  assert.throws(() => validateRoundConfig(bridge, graph()), /incompatible/);
  const street = config(3); street.eventPlan[0].edgeId = "BC-0";
  assert.throws(() => validateRoundConfig(street, graph()), /incompatible/);
  const reason = config(2); reason.eventPlan[0].reason = "bloqueo-calle";
  assert.throws(() => validateRoundConfig(reason, graph()), /incompatible/);
});

test("eventos rechazan turnos inválidos, IDs repetidos y dos sentidos del mismo segmento", () => {
  for (const effectiveTurnId of [0, 151, 1.5, NaN, Infinity]) {
    const source = config(2); source.eventPlan[0].effectiveTurnId = effectiveTurnId;
    assert.throws(() => validateRoundConfig(source, graph()), /entre 1 y 150/);
  }
  const repeatedId = config(3); repeatedId.eventPlan[1].eventId = repeatedId.eventPlan[0].eventId;
  assert.throws(() => validateRoundConfig(repeatedId, graph()), /eventId duplicado/);
  const repeatedSegment = config(3); repeatedSegment.eventPlan[1].edgeId = "AB-1";
  assert.throws(() => validateRoundConfig(repeatedSegment, graph()), /repiten segmento/);
  const missing = config(2); missing.eventPlan[0].edgeId = "unknown";
  assert.throws(() => validateRoundConfig(missing, graph()), /arista de evento desconocida/);
});

test("crea estado idle en turno cero con cadencias iniciales y sin instalación routing", () => {
  const state = createWorldState(input(3));
  assert.deepEqual([state.status, state.phase, state.turnId, state.worldVersion, state.activeTurnId, state.activeTurn],
    ["idle", "idle", 0, 0, null, null]);
  assert.deepEqual(state.routing, { confirmed: null, uncertain: false, attemptedRequest: null });
  assert.deepEqual(state.pause, { status: "none" });
  assert.equal(state.survivors.length, 200);
  assert(state.survivors.every(s => s.estado === "vivo" && s.targetShelterId === null &&
    s.eliminadoEnTurno === null && s.evacuadoEnTurno === null));
  assert.deepEqual(state.zombies.map(z => [z.tipo, z.estado, z.siguienteMovimientoTurno, z.despertadoEnTurno]), [
    ["caminante", "activo", 2, null], ["corredor", "activo", 1, null],
    ["horda", "activo", null, null], ["dormido", "dormido", null, null],
  ]);
  assert.deepEqual(state.shelters, [{ id: "REF", nodoId: "R", capacidad: 60, ocupantes: [], reservados: [] }]);
  assert.deepEqual(state.blockedEdges, []); assert.deepEqual(state.lastZombieTraversals, []);
  assert(state.pendingCityEvents.every(e => !e.aplicado && e.origen === "evento-ciudad" && e.tipo === "bloquear-segmento"));
  assert.deepEqual(state.pendingCityEvents.map(e => e.effectiveTurnId), [1, 150]);
});

test("configuración inválida nunca produce un mundo parcial", () => {
  const source = input(); source.roundConfig.survivorSpawns = [];
  assert.throws(() => createWorldState(source), /survivorCount/);
  assert.throws(() => createWorldState({ ...input(), roundConfig: undefined }), /Configuración/);
});

test("estado, grafo, configuración, semilla y métricas no comparten referencias mutables", () => {
  const source = input(3); const before = structuredClone(source);
  const state = createWorldState(source); const second = createWorldState(source);
  assert.deepEqual(source, before);
  assert(Object.isFrozen(state.graph)); assert(Object.isFrozen(state.graph.nodos[0]));
  assert(Object.isFrozen(state.roundConfig.survivorSpawns[0]));
  assert(!Object.isFrozen(source.graph));
  source.graph.refugios[0].capacidad = 999;
  source.roundConfig.survivorSpawns[0].nodeId = "Q";
  source.randomState.seed = "changed"; source.initialMetrics.routeTimeouts = 99;
  assert.equal(state.graph.refugios[0].capacidad, 60);
  assert.equal(state.survivors[0].nodeId, "A"); assert.equal(state.rngSeed, "unit-seed");
  assert.equal(state.randomState.seed, "unit-seed"); assert.equal(state.metrics.routeTimeouts, 0);
  state.survivors[0].nodeId = "B"; state.shelters[0].ocupantes.push("S-0");
  state.pendingCityEvents[0].aplicado = true; state.metrics.routeTimeouts++;
  assert.equal(second.survivors[0].nodeId, "A"); assert.deepEqual(second.shelters[0].ocupantes, []);
  assert.equal(second.pendingCityEvents[0].aplicado, false); assert.equal(second.metrics.routeTimeouts, 0);
});

test("exige identidad, descriptor aleatorio, métricas y fecha UTC sin elegir valores implícitos", () => {
  for (const gameId of ["", " ", "g".repeat(129)]) assert.throws(() => createWorldState({ ...input(), gameId }), /gameId/);
  for (const key of ["seed", "algorithm", "algorithmVersion"] as const) {
    const source = input(); source.randomState[key] = "";
    assert.throws(() => createWorldState(source), /descriptor/);
  }
  for (const updatedAt of ["", "yesterday", "2026-02-30T00:00:00Z", "2026-10-27T00:00:00-05:00"]) {
    assert.throws(() => createWorldState({ ...input(), updatedAt }), /ISO-8601 UTC/);
  }
  assert.equal(createWorldState({ ...input(), updatedAt: "2026-10-27T00:00:00.123Z" }).updatedAt,
    "2026-10-27T00:00:00.123Z");
  assert.throws(() => createWorldState({ ...input(), initialMetrics: undefined as unknown as TelemetryMetrics }), /métricas iniciales/);
});
