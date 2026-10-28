import type { GameConfiguration } from "../types/contracts";
import { isRoundSummary } from "./round-catalog";
import { operatorResponseError } from "./operator-controls";

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export async function loadGameConfiguration(baseUrl: string,
  expected: Pick<GameConfiguration, "gameId" | "roundId" | "graphVersion">,
  signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<GameConfiguration> {
  const response = await fetcher(`${baseUrl}/simulador/configuracion/${encodeURIComponent(expected.gameId)}`, {
    credentials: "include", cache: "no-store", signal,
  });
  if (response.status !== 200) throw await operatorResponseError(response);
  const data: unknown = await response.json();
  if (!record(data) || data.gameId !== expected.gameId || data.roundId !== expected.roundId ||
      data.graphVersion !== expected.graphVersion || !isRoundSummary(data.round) ||
      data.round.roundId !== expected.roundId || !record(data.configurationIdentity) ||
      data.configurationIdentity.format !== "spookython-round-configuration-v1" ||
      data.configurationIdentity.graphVersion !== expected.graphVersion ||
      typeof data.configurationIdentity.revision !== "string" || !/^[a-f0-9]{64}$/.test(data.configurationIdentity.revision) ||
      !["recorded-at-start", "derived-from-legacy-checkpoint"].includes(data.configurationIdentity.provenance as string) ||
      !record(data.random) || typeof data.random.seed !== "string" || !data.random.seed.trim() ||
      data.random.algorithm !== "sha256-counter" || data.random.algorithmVersion !== "1" ||
      data.random.strategy !== "per-zombie-turn-draw") {
    throw new Error("La configuración recibida no corresponde a esta partida.");
  }
  return data as unknown as GameConfiguration;
}
