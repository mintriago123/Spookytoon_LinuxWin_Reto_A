import type { RoutingStatusResponse, SyncResponse, WorldSyncRequest } from "../../contracts/routing.ts";
import type { Immutable, InstalledRoutingVersion, RoutingInstallationState } from "./types.ts";

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const item = value as Record<string, unknown>;
    return `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${stableJson(item[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function immutableCopy<T>(value: T): Immutable<T> {
  const copy = structuredClone(value);
  const freeze = (item: unknown) => {
    if (item !== null && typeof item === "object") {
      for (const child of Object.values(item)) freeze(child);
      Object.freeze(item);
    }
  };
  freeze(copy);
  return copy as Immutable<T>;
}

/** Guarda el payload exacto antes de enviarlo; un timeout no se confunde con rechazo. */
export function markRoutingSyncAttempt(
  state: RoutingInstallationState,
  request: WorldSyncRequest,
): RoutingInstallationState {
  if (state.uncertain && state.attemptedRequest) {
    if (stableJson(state.attemptedRequest) === stableJson(request)) return state;
    throw new Error("Reconciliar o repetir el payload incierto antes de instalar otra versión");
  }
  const expectedBase = state.confirmed?.worldVersion ?? 0;
  if (request.baseWorldVersion !== expectedBase) throw new Error("baseWorldVersion debe usar la última versión confirmada");
  if (state.confirmed && (request.gameId !== state.confirmed.gameId || request.turnId <= state.confirmed.turnId)) {
    throw new Error("La sincronización debe pertenecer al mismo gameId y a un turno posterior");
  }
  return { confirmed: state.confirmed, uncertain: true, attemptedRequest: immutableCopy(request) };
}

/** Acepta la respuesta solo si confirma exactamente el payload que estaba incierto. */
export function confirmRoutingSync(
  state: RoutingInstallationState,
  response: SyncResponse,
  expectedGraphVersion: string,
): RoutingInstallationState {
  const request = state.attemptedRequest;
  if (!state.uncertain || !request) throw new Error("No existe una sincronización pendiente de confirmación");
  if (!response.ready || response.turnId !== request.turnId ||
      response.worldVersion !== request.baseWorldVersion + 1 || response.graphVersion !== expectedGraphVersion) {
    throw new Error("La respuesta no confirma turno, versión y grafo del payload enviado");
  }
  const confirmed: InstalledRoutingVersion = {
    gameId: request.gameId, turnId: response.turnId,
    worldVersion: response.worldVersion, graphVersion: response.graphVersion,
  };
  return { confirmed: immutableCopy(confirmed), uncertain: false, attemptedRequest: null };
}

export type RoutingReconciliation = {
  state: RoutingInstallationState;
  action: "confirmed" | "retry-latest" | "pause";
};

/** Resuelve un timeout consultando GET /motor/estado/{gameId}. */
export function reconcileRoutingStatus(
  state: RoutingInstallationState,
  status: RoutingStatusResponse,
  expectedGraphVersion: string,
): RoutingReconciliation {
  const request = state.attemptedRequest;
  if (!state.uncertain || !request || status.gameId !== request.gameId) return { state, action: "pause" };
  const installed = status.installed;
  if (!installed && !state.confirmed) {
    return { state: { confirmed: null, uncertain: false, attemptedRequest: null }, action: "retry-latest" };
  }
  if (!installed || installed.graphVersion !== expectedGraphVersion) return { state, action: "pause" };
  if (installed.turnId === request.turnId && installed.worldVersion === request.baseWorldVersion + 1) {
    const nextState = confirmRoutingSync(state, installed, expectedGraphVersion);
    return { state: nextState, action: "confirmed" };
  }
  const previous = state.confirmed;
  if (previous && installed.turnId === previous.turnId && installed.worldVersion === previous.worldVersion &&
      installed.graphVersion === previous.graphVersion) {
    return { state: { confirmed: previous, uncertain: false, attemptedRequest: null }, action: "retry-latest" };
  }
  return { state, action: "pause" };
}
