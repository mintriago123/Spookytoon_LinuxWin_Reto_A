import type { IniciarResponse, PreparationRequest, PreparationResponse } from "../types/contracts";
import { OperatorControlError, operatorResponseError } from "./operator-controls";
import { isRoundSummary } from "./round-catalog";

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

async function post(baseUrl: string, path: string, body: unknown, status: number,
  signal: AbortSignal, fetcher: typeof fetch): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(`${baseUrl}${path}`, { method: "POST", credentials: "include",
      cache: "no-store", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body), signal });
  } catch {
    throw new OperatorControlError(path.endsWith("iniciar")
      ? "No se pudo confirmar el inicio. Revisa el estado de la partida."
      : "No se pudo comprobar la preparación de la partida.", "uncertain");
  }
  if (response.status !== status) throw await operatorResponseError(response);
  try { return await response.json(); }
  catch { throw new OperatorControlError("El servidor devolvió una respuesta inválida.", "uncertain"); }
}

export async function prepareGame(baseUrl: string, command: PreparationRequest,
  signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<PreparationResponse> {
  const prepared = await post(baseUrl, "/simulador/prevalidar", command, 200, signal, fetcher);
  if (!record(prepared) || prepared.gameId !== command.gameId || prepared.roundId !== command.roundId ||
      prepared.seed !== command.seed || prepared.graphVersion !== command.graphVersion ||
      typeof prepared.preparationRevision !== "string" || !/^[a-f0-9]{64}$/.test(prepared.preparationRevision) ||
      !isRoundSummary(prepared.round) || prepared.round.roundId !== command.roundId) {
    throw new OperatorControlError("La respuesta de preparación no corresponde a la partida solicitada.", "rejected");
  }
  const source = prepared.restart;
  if (command.restart ? (!record(source) || source.sourceGameId !== command.restart.sourceGameId ||
      source.sourceConfigurationRevision !== command.restart.sourceConfigurationRevision ||
      source.reuseSavedConfig !== command.restart.reuseSavedConfig) : source !== undefined) {
    throw new OperatorControlError("La respuesta no corresponde al reinicio solicitado.", "rejected");
  }
  return { ...command, ...(command.restart ? { restart: { ...command.restart } } : {}),
    preparationRevision: prepared.preparationRevision, round: prepared.round };
}

/** Confirma una preparación revisada. Nunca reintenta un inicio o reinicio. */
export async function startPreparedGame(baseUrl: string, command: PreparationResponse,
  signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<IniciarResponse> {
  signal.throwIfAborted();
  const result = await post(baseUrl, command.restart ? "/simulador/reiniciar" : "/simulador/iniciar", {
    gameId: command.gameId, roundId: command.roundId, seed: command.seed,
    preparationRevision: command.preparationRevision,
    ...(command.restart ? { restart: command.restart } : {}),
  }, 202, signal, fetcher);
  if (!record(result) || result.gameId !== command.gameId || result.roundId !== command.roundId ||
      result.status !== "running" || result.nextTurnId !== 1) {
    throw new OperatorControlError("No se pudo asociar la respuesta de inicio a esta partida. Revisa su estado.", "uncertain");
  }
  return { gameId: command.gameId, roundId: command.roundId, status: "running", nextTurnId: 1 };
}

/** Mantiene una única identidad/semilla en ambas solicitudes; nunca reintenta iniciar. */
export async function prepareAndStartGame(baseUrl: string, command: PreparationRequest,
  onPrepared: (preparation: PreparationResponse) => void, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<IniciarResponse> {
  const prepared = await prepareGame(baseUrl, command, signal, fetcher);
  signal.throwIfAborted();
  onPrepared(prepared);
  return startPreparedGame(baseUrl, prepared, signal, fetcher);
}
