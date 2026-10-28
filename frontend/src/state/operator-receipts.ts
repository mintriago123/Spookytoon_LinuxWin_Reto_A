import { create } from "zustand";
import type { BloquearAristaResponse, WorldSnapshot } from "../types/contracts";

export type OperatorReceiptStatus =
  | "sending"
  | "pending-observation"
  | "overlapping"
  | "rejected"
  | "uncertain"
  | "observed"
  | "not-observed";

export interface OperatorReceipt {
  eventId: string;
  gameId: string;
  roundId: WorldSnapshot["roundId"];
  segmentId: string;
  segmentLabel: string;
  action: "close" | "open";
  reason: string;
  requestedAtTurn: number;
  status: OperatorReceiptStatus;
  createdAt: number;
  effectiveTurnId?: number;
  observedAtTurnId?: number;
  stateAlreadyExpectedAtRequest: boolean;
  overlapsAnotherOrder: boolean;
  error?: { message: string; code?: string; requestId?: string; status?: number };
}

export interface ReceiptToken {
  scopeKey: string;
  epoch: number;
  eventId: string;
}

interface OperatorReceiptsState {
  scopeKey: string | null;
  epoch: number;
  latestSnapshot: WorldSnapshot | null;
  receipts: OperatorReceipt[];
  observeSnapshot: (snapshot: WorldSnapshot) => void;
  begin: (input: {
    snapshot: WorldSnapshot;
    eventId: string;
    segmentId: string;
    segmentLabel: string;
    action: OperatorReceipt["action"];
    reason: string;
  }) => ReceiptToken | null;
  accept: (token: ReceiptToken, response: BloquearAristaResponse) => boolean;
  fail: (
    token: ReceiptToken,
    failure: { kind: "rejected" | "uncertain"; message: string; code?: string; requestId?: string; status?: number },
  ) => boolean;
}

const MAX_RECEIPTS = 20;

function scopeFor(snapshot: WorldSnapshot): string {
  return JSON.stringify([snapshot.gameId, snapshot.roundId]);
}

function segmentIsBlocked(snapshot: WorldSnapshot, segmentId: string): boolean {
  return snapshot.blockedEdges.some((blocked) =>
    blocked.segmentoId === segmentId &&
    blocked.bloqueadaDesdeTurno <= snapshot.turnId &&
    (blocked.desbloqueadaEnTurno === null || snapshot.turnId < blocked.desbloqueadaEnTurno)
  );
}

function tokenMatches(state: OperatorReceiptsState, token: ReceiptToken): boolean {
  return state.scopeKey === token.scopeKey && state.epoch === token.epoch &&
    state.latestSnapshot !== null && scopeFor(state.latestSnapshot) === token.scopeKey &&
    state.receipts.some((receipt) => receipt.eventId === token.eventId && receipt.gameId === state.latestSnapshot?.gameId);
}

function reconcileSnapshot(receipts: OperatorReceipt[], snapshot: WorldSnapshot): OperatorReceipt[] {
  return receipts.map((receipt) => {
    if (
      receipt.gameId !== snapshot.gameId || receipt.roundId !== snapshot.roundId ||
      (receipt.status !== "pending-observation" && receipt.status !== "overlapping") ||
      receipt.effectiveTurnId === undefined
    ) return receipt;

    // Una observación anterior al turno efectivo no puede satisfacer el recibo.
    if (snapshot.turnId >= receipt.effectiveTurnId) {
      const expectedBlocked = receipt.action === "close";
      if (segmentIsBlocked(snapshot, receipt.segmentId) === expectedBlocked) {
        return { ...receipt, status: "observed", observedAtTurnId: snapshot.turnId };
      }
    }

    if (snapshot.status === "completed") {
      return { ...receipt, status: "not-observed" };
    }
    return receipt;
  });
}

function flagOverlappingOrders(receipts: OperatorReceipt[]): OperatorReceipt[] {
  const pendingBySegment = new Map<string, number>();
  for (const receipt of receipts) {
    if (receipt.status === "pending-observation" || receipt.status === "overlapping") {
      pendingBySegment.set(receipt.segmentId, (pendingBySegment.get(receipt.segmentId) ?? 0) + 1);
    }
  }
  return receipts.map((receipt) => {
    if ((pendingBySegment.get(receipt.segmentId) ?? 0) < 2) return receipt;
    if (receipt.status !== "pending-observation" && receipt.status !== "overlapping") return receipt;
    return { ...receipt, status: "overlapping", overlapsAnotherOrder: true };
  });
}

export const useOperatorReceipts = create<OperatorReceiptsState>((set, get) => ({
  scopeKey: null,
  epoch: 0,
  latestSnapshot: null,
  receipts: [],

  observeSnapshot: (snapshot) => {
    const nextScope = scopeFor(snapshot);
    const current = get();
    if (current.scopeKey !== nextScope) {
      set({ scopeKey: nextScope, epoch: current.epoch + 1, latestSnapshot: snapshot, receipts: [] });
      return;
    }
    set({ latestSnapshot: snapshot, receipts: reconcileSnapshot(current.receipts, snapshot) });
  },

  begin: (input) => {
    const state = get();
    const scopeKey = scopeFor(input.snapshot);
    const latest = state.latestSnapshot;
    // No recibimos ni asociamos solicitudes si el snapshot activo cambió de partida.
    if (!latest || state.scopeKey !== scopeKey || scopeFor(latest) !== scopeKey) return null;

    const receipt: OperatorReceipt = {
      eventId: input.eventId,
      gameId: input.snapshot.gameId,
      roundId: input.snapshot.roundId,
      segmentId: input.segmentId,
      segmentLabel: input.segmentLabel,
      action: input.action,
      reason: input.reason,
      requestedAtTurn: latest.turnId,
      status: "sending",
      createdAt: Date.now(),
      stateAlreadyExpectedAtRequest: segmentIsBlocked(latest, input.segmentId) === (input.action === "close"),
      overlapsAnotherOrder: false,
    };
    const receipts = [...state.receipts, receipt].slice(-MAX_RECEIPTS);
    set({ receipts });
    return { scopeKey, epoch: state.epoch, eventId: input.eventId };
  },

  accept: (token, response) => {
    const state = get();
    if (!tokenMatches(state, token)) return false;
    const currentReceipt = state.receipts.find((receipt) => receipt.eventId === token.eventId);
    if (!currentReceipt || currentReceipt.status !== "sending" || response.eventId !== token.eventId || response.segmentoId !== currentReceipt.segmentId) {
      return false;
    }
    const withReceipt = state.receipts.map((receipt) => receipt.eventId === token.eventId
      ? { ...receipt, status: "pending-observation" as const, effectiveTurnId: response.effectiveTurnId }
      : receipt);
    const overlapped = flagOverlappingOrders(withReceipt);
    const latest = state.latestSnapshot;
    set({ receipts: latest ? reconcileSnapshot(overlapped, latest) : overlapped });
    return true;
  },

  fail: (token, failure) => {
    const state = get();
    if (!tokenMatches(state, token)) return false;
    const receipt = state.receipts.find((item) => item.eventId === token.eventId);
    if (!receipt || receipt.status !== "sending") return false;
    set({
      receipts: state.receipts.map((item) => item.eventId === token.eventId
        ? {
          ...item,
          status: failure.kind,
          error: {
            message: failure.message,
            code: failure.code,
            requestId: failure.requestId,
            status: failure.status,
          },
        }
        : item),
    });
    return true;
  },
}));
