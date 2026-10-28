import { createHash } from "node:crypto";
import { canonicalJson } from "../../contracts/canonical-json.ts";
import type { MantaGraph } from "../../contracts/types.ts";
import type { StartCommand, RestartSource } from "./controls.ts";
import type { Immutable, RoundConfig, SurveillanceCamera } from "./types.ts";
import { RANDOM_ALGORITHM, RANDOM_ALGORITHM_VERSION } from "./random.ts";

/** Huella de concurrencia, no token de autenticación ni versión persistida de partida. */
export function preparationRevision(command: StartCommand, graph: Immutable<MantaGraph>,
  config: RoundConfig, cameras: readonly SurveillanceCamera[] = [], restart?: RestartSource): string {
  return createHash("sha256").update(canonicalJson({
    format: "spookython-preparation-v1", gameId: command.gameId, roundId: command.roundId,
    seed: command.seed, graph, config, cameras,
    ...(restart ? { restart } : {}),
    random: { algorithm: RANDOM_ALGORITHM, algorithmVersion: RANDOM_ALGORITHM_VERSION,
      strategy: "per-zombie-turn-draw" },
  }), "utf8").digest("hex");
}

export function summarizeRound(config: Immutable<RoundConfig>) {
  const zombieCounts = { caminante: 0, corredor: 0, horda: 0, dormido: 0 };
  for (const zombie of config.zombieSpawns) zombieCounts[zombie.tipo]++;
  return { roundId: config.roundId, durationMs: config.durationMs, turnIntervalMs: config.turnIntervalMs,
    turnCount: config.turnCount, survivorCount: config.survivorCount, zombieCounts, eventPlan: config.eventPlan };
}
