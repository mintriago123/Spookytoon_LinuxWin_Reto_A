import type { DecisionBatch, WorldState } from "./types.ts";

export interface RoutingAlert {
  level: "critical";
  code: "ROUTING_UNAUTHORIZED";
  gameId: string;
  turnId: number;
  message: string;
}

/** Convierte la señal del resolver en pausa al cierre del turno y evento de alerta. */
export function applyRoutingFailureSignal(state: WorldState, batch: DecisionBatch): RoutingAlert | null {
  if (batch.pauseCause === null && batch.alertCode === null) return null;
  if (batch.pauseCause !== "routing-unauthorized" || batch.alertCode !== "ROUTING_UNAUTHORIZED") {
    throw new Error("Señal de pausa/alerta de routing inconsistente");
  }
  if (state.gameId !== batch.gameId || state.activeTurnId !== batch.turnId) {
    throw new Error("La señal de autorización no coincide con la partida y turno activos");
  }
  state.pause = { status: "requested", cause: "routing-unauthorized",
    reason: "El motor de rutas rechazó x-api-key (HTTP 401)", afterTurnId: batch.turnId };
  return { level: "critical", code: "ROUTING_UNAUTHORIZED", gameId: batch.gameId,
    turnId: batch.turnId, message: "La clave del motor de rutas fue rechazada; partida en pausa" };
}
