import { create } from "zustand";
import type { MantaGraph, WorldSnapshot } from "../types/contracts";

export type SocketStatus = "connecting" | "open" | "reconnecting" | "closed";

export type PendingControl = "iniciar" | "pausar" | "bloquear-arista" | null;

/**
 * Store mínimo definido en SPEC.md §6:
 * graphVersion, currentSnapshot, previousSnapshot, receivedAt, socketStatus,
 * pendingControl, lastError.
 *
 * Reglas:
 * - El estado lógico viene siempre del Backend; este store nunca decide
 *   rutas, mordidas ni evacuaciones.
 * - Si graphVersion del snapshot difiere del grafo cargado, no se dibujan
 *   entidades (ver useGraphVersionMismatch).
 * - turnId duplicado o menor al actual se ignora (ver applySnapshot).
 */
export interface WorldStoreState {
  graph: MantaGraph | null;
  graphVersion: string | null;
  currentSnapshot: WorldSnapshot | null;
  previousSnapshot: WorldSnapshot | null;
  receivedAt: number | null;
  socketStatus: SocketStatus;
  pendingControl: PendingControl;
  lastError: string | null;

  setGraph: (graph: MantaGraph) => void;
  applySnapshot: (snapshot: WorldSnapshot) => void;
  setSocketStatus: (status: SocketStatus) => void;
  setPendingControl: (control: PendingControl) => void;
  setLastError: (message: string | null) => void;
}

export const useWorldStore = create<WorldStoreState>((set, get) => ({
  graph: null,
  graphVersion: null,
  currentSnapshot: null,
  previousSnapshot: null,
  receivedAt: null,
  socketStatus: "connecting",
  pendingControl: null,
  lastError: null,

  setGraph: (graph) =>
    set({ graph, graphVersion: graph.metadata.graphVersion }),

  applySnapshot: (snapshot) => {
    const current = get().currentSnapshot;
    // SPEC.md §6: ignorar turnId duplicado o menor al ya aplicado.
    if (current && snapshot.turnId <= current.turnId) {
      return;
    }
    set({
      previousSnapshot: current,
      currentSnapshot: snapshot,
      receivedAt: Date.now(),
    });
  },

  setSocketStatus: (status) => set({ socketStatus: status }),
  setPendingControl: (control) => set({ pendingControl: control }),
  setLastError: (message) => set({ lastError: message }),
}));

/** true si el grafo cargado y el snapshot activo no comparten graphVersion. */
export function hasGraphVersionMismatch(state: WorldStoreState): boolean {
  if (!state.graphVersion || !state.currentSnapshot) return false;
  return state.graphVersion !== state.currentSnapshot.graphVersion;
}
