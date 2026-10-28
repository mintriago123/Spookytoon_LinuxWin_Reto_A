import type { MantaGraph } from "../../contracts/types.ts";
import type { Immutable, RandomState, RoundConfig, SurveillanceCamera, TelemetryMetrics, WorldState } from "./types.ts";
import { validateRoundConfig } from "./round-validation.ts";
import { validateRandomState } from "./random.ts";

function frozenCopy<T>(value: T): Immutable<T> {
  function freeze(item: unknown): void {
    if (item !== null && typeof item === "object") {
      for (const child of Object.values(item)) freeze(child);
      Object.freeze(item);
    }
  }
  const copy = structuredClone(value);
  freeze(copy);
  return copy as Immutable<T>;
}

export function createInitialTelemetryMetrics(config: Immutable<RoundConfig>): TelemetryMetrics {
  return { routeSamples: 0, routeLatencyP50Ms: 0, routeLatencyP95Ms: 0, routeLatencyP99Ms: 0,
    routeTimeouts: 0, invalidRouteResponses: 0, routeErrors: 0, routeAvailabilityPercent: 0,
    deadlineMisses: 0, activeSurvivors: config.survivorCount, bittenSurvivors: 0,
    evacuatedSurvivors: 0, activeZombies: config.zombieSpawns.filter(zombie => zombie.tipo !== "dormido").length,
    survivalRatePercent: 100, activeSurvivorsPercent: 100, bittenSurvivorsPercent: 0,
    evacuatedSurvivorsPercent: 0, turnDurationMs: 0, turnBudgetUsedPercent: 0, turnEfficiencyPercent: 100,
    wsClients: 0, snapshotQueueDepth: 0, lastSnapshotTurnId: null };
}

/** Construye una partida idle, no inicia reloj, routing, PRNG ni publicaciones.
 * El llamador suministra el grafo validado, el descriptor aleatorio acordado,
 * las métricas iniciales de telemetría y una fecha UTC explícita.
 */
export function createWorldState(input: {
  gameId: string;
  graph: Immutable<MantaGraph>;
  roundConfig: unknown;
  randomState: Immutable<RandomState>;
  initialMetrics: Immutable<TelemetryMetrics>;
  updatedAt: string;
  cameras?: readonly SurveillanceCamera[];
}): WorldState {
  if (typeof input.gameId !== "string" || !input.gameId.trim() || input.gameId.length > 128) {
    throw new Error("gameId debe ser texto no vacío de hasta 128 caracteres");
  }
  const roundConfig = validateRoundConfig(input.roundConfig, input.graph);
  const random = input.randomState;
  validateRandomState(random);
  if (typeof input.updatedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(input.updatedAt) ||
      !Number.isFinite(Date.parse(input.updatedAt)) ||
      new Date(input.updatedAt).toISOString() !== (input.updatedAt.includes(".")
        ? input.updatedAt : input.updatedAt.replace("Z", ".000Z"))) {
    throw new Error("updatedAt debe ser una fecha ISO-8601 UTC válida");
  }
  if (!input.initialMetrics) throw new Error("Se requieren métricas iniciales suministradas por telemetría");
  return {
    gameId: input.gameId, roundId: roundConfig.roundId, status: "idle", phase: "idle",
    turnId: 0, worldVersion: 0, activeTurnId: null, activeTurn: null,
    graph: frozenCopy(input.graph), roundConfig: frozenCopy(roundConfig),
    zombies: roundConfig.zombieSpawns.map(spawn => ({ ...spawn,
      estado: spawn.tipo === "dormido" ? "dormido" : "activo",
      despertadoEnTurno: null,
      siguienteMovimientoTurno: spawn.tipo === "caminante" ? 2 : spawn.tipo === "corredor" ? 1 : null,
    })),
    survivors: roundConfig.survivorSpawns.map(spawn => ({ ...spawn, estado: "vivo",
      targetShelterId: null, eliminadoEnTurno: null, evacuadoEnTurno: null })),
    shelters: input.graph.refugios.map(shelter => ({ ...shelter, ocupantes: [], reservados: [] })),
    blockedEdges: [], pendingCityEvents: roundConfig.eventPlan.map(event => ({
      eventId: event.eventId, tipo: "bloquear-segmento", edgeId: event.edgeId,
      motivo: event.reason, effectiveTurnId: event.effectiveTurnId, aplicado: false, origen: "evento-ciudad",
    })),
    lastZombieTraversals: [], cameras: structuredClone([...(input.cameras ?? [])]), cameraObservations: [],
    metrics: { ...createInitialTelemetryMetrics(roundConfig), ...structuredClone(input.initialMetrics),
      activeSurvivors: roundConfig.survivorCount, bittenSurvivors: 0, evacuatedSurvivors: 0,
      activeZombies: roundConfig.zombieSpawns.filter(zombie => zombie.tipo !== "dormido").length },
    rngSeed: random.seed, randomState: { ...random }, pause: { status: "none" },
    routing: { confirmed: null, uncertain: false, attemptedRequest: null }, updatedAt: input.updatedAt,
  };
}
