import type { MantaGraph, WorldSnapshot } from "../types/contracts";

export function makeGraph(graphVersion: string): MantaGraph {
  return {
    schemaVersion: "1.0.0",
    metadata: {
      ciudad: "Manta",
      graphVersion,
      generatedAt: "2026-01-01T00:00:00.000Z",
      source: "OpenStreetMap",
      osmAttribution: "© OpenStreetMap contributors",
    },
    nodos: [],
    aristas: [],
    refugios: [],
  };
}

export function makeSnapshot(overrides: Partial<WorldSnapshot> = {}): WorldSnapshot {
  return {
    schemaVersion: "1.0.0",
    gameId: "game-test-001",
    roundId: 1,
    status: "running",
    turnId: 1,
    worldVersion: 1,
    graphVersion: "graph-v1",
    updatedAt: "2026-01-01T00:00:00.000Z",
    zombies: [],
    survivors: [],
    shelters: [],
    blockedEdges: [],
    cameras: [],
    cameraObservations: [],
    metrics: {
      routeSamples: 0,
      routeLatencyP50Ms: 0,
      routeLatencyP95Ms: 0,
      routeLatencyP99Ms: 0,
      routeTimeouts: 0,
      invalidRouteResponses: 0,
      deadlineMisses: 0,
      activeSurvivors: 0,
      bittenSurvivors: 0,
      evacuatedSurvivors: 0,
      activeZombies: 0,
      wsClients: 0,
      snapshotQueueDepth: 0,
      lastSnapshotTurnId: null,
      routeErrors: 0,
      routeAvailabilityPercent: 0,
      survivalRatePercent: 100,
      activeSurvivorsPercent: 0,
      bittenSurvivorsPercent: 0,
      evacuatedSurvivorsPercent: 0,
      turnDurationMs: 0,
      turnBudgetUsedPercent: 0,
      turnEfficiencyPercent: 100,
    },
    ...overrides,
  };
}

