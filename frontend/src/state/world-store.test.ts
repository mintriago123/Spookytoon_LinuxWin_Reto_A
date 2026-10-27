import { beforeEach, describe, expect, it } from "vitest";
import { hasGraphVersionMismatch, useWorldStore } from "./world-store";
import type { MantaGraph, WorldSnapshot } from "../types/contracts";

const INITIAL_STATE = {
  graph: null,
  graphVersion: null,
  currentSnapshot: null,
  previousSnapshot: null,
  receivedAt: null,
  socketStatus: "connecting" as const,
  pendingControl: null,
  lastError: null,
};

function makeGraph(graphVersion: string): MantaGraph {
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

function makeSnapshot(overrides: Partial<WorldSnapshot> = {}): WorldSnapshot {
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
    },
    ...overrides,
  };
}

// SPEC.md §6 / docs/team/kristhian: turnId duplicado o menor al ya aplicado
// se ignora; graphVersion distinto impide dibujar entidades.
describe("world-store", () => {
  beforeEach(() => {
    useWorldStore.setState(INITIAL_STATE);
  });

  it("aplica el primer snapshot recibido", () => {
    const snapshot = makeSnapshot({ turnId: 1 });
    useWorldStore.getState().applySnapshot(snapshot);
    expect(useWorldStore.getState().currentSnapshot).toBe(snapshot);
    expect(useWorldStore.getState().previousSnapshot).toBeNull();
  });

  it("acepta un turnId mayor y mueve el anterior a previousSnapshot", () => {
    const first = makeSnapshot({ turnId: 5 });
    const second = makeSnapshot({ turnId: 6 });
    useWorldStore.getState().applySnapshot(first);
    useWorldStore.getState().applySnapshot(second);
    expect(useWorldStore.getState().currentSnapshot).toBe(second);
    expect(useWorldStore.getState().previousSnapshot).toBe(first);
  });

  it("ignora un snapshot con turnId igual al ya aplicado", () => {
    const first = makeSnapshot({ turnId: 5 });
    useWorldStore.getState().applySnapshot(first);
    useWorldStore.getState().applySnapshot(makeSnapshot({ turnId: 5 }));
    expect(useWorldStore.getState().currentSnapshot).toBe(first);
    expect(useWorldStore.getState().previousSnapshot).toBeNull();
  });

  it("ignora un snapshot con turnId menor al ya aplicado (reconexión con mensaje atrasado)", () => {
    const first = makeSnapshot({ turnId: 10 });
    useWorldStore.getState().applySnapshot(first);
    useWorldStore.getState().applySnapshot(makeSnapshot({ turnId: 3 }));
    expect(useWorldStore.getState().currentSnapshot).toBe(first);
  });

  it("hasGraphVersionMismatch es false si todavía no hay grafo o snapshot", () => {
    expect(hasGraphVersionMismatch(useWorldStore.getState())).toBe(false);
    useWorldStore.getState().setGraph(makeGraph("graph-v1"));
    expect(hasGraphVersionMismatch(useWorldStore.getState())).toBe(false);
  });

  it("hasGraphVersionMismatch detecta un graphVersion distinto entre grafo y snapshot", () => {
    useWorldStore.getState().setGraph(makeGraph("graph-v1"));
    useWorldStore.getState().applySnapshot(makeSnapshot({ graphVersion: "graph-v2" }));
    expect(hasGraphVersionMismatch(useWorldStore.getState())).toBe(true);
  });

  it("hasGraphVersionMismatch es false cuando el graphVersion coincide", () => {
    useWorldStore.getState().setGraph(makeGraph("graph-v1"));
    useWorldStore.getState().applySnapshot(makeSnapshot({ graphVersion: "graph-v1" }));
    expect(hasGraphVersionMismatch(useWorldStore.getState())).toBe(false);
  });
});
