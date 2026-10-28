import assert from "node:assert/strict";
import { test } from "node:test";
import type { MantaGraph } from "../backend/src/contracts/types.ts";
import type { ScheduledCityEvent } from "../backend/src/modules/simulator/types.ts";
import { applyCityEvents } from "../backend/src/modules/simulator/city-events.ts";

// Fixture unitaria: no es escenario de producción.
function graph(): MantaGraph {
  return { schemaVersion: "1.0.0", metadata: { ciudad: "Manta", graphVersion: "test",
    generatedAt: "2026-10-27T00:00:00Z", source: "OpenStreetMap", osmAttribution: "test" },
    nodos: ["A", "B"].map(id => ({ id, zona: "Tarqui", lat: 0, lng: 0 })), refugios: [],
    aristas: [["AB", "A", "B"], ["BA", "B", "A"]].map(([id, origen, destino]) => ({
      id, origen, destino, segmentoId: "segment", tipo: "calle", factor_velocidad: 0.8, distancia_m: 1,
    })),
  };
}
function event(turn = 2, unblock = false): ScheduledCityEvent {
  return { eventId: `event-${turn}`, edgeId: "AB", tipo: unblock ? "desbloquear-segmento" : "bloquear-segmento",
    motivo: "test", effectiveTurnId: turn, aplicado: false, origen: "evento-ciudad" };
}

test("evento efectivo bloquea ambos sentidos, conserva futuras órdenes y no muta entradas", () => {
  const input = { turnId: 2, graph: graph(), events: [event(), event(4, true)], blockedEdges: [] };
  const before = structuredClone(input);
  Object.freeze(input.events[0]); Object.freeze(input.events[1]); Object.freeze(input.events);
  const result = applyCityEvents(input);
  assert.deepEqual(input, before);
  assert.deepEqual(result.events.map(e => e.aplicado), [true, false]);
  assert.deepEqual(result.blockedEdges, [{ segmentoId: "segment", edgeIds: ["AB", "BA"],
    motivo: "test", origen: "evento-ciudad", bloqueadaDesdeTurno: 2, desbloqueadaEnTurno: null }]);
  assert.deepEqual(applyCityEvents({ ...input, ...result }), result);
});

test("desbloquea, conserva intervalo y admite un nuevo bloqueo posterior sin repetir segmentos", () => {
  const g = graph();
  const blocked = applyCityEvents({ turnId: 2, graph: g, events: [event()], blockedEdges: [] });
  const opened = applyCityEvents({ turnId: 3, graph: g, events: [...blocked.events, event(3, true)], blockedEdges: blocked.blockedEdges });
  assert.equal(opened.blockedEdges[0].desbloqueadaEnTurno, 3);
  assert.equal(blocked.blockedEdges[0].desbloqueadaEnTurno, null);
  const again = applyCityEvents({ turnId: 4, graph: g, events: [...opened.events, event(4)], blockedEdges: opened.blockedEdges });
  assert.equal(again.blockedEdges.length, 1);
  assert.equal(again.blockedEdges[0].bloqueadaDesdeTurno, 4);
  assert.equal(again.blockedEdges[0].desbloqueadaEnTurno, null);
});

test("bloqueo ya vigente y desbloqueo sin bloqueo son operaciones idempotentes", () => {
  const g = graph();
  const first = applyCityEvents({ turnId: 2, graph: g, events: [event()], blockedEdges: [] });
  const second = applyCityEvents({ turnId: 3, graph: g, events: [...first.events, event(3)], blockedEdges: first.blockedEdges });
  assert.deepEqual(second.blockedEdges, first.blockedEdges);
  assert.equal(second.events[1].aplicado, true);
  assert.deepEqual(applyCityEvents({ turnId: 3, graph: g, events: [event(3, true)], blockedEdges: [] }).blockedEdges, []);
});

test("rechaza eventos atrasados, IDs duplicados, aristas ausentes y órdenes simultáneas ambiguas", () => {
  const base = { turnId: 2, graph: graph(), events: [event()], blockedEdges: [] };
  assert.throws(() => applyCityEvents({ ...base, turnId: 3 }), /sin aplicar/);
  assert.throws(() => applyCityEvents({ ...base, events: [event(), event()] }), /duplicado/);
  assert.throws(() => applyCityEvents({ ...base, events: [{ ...event(), edgeId: "unknown" }] }), /inválido/);
  const conflict = { ...event(), eventId: "other", edgeId: "BA", tipo: "desbloquear-segmento" as const };
  const before = structuredClone(base);
  assert.throws(() => applyCityEvents({ ...base, events: [event(), conflict] }), /mismo turno/);
  assert.deepEqual(base, before);
  for (const turnId of [0, 151, NaN, 1.5]) assert.throws(() => applyCityEvents({ ...base, turnId }), /fuera/);
  assert.throws(() => applyCityEvents({ ...base, events: [{ ...event(), effectiveTurnId: 151 }] }), /inválido/);
});
