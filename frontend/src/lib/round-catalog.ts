import type { RoundCatalog } from "../types/contracts";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

export function sameRoundSummary(a: RoundCatalog["rounds"][number], b: RoundCatalog["rounds"][number]): boolean {
  const key = (round: RoundCatalog["rounds"][number]) => JSON.stringify([
    round.roundId, round.durationMs, round.turnIntervalMs, round.turnCount, round.survivorCount,
    round.zombieCounts.caminante, round.zombieCounts.corredor, round.zombieCounts.horda, round.zombieCounts.dormido,
    round.eventPlan.map(event => [event.eventId, event.edgeId, event.effectiveTurnId, event.reason]),
  ]);
  return key(a) === key(b);
}

export function isRoundSummary(round: unknown): round is RoundCatalog["rounds"][number] {
  if (!isRecord(round) || ![1, 2, 3].includes(round.roundId as number) ||
      round.durationMs !== 300000 || round.turnIntervalMs !== 2000 || round.turnCount !== 150 ||
      round.survivorCount !== [20, 80, 200][(round.roundId as number) - 1] ||
      !isRecord(round.zombieCounts) || !Array.isArray(round.eventPlan)) return false;
  const counts = round.zombieCounts;
  return ["caminante", "corredor", "horda", "dormido"].every(type => isCount(counts[type])) &&
    round.eventPlan.every((event: unknown) => isRecord(event) && isText(event.eventId) &&
      isText(event.edgeId) && isCount(event.effectiveTurnId) && event.effectiveTurnId >= 1 &&
      event.effectiveTurnId <= 150 && ["colapso-puente", "bloqueo-calle"].includes(event.reason as string));
}

/** Una respuesta HTML o un catálogo incompleto nunca se presenta como configuración efectiva. */
export async function loadRoundCatalog(baseUrl: string, signal: AbortSignal): Promise<RoundCatalog> {
  const response = await fetch(`${baseUrl}/simulador/rondas`, {
    credentials: "include", cache: "no-store", signal,
  });
  if (response.status !== 200) throw new Error(`No se pudo consultar la configuración (HTTP ${response.status}).`);
  const data: unknown = await response.json();
  if (!isRecord(data) || !isText(data.graphVersion) || !Array.isArray(data.rounds) ||
      data.rounds.length !== 3 || !data.rounds.every(isRoundSummary) ||
      new Set(data.rounds.map(round => round.roundId)).size !== 3) {
    throw new Error("El servidor no devolvió un catálogo de rondas válido.");
  }
  return data as unknown as RoundCatalog;
}
