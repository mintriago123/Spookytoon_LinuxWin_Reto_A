import assert from "node:assert/strict";
import { test } from "node:test";
import type { MantaGraph } from "../backend/src/contracts/types.ts";
import type { RouteSurvivor, RouteZombie } from "../backend/src/contracts/routing.ts";
import type { RandomState } from "../backend/src/modules/simulator/types.ts";
import { randomIndex } from "../backend/src/modules/simulator/random.ts";
import { awakenDormantZombies, moveZombies } from "../backend/src/modules/simulator/zombies.ts";
import { applyCityEvents } from "../backend/src/modules/simulator/city-events.ts";

// Grafo dirigido mínimo de prueba; no se usa como escenario aprobado.
function graph(pairs: string[][] = [["A", "B"], ["B", "C"], ["C", "D"], ["D", "E"]]): MantaGraph {
  return { schemaVersion: "1.0.0", metadata: { ciudad: "Manta", graphVersion: "test",
    generatedAt: "2026-10-27T00:00:00Z", source: "OpenStreetMap", osmAttribution: "test" },
    nodos: ["A", "B", "C", "D", "E", "F"].map(id => ({ id, zona: "Tarqui", lat: 0, lng: 0 })),
    aristas: pairs.map(([origen, destino]) => ({ id: origen + destino, segmentoId: [origen, destino].sort().join(""),
      origen, destino, tipo: "calle", factor_velocidad: 0.8, distancia_m: 1 })), refugios: [],
  };
}
function zombie(id = "Z", tipo: RouteZombie["tipo"] = "caminante", nodeId = "A"): RouteZombie {
  return { id, tipo, nodeId, estado: tipo === "dormido" ? "dormido" : "activo", despertadoEnTurno: null,
    siguienteMovimientoTurno: tipo === "caminante" ? 2 : tipo === "corredor" ? 1 : null };
}
function survivor(id: string, nodeId: string): RouteSurvivor {
  return { id, nodeId, estado: "vivo", targetShelterId: null, eliminadoEnTurno: null, evacuadoEnTurno: null };
}
function random(): RandomState {
  return { seed: "unit-seed", algorithm: "sha256-counter", algorithmVersion: "1", strategy: "per-zombie-turn-draw" };
}
function input() {
  return { turnId: 2, graph: graph(), zombies: [zombie()], survivors: [] as RouteSurvivor[],
    blockedEdges: [] as Parameters<typeof moveZombies>[0]["blockedEdges"], randomState: random() };
}
function freeze(value: unknown): void {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
}

test("sha256-counter v1 conserva vectores reproducibles y valida descriptor y cursor", () => {
  const cursor = { zombieId: "Z", turnId: 2, drawIndex: 0 };
  assert.deepEqual([0, 1, 2, 3, 4].map(drawIndex => randomIndex(random(), { ...cursor, drawIndex }, 7)), [3, 2, 4, 6, 6]);
  assert.equal(randomIndex(random(), cursor, 1), 0);
  // Primer uint32=3944229542 cae en la cola rechazada; el siguiente es 108425944.
  assert.equal(randomIndex({ ...random(), seed: "rejection-1" }, cursor, 2147483649), 108425944);
  for (const state of [{ ...random(), algorithm: "other" }, { ...random(), algorithmVersion: "2" }, { ...random(), seed: "" }]) {
    assert.throws(() => randomIndex(state, cursor, 2), /Descriptor/);
  }
  for (const upper of [0, -1, NaN, 1.5, 0x1_0000_0001]) assert.throws(() => randomIndex(random(), cursor, upper), /inválido/);
  assert.throws(() => randomIndex(random(), { ...cursor, drawIndex: -1 }, 2), /inválido/);
  assert.throws(() => randomIndex(random(), { ...cursor, turnId: 0 }, 2), /inválido/);
});

