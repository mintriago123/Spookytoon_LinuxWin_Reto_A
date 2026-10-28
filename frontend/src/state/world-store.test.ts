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

  // backend/src/modules/simulator/turn-coordinator.ts (rama
  // feat/backend-rounds-metrics) recomete metrics.wsClients en resume() sin
  // tocar turnId ni status en algunos casos; worldVersion es la señal de
  // "esto es un commit nuevo" que no depende de enumerar cada motivo.
  it("aplica un snapshot con turnId y status iguales si worldVersion avanzó", () => {
    const first = makeSnapshot({ turnId: 20, status: "running", worldVersion: 40 });
    const recommitted = makeSnapshot({ turnId: 20, status: "running", worldVersion: 41 });
    useWorldStore.getState().applySnapshot(first);
    useWorldStore.getState().applySnapshot(recommitted);
    expect(useWorldStore.getState().currentSnapshot).toBe(recommitted);
  });

  it("ignora un snapshot con turnId, status y worldVersion iguales (duplicado real)", () => {
    const first = makeSnapshot({ turnId: 20, status: "running", worldVersion: 40 });
    useWorldStore.getState().applySnapshot(first);
    useWorldStore.getState().applySnapshot(makeSnapshot({ turnId: 20, status: "running", worldVersion: 40 }));
    expect(useWorldStore.getState().currentSnapshot).toBe(first);
  });

  // backend/src/modules/simulator/simulation-runtime.ts publica un commit de
  // control (reanudar desde paused) con el MISMO turnId pero status distinto
  // ("Acuerdo Etapa 7"). Si el store lo ignora, la UI muestra "paused" para
  // siempre aunque la partida ya esté corriendo.
  it("aplica un snapshot con turnId igual pero status distinto (reanudar desde paused)", () => {
    const paused = makeSnapshot({ turnId: 20, status: "paused" });
    const resumed = makeSnapshot({ turnId: 20, status: "running" });
    useWorldStore.getState().applySnapshot(paused);
    useWorldStore.getState().applySnapshot(resumed);
    expect(useWorldStore.getState().currentSnapshot).toBe(resumed);
  });

  // Una ronda nueva es un gameId distinto que reinicia turnId desde 1. Debe
  // aceptarse aunque turnId sea menor al de la partida anterior, o el mapa
  // se queda congelado para siempre en el último snapshot de la ronda vieja.
  it("acepta una partida nueva (gameId distinto) aunque su turnId sea menor y no interpola contra la anterior", () => {
    const roundOneFinal = makeSnapshot({ gameId: "game-r1", turnId: 150, status: "completed" });
    const roundTwoFirstTurn = makeSnapshot({ gameId: "game-r2", turnId: 1, status: "running" });
    useWorldStore.getState().applySnapshot(roundOneFinal);
    useWorldStore.getState().applySnapshot(roundTwoFirstTurn);
    expect(useWorldStore.getState().currentSnapshot).toBe(roundTwoFirstTurn);
    expect(useWorldStore.getState().previousSnapshot).toBeNull();
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
