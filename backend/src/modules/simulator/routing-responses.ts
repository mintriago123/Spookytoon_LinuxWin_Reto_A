import type { RoutingStatusResponse, SyncResponse } from "../../contracts/routing.ts";

function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).length !== keys.length || !keys.every(key => Object.hasOwn(value, key))) {
    throw new Error("Respuesta de routing fuera del esquema cerrado");
  }
  return value as Record<string, unknown>;
}

/** Los helpers de sincronización reciben contratos tipados; HTTP llega como unknown. */
export function parseSyncResponse(value: unknown): SyncResponse {
  const item = record(value, ["turnId", "worldVersion", "graphVersion", "workerCount", "buildLatencyMs", "ready"]);
  for (const key of ["turnId", "worldVersion", "workerCount"]) {
    if (!Number.isSafeInteger(item[key]) || (item[key] as number) < 1) throw new Error(`Respuesta de sync inválida: ${key}`);
  }
  if (typeof item.graphVersion !== "string" || !item.graphVersion || item.ready !== true ||
      typeof item.buildLatencyMs !== "number" || !Number.isFinite(item.buildLatencyMs) || item.buildLatencyMs < 0) {
    throw new Error("Respuesta de sync inválida");
  }
  return { turnId: item.turnId as number, worldVersion: item.worldVersion as number,
    graphVersion: item.graphVersion, workerCount: item.workerCount as number,
    buildLatencyMs: item.buildLatencyMs, ready: true };
}

export function parseRoutingStatus(value: unknown): RoutingStatusResponse {
  const item = record(value, ["gameId", "installed"]);
  if (typeof item.gameId !== "string" || !item.gameId) throw new Error("Estado de routing sin gameId válido");
  return { gameId: item.gameId, installed: item.installed === null ? null : parseSyncResponse(item.installed) };
}