test("caminante avanza una arista en turnos 2 y 4; horda y zombies sin salida no se mueven", () => {
  const base = input();
  const first = moveZombies({ ...base, turnId: 1 });
  assert.equal(first.zombies[0].nodeId, "A"); assert.deepEqual(first.traversals, []);
  const second = moveZombies({ ...base, zombies: first.zombies });
  assert.equal(second.zombies[0].nodeId, "B"); assert.equal(second.zombies[0].siguienteMovimientoTurno, 4);
  const third = moveZombies({ ...base, turnId: 3, zombies: second.zombies });
  assert.equal(third.zombies[0].nodeId, "B");
  const fourth = moveZombies({ ...base, turnId: 4, zombies: third.zombies });
  assert.equal(fourth.zombies[0].nodeId, "C");
  for (const z of [zombie("horde", "horda"), zombie("stuck", "caminante", "E"), zombie("runner", "corredor", "E")]) {
    assert.deepEqual(moveZombies({ ...base, zombies: [z] }).traversals, []);
  }
});

test("corredor persigue a tres saltos y conserva cada arista en orden", () => {
  const base = input(); base.zombies = [zombie("runner", "corredor")]; base.survivors = [survivor("S", "D")];
  const result = moveZombies(base);
  assert.equal(result.zombies[0].nodeId, "C");
  assert.deepEqual(result.traversals, [
    { zombieId: "runner", fromNodeId: "A", toNodeId: "B", edgeId: "AB", stepIndex: 1 },
    { zombieId: "runner", fromNodeId: "B", toNodeId: "C", edgeId: "BC", stepIndex: 2 },
  ]);
  assert.deepEqual(result.randomCursors, [{ zombieId: "runner", turnId: 2, drawIndex: 0 }]);
});

test("persecución desempata por survivorId, por edgeId y recalcula tras el primer paso", () => {
  const base = input(); base.zombies = [zombie("runner", "corredor")];
  base.graph = graph([["A", "B"], ["A", "C"], ["B", "D"], ["C", "D"], ["B", "E"], ["C", "F"]]);
  base.survivors = [survivor("z", "E"), survivor("a", "F")];
  assert.deepEqual(moveZombies(base).traversals.map(t => t.edgeId), ["AC", "CF"]);
  base.survivors = [survivor("a", "D")];
  assert.deepEqual(moveZombies(base).traversals.map(t => t.edgeId), ["AB", "BD"]);
  base.survivors = [survivor("a", "D"), survivor("z", "B")];
  const stopped = moveZombies(base);
  assert.deepEqual(stopped.traversals.map(t => t.edgeId), ["AB"]);
  assert.equal(stopped.zombies[0].nodeId, "B");
});

test("sin objetivo a tres saltos o con sobrevivientes terminales el corredor usa azar", () => {
  const base = input(); base.zombies = [zombie("runner", "corredor")];
  // E está a cuatro saltos: la primera decisión usa azar; desde B entra en radio 3.
  base.survivors = [survivor("S", "E")];
  assert.equal(moveZombies(base).randomCursors[0].drawIndex, 1);
  base.survivors = [{ ...survivor("S", "B"), estado: "mordido", eliminadoEnTurno: 1 }];
  assert.equal(moveZombies(base).randomCursors[0].drawIndex, 2);
});

test("eventos cierran ambos sentidos antes del movimiento y desbloqueo permite pasar", () => {
  const base = input(); base.graph = graph([["A", "B"], ["B", "A"]]);
  const applied = applyCityEvents({ turnId: 2, graph: base.graph, blockedEdges: [], events: [{ eventId: "close",
    edgeId: "BA", tipo: "bloquear-segmento", motivo: "test", effectiveTurnId: 2, aplicado: false, origen: "control" }] });
  assert.deepEqual(moveZombies({ ...base, blockedEdges: applied.blockedEdges }).traversals, []);
  const reopened = applyCityEvents({ turnId: 3, graph: base.graph, blockedEdges: applied.blockedEdges,
    events: [{ eventId: "open", edgeId: "AB", tipo: "desbloquear-segmento", motivo: "test",
      effectiveTurnId: 3, aplicado: false, origen: "control" }] });
  assert.equal(moveZombies({ ...base, turnId: 3, blockedEdges: reopened.blockedEdges }).zombies[0].nodeId, "B");
});

