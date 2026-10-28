import type { CommittedWorldSnapshot, Immutable, WorldSnapshot, WorldState } from "./types.ts";

function freeze<T>(value: T): Immutable<T> {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value as Immutable<T>;
}

/** Solo se llama con un mundo comprometido. Lista blanca del DTO público del SPEC. */
export function createWorldSnapshot(world: Immutable<WorldState>): CommittedWorldSnapshot {
  const metrics = world.metrics;
  const snapshot: WorldSnapshot = {
    schemaVersion: "1.0.0", gameId: world.gameId, roundId: world.roundId, status: world.status,
    turnId: world.turnId, worldVersion: world.worldVersion,
    graphVersion: world.graph.metadata.graphVersion, updatedAt: world.updatedAt,
    zombies: world.zombies.map(z => ({ id: z.id, tipo: z.tipo, estado: z.estado, nodeId: z.nodeId,
      despertadoEnTurno: z.despertadoEnTurno, siguienteMovimientoTurno: z.siguienteMovimientoTurno })),
    survivors: world.survivors.map(s => ({ id: s.id, nodeId: s.nodeId, estado: s.estado,
      targetShelterId: s.targetShelterId, eliminadoEnTurno: s.eliminadoEnTurno, evacuadoEnTurno: s.evacuadoEnTurno })),
    shelters: world.shelters.map(s => ({ id: s.id, nodoId: s.nodoId, capacidad: s.capacidad,
      ocupantes: [...s.ocupantes], reservados: [...s.reservados] })),
    blockedEdges: world.blockedEdges.map(b => ({ segmentoId: b.segmentoId, edgeIds: [...b.edgeIds], motivo: b.motivo,
      origen: b.origen, bloqueadaDesdeTurno: b.bloqueadaDesdeTurno, desbloqueadaEnTurno: b.desbloqueadaEnTurno })),
    metrics: {
      routeSamples: metrics.routeSamples, routeLatencyP50Ms: metrics.routeLatencyP50Ms,
      routeLatencyP95Ms: metrics.routeLatencyP95Ms, routeLatencyP99Ms: metrics.routeLatencyP99Ms,
      routeTimeouts: metrics.routeTimeouts, invalidRouteResponses: metrics.invalidRouteResponses,
      deadlineMisses: metrics.deadlineMisses, activeSurvivors: metrics.activeSurvivors,
      bittenSurvivors: metrics.bittenSurvivors, evacuatedSurvivors: metrics.evacuatedSurvivors,
      activeZombies: metrics.activeZombies, wsClients: metrics.wsClients,
      snapshotQueueDepth: metrics.snapshotQueueDepth, lastSnapshotTurnId: metrics.lastSnapshotTurnId,
      routeErrors: metrics.routeErrors ?? 0, routeAvailabilityPercent: metrics.routeAvailabilityPercent ?? 0,
      survivalRatePercent: metrics.survivalRatePercent ?? 100,
      activeSurvivorsPercent: metrics.activeSurvivorsPercent ?? 0,
      bittenSurvivorsPercent: metrics.bittenSurvivorsPercent ?? 0,
      evacuatedSurvivorsPercent: metrics.evacuatedSurvivorsPercent ?? 0,
      turnDurationMs: metrics.turnDurationMs ?? 0, turnBudgetUsedPercent: metrics.turnBudgetUsedPercent ?? 0,
      turnEfficiencyPercent: metrics.turnEfficiencyPercent ?? 100,
    },
  };
  return freeze(snapshot);
}
