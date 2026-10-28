import type { RoundId } from "./types.ts";

export class SimulatorControlError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message); this.name = "SimulatorControlError"; this.status = status; this.code = code;
  }
}

export interface StartCommand { gameId: string; roundId: RoundId; seed: string; preparationRevision?: string }
export interface RestartSource { sourceGameId: string; sourceConfigurationRevision: string; reuseSavedConfig: boolean }
export interface RestartCommand extends StartCommand { restart?: RestartSource }
export interface PreparationCommand { gameId: string; roundId: RoundId; seed: string; graphVersion: string; restart?: RestartSource }
export interface ResumeCommand { gameId: string; roundId: RoundId; seed?: string }
export interface EdgeCommand { eventId: string; edgeId: string; bloqueada: boolean; motivo: string; effectiveTurnId?: number }

function object(value: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      !required.every(key => Object.hasOwn(value, key)) ||
      Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) {
    throw new SimulatorControlError(400, "VALIDATION_ERROR", "El control requiere el esquema cerrado del SPEC");
  }
  return value as Record<string, unknown>;
}
function text(value: unknown, field: string, max = 256): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new SimulatorControlError(400, "VALIDATION_ERROR", `${field} debe ser texto no vacío de hasta ${max} caracteres`);
  }
  return value;
}

export function parseStartCommand(value: unknown): StartCommand {
  const item = object(value, ["gameId", "roundId", "seed"], ["preparationRevision"]);
  if (item.roundId !== 1 && item.roundId !== 2 && item.roundId !== 3) {
    throw new SimulatorControlError(400, "VALIDATION_ERROR", "roundId debe ser 1, 2 o 3");
  }
  if (Object.hasOwn(item, "preparationRevision") &&
      (typeof item.preparationRevision !== "string" || !/^[a-f0-9]{64}$/.test(item.preparationRevision))) {
    throw new SimulatorControlError(400, "VALIDATION_ERROR", "preparationRevision debe ser una huella SHA-256 válida");
  }
  return { gameId: text(item.gameId, "gameId", 128), roundId: item.roundId, seed: text(item.seed, "seed"),
    ...(Object.hasOwn(item, "preparationRevision") ? { preparationRevision: item.preparationRevision as string } : {}) };
}
export function parsePreparationCommand(value: unknown): PreparationCommand {
  const item = object(value, ["gameId", "roundId", "seed", "graphVersion"], ["restart"]);
  const command = parseStartCommand({ gameId: item.gameId, roundId: item.roundId, seed: item.seed });
  return { gameId: command.gameId, roundId: command.roundId, seed: command.seed,
    graphVersion: text(item.graphVersion, "graphVersion"),
    ...(Object.hasOwn(item, "restart") ? { restart: parseRestartSource(item.restart) } : {}) };
}
function parseRestartSource(value: unknown): RestartSource {
  const item = object(value, ["sourceGameId", "sourceConfigurationRevision", "reuseSavedConfig"]);
  if (typeof item.reuseSavedConfig !== "boolean" || typeof item.sourceConfigurationRevision !== "string" ||
      !/^[a-f0-9]{64}$/.test(item.sourceConfigurationRevision)) {
    throw new SimulatorControlError(400, "VALIDATION_ERROR", "Referencia de configuración guardada inválida");
  }
  return { sourceGameId: text(item.sourceGameId, "sourceGameId", 128),
    sourceConfigurationRevision: item.sourceConfigurationRevision, reuseSavedConfig: item.reuseSavedConfig };
}
export function parseRestartCommand(value: unknown): RestartCommand {
  const item = object(value, ["gameId", "roundId", "seed"], ["preparationRevision", "restart"]);
  const { restart, ...start } = item;
  return { ...parseStartCommand(start), ...(Object.hasOwn(item, "restart") ? { restart: parseRestartSource(restart) } : {}) };
}
export function parseOperatorPassword(value: unknown): string {
  return text(object(value, ["password"]).password, "password");
}
export function parsePauseCommand(value: unknown): { reason: string } {
  const item = object(value, ["reason"]);
  return { reason: text(item.reason, "reason") };
}
export function parseResumeCommand(value: unknown): ResumeCommand {
  const item = object(value, ["gameId", "roundId"], ["seed"]);
  if (item.roundId !== 1 && item.roundId !== 2 && item.roundId !== 3) {
    throw new SimulatorControlError(400, "VALIDATION_ERROR", "roundId debe ser 1, 2 o 3");
  }
  return { gameId: text(item.gameId, "gameId", 128), roundId: item.roundId,
    ...(Object.hasOwn(item, "seed") ? { seed: text(item.seed, "seed") } : {}) };
}
export function parseEdgeCommand(value: unknown): EdgeCommand {
  const item = object(value, ["eventId", "edgeId", "bloqueada", "motivo"], ["effectiveTurnId"]);
  if (typeof item.bloqueada !== "boolean" || (Object.hasOwn(item, "effectiveTurnId") &&
      (!Number.isSafeInteger(item.effectiveTurnId) || (item.effectiveTurnId as number) < 1 || (item.effectiveTurnId as number) > 150))) {
    throw new SimulatorControlError(400, "VALIDATION_ERROR", "bloqueada debe ser booleano y effectiveTurnId estar entre 1 y 150");
  }
  return { eventId: text(item.eventId, "eventId"), edgeId: text(item.edgeId, "edgeId"),
    bloqueada: item.bloqueada, motivo: text(item.motivo, "motivo"),
    ...(item.effectiveTurnId === undefined ? {} : { effectiveTurnId: item.effectiveTurnId as number }) };
}