test("dormido despierta a dos saltos dirigidos abiertos y mueve en esa fase, luego cada dos turnos", () => {
  const base = input(); base.turnId = 1; base.zombies = [zombie("sleep", "dormido")]; base.survivors = [survivor("S", "C")];
  const awakened = moveZombies(base);
  assert.equal(awakened.zombies[0].tipo, "dormido");
  assert.equal(awakened.zombies[0].estado, "activo");
  assert.equal(awakened.zombies[0].despertadoEnTurno, 1);
  assert.equal(awakened.zombies[0].nodeId, "B");
  assert.equal(awakened.zombies[0].siguienteMovimientoTurno, 3);
  const waiting = moveZombies({ ...base, turnId: 2, survivors: [], zombies: awakened.zombies });
  assert.equal(waiting.zombies[0].estado, "activo"); assert.equal(waiting.zombies[0].nodeId, "B");
  assert.equal(moveZombies({ ...base, turnId: 3, zombies: waiting.zombies }).zombies[0].nodeId, "C");
});

test("despertar posterior a sobrevivientes programa movimiento para la siguiente fase", () => {
  const base = input(); base.zombies = [zombie("sleep", "dormido")]; base.survivors = [survivor("S", "B")];
  const awake = awakenDormantZombies({ ...base, phase: "after-survivor-move" });
  assert.equal(awake[0].nodeId, "A"); assert.equal(awake[0].siguienteMovimientoTurno, 3);
  assert.equal(moveZombies({ ...base, zombies: awake }).traversals.length, 0);
  assert.equal(moveZombies({ ...base, turnId: 3, zombies: awake }).zombies[0].nodeId, "B");
});

test("no despierta a tres saltos, en dirección inversa, tras cierre ni por terminales", () => {
  const base = input(); base.zombies = [zombie("sleep", "dormido")];
  for (const survivorNode of ["D", "E"]) {
    assert.equal(moveZombies({ ...base, survivors: [survivor("S", survivorNode)] }).zombies[0].estado, "dormido");
  }
  const reverse = moveZombies({ ...base, zombies: [zombie("sleep", "dormido", "C")], survivors: [survivor("S", "A")] });
  assert.equal(reverse.zombies[0].estado, "dormido");
  const closed = { segmentoId: "AB", edgeIds: ["AB"], motivo: "test", origen: "control" as const,
    bloqueadaDesdeTurno: 1, desbloqueadaEnTurno: null };
  assert.equal(moveZombies({ ...base, survivors: [survivor("S", "C")], blockedEdges: [closed] }).zombies[0].estado, "dormido");
  assert.equal(moveZombies({ ...base, survivors: [{ ...survivor("S", "B"), estado: "evacuado" }] }).zombies[0].estado, "dormido");
});

test("reordenar zombies, vivos y aristas no altera intenciones ni extracciones ni muta entradas", () => {
  const base = input(); base.graph = graph([["A", "B"], ["A", "C"], ["B", "D"], ["C", "E"], ["D", "A"], ["E", "A"]]);
  base.zombies = Array.from({ length: 30 }, (_, i) => zombie(`Z-${i}`, i % 2 ? "corredor" : "caminante"));
  const before = structuredClone(base); freeze(base);
  const result = moveZombies(base);
  assert.deepEqual(base, before);
  const reversed = moveZombies({ ...base, zombies: [...base.zombies].reverse(),
    survivors: [...base.survivors].reverse(), graph: { ...base.graph, aristas: [...base.graph.aristas].reverse() } });
  assert.deepEqual([...reversed.zombies].reverse(), result.zombies);
  assert.deepEqual(reversed.traversals, result.traversals); assert.deepEqual(reversed.randomCursors, result.randomCursors);
  const otherSeed = moveZombies({ ...base, randomState: { ...random(), seed: "another" } });
  assert.notDeepEqual(otherSeed.traversals, result.traversals);
  // Los zombies comparten la vista, sin excluir un destino ocupado por otro zombie.
  assert.equal(result.zombies.filter(z => z.nodeId === "B" || z.nodeId === "C").length >= 15, true);
  assert.deepEqual(moveZombies(base), result);
});

test("rechaza turnos inválidos y estados activos sin cadencia", () => {
  for (const turnId of [0, 151, NaN, 1.5]) assert.throws(() => moveZombies({ ...input(), turnId }), /fuera/);
  assert.throws(() => moveZombies({ ...input(), zombies: [{ ...zombie(), siguienteMovimientoTurno: null }] }), /sin cadencia/);
});
