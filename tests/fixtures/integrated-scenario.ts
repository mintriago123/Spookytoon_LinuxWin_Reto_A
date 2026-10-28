import type { MantaGraph } from "../../backend/src/contracts/types.ts";
import type { RoundConfig, RoundId, TelemetryMetrics } from "../../backend/src/modules/simulator/types.ts";

/** Grafo y spawns sintéticos exclusivos de pruebas. Nunca importar desde el backend. */
export function integratedScenario(roundId: RoundId) {
  const count = roundId === 1 ? 20 : roundId === 2 ? 80 : 200;
  const graph: MantaGraph = {
    schemaVersion: "1.0.0", metadata: { ciudad: "Manta", graphVersion: `integration-fixture-${roundId}`,
      generatedAt: "2026-10-27T00:00:00Z", source: "OpenStreetMap", osmAttribution: "Fixture sintética, sin datos OSM" },
    nodos: [...Array.from({ length: 151 }, (_, i) => `N${i}`), "Z0", "Z1", "Z2", "Z3", "E0", "E1", "E2", "R1", "R2", "R3"]
      .map(id => ({ id, zona: "Tarqui", lat: 0, lng: 0 })),
    aristas: [], refugios: [{ id: "REF0", nodoId: "N150", capacidad: count / 2 },
      ...[1, 2, 3].map(i => ({ id: `REF${i}`, nodoId: `R${i}`, capacidad: count }))],
  };
  for (let i = 0; i < 150; i++) {
    for (const [origen, destino] of [[`N${i}`, `N${i + 1}`], [`N${i + 1}`, `N${i}`]]) {
      graph.aristas.push({ id: `${origen}-${destino}`, segmentoId: `S${i}`, origen, destino,
        distancia_m: 1, tipo: "calle", factor_velocidad: 0.8 });
    }
  }
  for (let i = 0; i < 2; i++) {
    for (const [origen, destino] of [[`E${i}`, `E${i + 1}`], [`E${i + 1}`, `E${i}`]]) {
      graph.aristas.push({ id: `${origen}-${destino}`, segmentoId: `EVENT${i}`, origen, destino,
        distancia_m: 1, tipo: roundId === 2 ? "puente" : "calle", factor_velocidad: 0.8 });
    }
  }
  const types = (["caminante", "corredor", "horda", "dormido"] as const).slice(0, roundId === 1 ? 1 : roundId === 2 ? 3 : 4);
  const config: RoundConfig = { roundId, durationMs: 300_000, turnIntervalMs: 2_000, turnCount: 150,
    survivorCount: count, survivorSpawns: Array.from({ length: count }, (_, i) => ({ id: `S${String(i).padStart(3, "0")}`, nodeId: "N0" })),
    zombieSpawns: types.map((tipo, i) => ({ id: `Z${i}`, tipo, nodeId: `Z${i}` })),
    eventPlan: Array.from({ length: roundId - 1 }, (_, i) => ({ eventId: `event-${i}`, edgeId: `E${i}-E${i + 1}`,
      effectiveTurnId: 50 + i * 50, reason: roundId === 2 ? "colapso-puente" : "bloqueo-calle" })),
  };
  const metrics: TelemetryMetrics = { routeSamples: 0, routeLatencyP50Ms: 0, routeLatencyP95Ms: 0, routeLatencyP99Ms: 0,
    routeTimeouts: 0, invalidRouteResponses: 0, deadlineMisses: 0, activeSurvivors: count, bittenSurvivors: 0,
    evacuatedSurvivors: 0, activeZombies: types.length, wsClients: 0, snapshotQueueDepth: 0, lastSnapshotTurnId: null };
  return { graph, config, metrics };
}
