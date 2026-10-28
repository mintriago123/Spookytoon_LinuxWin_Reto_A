import { makeSnapshot as baseSnapshot } from "../test/fixtures";
import { beforeEach, describe, expect, it } from "vitest";
import { useOperatorReceipts } from "./operator-receipts";
import { useWorldStore } from "./world-store";
import type { WorldSnapshot } from "../types/contracts";

function makeSnapshot(overrides: Partial<WorldSnapshot> = {}): WorldSnapshot {
  return {
    schemaVersion: "1.0.0",
    gameId: "game-a",
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
    metrics: baseSnapshot().metrics,
    ...overrides,
  };
}

function applySnapshot(snapshot: WorldSnapshot): void {
  useWorldStore.getState().applySnapshot(snapshot);
}

function begin(action: "close" | "open" = "close") {
  const snapshot = useWorldStore.getState().currentSnapshot;
  if (!snapshot) throw new Error("test requires an active snapshot");
  const token = useOperatorReceipts.getState().begin({
    snapshot,
    eventId: `event-${action}-${useOperatorReceipts.getState().receipts.length + 1}`,
    segmentId: "segment-1",
    segmentLabel: "Avenida · Tarqui · tramo 1",
    action,
    reason: "Prueba local",
  });
  if (!token) throw new Error("receipt did not start for current game");
  return token;
}

function accept(token: ReturnType<typeof begin>, effectiveTurnId = 3): void {
  const accepted = useOperatorReceipts.getState().accept(token, {
    eventId: token.eventId,
    segmentoId: "segment-1",
    effectiveTurnId,
    status: "programado",
  });
  expect(accepted).toBe(true);
}

function segmentBlocked(turnId: number): WorldSnapshot["blockedEdges"] {
  return [{
    segmentoId: "segment-1",
    edgeIds: ["edge-1", "edge-2"],
    motivo: "Prueba",
    origen: "control",
    bloqueadaDesdeTurno: turnId,
    desbloqueadaEnTurno: null,
  }];
}

describe("operator receipt lifecycle", () => {
  beforeEach(() => {
    useOperatorReceipts.setState({ scopeKey: null, epoch: 0, latestSnapshot: null, receipts: [] });
    useWorldStore.setState({ currentSnapshot: null, previousSnapshot: null, receivedAt: null });
  });

  it("no infiere aplicación desde 202 y exige snapshot de la misma partida en el turno efectivo", () => {
    applySnapshot(makeSnapshot({ turnId: 1 }));
    const token = begin("close");
    accept(token, 3);
    expect(useOperatorReceipts.getState().receipts[0].status).toBe("pending-observation");

    applySnapshot(makeSnapshot({ turnId: 2, worldVersion: 2, blockedEdges: segmentBlocked(2) }));
    expect(useOperatorReceipts.getState().receipts[0].status).toBe("pending-observation");

    applySnapshot(makeSnapshot({ turnId: 3, worldVersion: 3, blockedEdges: segmentBlocked(2) }));
    expect(useOperatorReceipts.getState().receipts[0]).toMatchObject({
      status: "observed",
      observedAtTurnId: 3,
    });
  });

  it("no asocia snapshots atrasados que world-store rechazó con un recibo", () => {
    applySnapshot(makeSnapshot({ turnId: 1 }));
    const token = begin("close");
    accept(token, 2);
    applySnapshot(makeSnapshot({ turnId: 2, worldVersion: 2 }));
    expect(useOperatorReceipts.getState().receipts[0].status).toBe("pending-observation");

    // Este snapshot previo tendría el estado esperado, pero el store autoritativo lo descarta.
    applySnapshot(makeSnapshot({ turnId: 1, blockedEdges: segmentBlocked(1) }));
    expect(useWorldStore.getState().currentSnapshot?.turnId).toBe(2);
    expect(useOperatorReceipts.getState().receipts[0].status).toBe("pending-observation");
  });

  it("registra que el estado ya existía y no lo atribuye a la solicitud", () => {
    applySnapshot(makeSnapshot({ turnId: 2, blockedEdges: segmentBlocked(1) }));
    const token = begin("close");
    accept(token, 3);
    applySnapshot(makeSnapshot({ turnId: 3, worldVersion: 3, blockedEdges: segmentBlocked(1) }));
    expect(useOperatorReceipts.getState().receipts[0]).toMatchObject({
      status: "observed",
      stateAlreadyExpectedAtRequest: true,
    });
  });

  it("separa recibos al cambiar de partida e ignora respuestas tardías incluso en A→B→A", () => {
    applySnapshot(makeSnapshot({ gameId: "game-a" }));
    const staleToken = begin();
    applySnapshot(makeSnapshot({ gameId: "game-b", turnId: 1 }));
    expect(useOperatorReceipts.getState().receipts).toHaveLength(0);
    applySnapshot(makeSnapshot({ gameId: "game-a", turnId: 1 }));

    expect(useOperatorReceipts.getState().accept(staleToken, {
      eventId: staleToken.eventId,
      segmentoId: "segment-1",
      effectiveTurnId: 3,
      status: "programado",
    })).toBe(false);
    expect(useOperatorReceipts.getState().receipts).toHaveLength(0);
  });

  it("requiere que la solicitud coincida con la identidad del snapshot activo", () => {
    applySnapshot(makeSnapshot({ gameId: "game-a" }));
    const token = useOperatorReceipts.getState().begin({
      snapshot: makeSnapshot({ gameId: "game-b" }),
      eventId: "event-wrong-game",
      segmentId: "segment-1",
      segmentLabel: "Tramo 1",
      action: "close",
      reason: "Prueba",
    });
    expect(token).toBeNull();
  });

  it("conserva órdenes superpuestas y observa solo el estado final del segmento", () => {
    applySnapshot(makeSnapshot());
    const closeToken = begin("close");
    accept(closeToken, 2);
    const openToken = begin("open");
    accept(openToken, 2);
    expect(useOperatorReceipts.getState().receipts.map((receipt) => receipt.status)).toEqual([
      "overlapping",
      "overlapping",
    ]);

    applySnapshot(makeSnapshot({ turnId: 2, worldVersion: 2 }));
    const receipts = useOperatorReceipts.getState().receipts;
    expect(receipts[0].status).toBe("overlapping");
    expect(receipts[1]).toMatchObject({ status: "observed", overlapsAnotherOrder: true });
  });

  it("distingue rechazo y aceptación incierta y marca lo no observado al finalizar", () => {
    applySnapshot(makeSnapshot());
    const rejectedToken = begin("close");
    expect(useOperatorReceipts.getState().fail(rejectedToken, {
      kind: "rejected",
      message: "Turno conflictivo",
      code: "TURN_CONFLICT",
      status: 409,
    })).toBe(true);
    expect(useOperatorReceipts.getState().receipts[0]).toMatchObject({ status: "rejected", error: { code: "TURN_CONFLICT" } });

    const uncertainToken = begin("open");
    expect(useOperatorReceipts.getState().fail(uncertainToken, {
      kind: "uncertain",
      message: "Conexión interrumpida",
    })).toBe(true);
    expect(useOperatorReceipts.getState().receipts[1].status).toBe("uncertain");

    const pendingToken = begin("close");
    accept(pendingToken, 4);
    applySnapshot(makeSnapshot({ turnId: 3, status: "completed", worldVersion: 3 }));
    expect(useOperatorReceipts.getState().receipts[2].status).toBe("not-observed");
  });
});
