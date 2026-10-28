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
 * - Dentro de la MISMA partida (mismo gameId), turnId duplicado o menor al
 *   ya aplicado se ignora; turnId igual con el mismo status también es
 *   duplicado. Pero backend/.../simulation-runtime.ts publica a propósito
 *   snapshots con turnId igual y status distinto (reanudar desde paused,
 *   o pausar entre turnos sin que haya corrido un turno nuevo — "Acuerdo
 *   Etapa 7"); esos SÍ deben aplicarse o la UI se queda mostrando un
 *   status viejo para siempre.
 * - Una partida nueva (gameId distinto, p.ej. la siguiente ronda) siempre
 *   se acepta aunque su turnId reinicie por debajo del de la partida
 *   anterior, y no se interpola contra la posición final de esa partida
 *   anterior (ver applySnapshot).
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
    if (current) {
      const sameGame = current.gameId === snapshot.gameId;
      if (sameGame) {
        // Mismo gameId: turnId nunca retrocede (SPEC.md §3.4). Uno MENOR es
        // duplicado/atrasado (reconexión con mensaje viejo) y se ignora.
        if (snapshot.turnId < current.turnId) return;
        // turnId IGUAL solo es duplicado real si además el status no
        // cambió; si cambió (p.ej. paused → running al reanudar) es el
        // commit de control que el backend publica a propósito y hay que
        // aplicarlo.
        if (snapshot.turnId === current.turnId && snapshot.status === current.status) {
          return;
        }
      }
      set({
        // gameId distinto (partida nueva): no interpolar contra la última
        // posición de la partida anterior, aunque algún id de entidad
        // coincida entre rondas.
        previousSnapshot: sameGame ? current : null,
        currentSnapshot: snapshot,
        receivedAt: Date.now(),
      });
      return;
    }
    set({ previousSnapshot: null, currentSnapshot: snapshot, receivedAt: Date.now() });
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
