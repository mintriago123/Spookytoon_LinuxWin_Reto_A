import type { DecisionBatch, RouteAttempt, TelemetryMetrics, WorldState } from "../simulator/types.ts";

export interface RouteLatencySample {
  latencyMs: number;
  available: boolean;
}

export interface TurnMetricsResult {
  metrics: TelemetryMetrics;
  samples: RouteLatencySample[];
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(p * sorted.length) - 1);
  return Math.round(sorted[index] * 10) / 10;
}

/** Actualiza contadores acumulados y percentiles/disponibilidad de las últimas 1.000 llamadas. */
export function updateTurnMetrics(
  world: WorldState,
  previousSamples: readonly RouteLatencySample[],
  attempts: readonly RouteAttempt[],
  decisions: DecisionBatch,
  turnDurationMs: number,
): TurnMetricsResult {
  const decisionsById = new Map(decisions.decisions.map(decision => [decision.survivorId, decision]));
  const validatedIds = decisions.validResponseSurvivorIds === undefined ? null : new Set(decisions.validResponseSurvivorIds);
  const samples = [...previousSamples];
  let timedOut = 0;
  let invalidResponses = 0;
  let routeErrors = 0;

  for (const attempt of attempts) {
    const decision = decisionsById.get(attempt.request.survivorId);
    const isTimeout = attempt.kind === "timeout" || attempt.elapsedMs > 500;
    const invalid = attempt.kind === "response" && decision?.decision === "esperar" &&
      (decision.cause === "invalid-response" || decision.cause === "late-response");
    const validResponse = attempt.kind === "response" && (validatedIds
      ? validatedIds.has(attempt.request.survivorId)
      : decision?.decision === "mover" || (decision?.decision === "esperar" && decision.cause === "routing-wait"));
    if (isTimeout) timedOut++;
    else if (attempt.kind === "error") routeErrors++;
    else if (invalid || !validResponse) invalidResponses++;
    samples.push({ latencyMs: Math.min(500, Math.max(0, isTimeout ? 500 : attempt.elapsedMs)),
      available: validResponse && !isTimeout });
  }
  const window = samples.slice(-1_000);
  const latencies = window.map(sample => sample.latencyMs);
  const metrics = { ...world.metrics,
    routeSamples: window.length,
    routeLatencyP50Ms: percentile(latencies, 0.5),
    routeLatencyP95Ms: percentile(latencies, 0.95),
    routeLatencyP99Ms: percentile(latencies, 0.99),
    routeAvailabilityPercent: window.length
      ? Math.round(window.filter(sample => sample.available).length * 1_000 / window.length) / 10
      : 0,
    routeTimeouts: world.metrics.routeTimeouts + timedOut,
    invalidRouteResponses: world.metrics.invalidRouteResponses + invalidResponses,
    routeErrors: (world.metrics.routeErrors ?? 0) + routeErrors,
    activeSurvivors: world.survivors.filter(survivor => survivor.estado === "vivo").length,
    bittenSurvivors: world.survivors.filter(survivor => survivor.estado === "mordido").length,
    evacuatedSurvivors: world.survivors.filter(survivor => survivor.estado === "evacuado").length,
    activeZombies: world.zombies.filter(zombie => zombie.estado === "activo").length,
    turnDurationMs: Math.round(turnDurationMs * 10) / 10,
    turnBudgetUsedPercent: Math.round(turnDurationMs / world.roundConfig.turnIntervalMs * 1_000) / 10,
    turnEfficiencyPercent: Math.round((world.turnId + 1 - world.metrics.deadlineMisses) * 1_000 / (world.turnId + 1)) / 10,
  };
  const percent = (count: number) => Math.round(count * 1_000 / world.roundConfig.survivorCount) / 10;
  metrics.activeSurvivorsPercent = percent(metrics.activeSurvivors);
  metrics.bittenSurvivorsPercent = percent(metrics.bittenSurvivors);
  metrics.evacuatedSurvivorsPercent = percent(metrics.evacuatedSurvivors);
  metrics.survivalRatePercent = Math.round(
    (metrics.activeSurvivors + metrics.evacuatedSurvivors) * 1_000 / world.roundConfig.survivorCount,
  ) / 10;
  return { metrics, samples: window };
}
