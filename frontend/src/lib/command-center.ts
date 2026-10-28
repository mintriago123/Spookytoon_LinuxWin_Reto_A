import type { MantaGraph, WorldSnapshot } from "../types/contracts";

export const ROUND_TURNS = 150;
export type Selection = { kind: "survivor" | "shelter" | "segment"; id: string } | null;
export interface ControlReceipt {
  eventId: string;
  gameId: string;
  segmentoId: string;
  label: string;
  blocked: boolean;
  reason: string;
  phase: "sending" | "scheduled" | "observed" | "error";
  effectiveTurnId?: number;
  observedAtTurnId?: number;
  error?: string;
}

export const GAME_LABELS = { idle: "Sin iniciar", running: "En ejecución", paused: "Pausada", completed: "Finalizada" };
export const CONNECTION_LABELS = { connecting: "Conectando", open: "Conectado", reconnecting: "Reconectando", closed: "Desconectado" };

export function metricValue(value: number | undefined, suffix = "", decimals = 0): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(decimals)}${suffix}` : "Sin dato";
}

export function reconcileSelection(selection: Selection, graph: MantaGraph | null, snapshot: WorldSnapshot | null): Selection {
  if (!selection || !graph || (snapshot && snapshot.graphVersion !== graph.metadata.graphVersion)) return null;
  const exists = selection.kind === "survivor"
    ? snapshot?.survivors.some(item => item.id === selection.id)
    : selection.kind === "shelter"
      ? graph.refugios.some(item => item.id === selection.id)
      : graph.aristas.some(item => item.segmentoId === selection.id);
  return exists ? selection : null;
}

export function observeReceipt(receipt: ControlReceipt, snapshot: WorldSnapshot): ControlReceipt {
  if (receipt.gameId !== snapshot.gameId || receipt.phase !== "scheduled" ||
      receipt.effectiveTurnId === undefined || snapshot.turnId < receipt.effectiveTurnId) return receipt;
  const blocked = snapshot.blockedEdges.some(item => item.segmentoId === receipt.segmentoId && item.desbloqueadaEnTurno === null);
  return blocked === receipt.blocked ? { ...receipt, phase: "observed", observedAtTurnId: snapshot.turnId } : receipt;
}

export function survivorDisplacement(current: WorldSnapshot | null, previous: WorldSnapshot | null, id: string) {
  if (!current || !previous || current.gameId !== previous.gameId || current.graphVersion !== previous.graphVersion ||
      current.turnId !== previous.turnId + 1) return null;
  const from = previous.survivors.find(item => item.id === id);
  const to = current.survivors.find(item => item.id === id);
  return from && to ? { from: from.nodeId, to: to.nodeId } : null;
}
