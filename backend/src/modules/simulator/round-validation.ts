import type { MantaGraph } from "../../contracts/types.ts";
import type { ZombieType } from "../../contracts/routing.ts";
import type { Immutable, RoundConfig } from "./types.ts";

type RecordValue = Record<string, unknown>;

function invalid(message: string): never {
  throw new Error(`Configuración de ronda inválida: ${message}`);
}

function record(value: unknown, fields: string[], name: string): RecordValue {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid(`${name} debe ser un objeto`);
  const item = value as RecordValue;
  if (Object.keys(item).length !== fields.length || !fields.every(key => Object.hasOwn(item, key))) {
    invalid(`${name} contiene campos faltantes o no admitidos`);
  }
  return item;
}

function text(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 256) invalid(`${name} debe ser texto no vacío de hasta 256 caracteres`);
  return value;
}

function list(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) invalid(`${name} debe ser una lista explícita`);
  return Array.from(value);
}

/** Recibe un grafo ya validado por graph. No infiere posiciones ni completa datos. */
export function validateRoundConfig(value: unknown, graph: Immutable<MantaGraph>): RoundConfig {
  const config = record(value, ["roundId", "durationMs", "turnIntervalMs", "turnCount",
    "survivorCount", "survivorSpawns", "zombieSpawns", "eventPlan"], "ronda");
  const roundId = config.roundId;
  if (roundId !== 1 && roundId !== 2 && roundId !== 3) invalid("roundId debe ser 1, 2 o 3");
  if (config.durationMs !== 300_000 || config.turnIntervalMs !== 2_000 || config.turnCount !== 150) {
    invalid("se requieren 150 turnos de 2.000 ms y duración de 300.000 ms");
  }
  const survivorCount = roundId === 1 ? 20 : roundId === 2 ? 80 : 200;
  if (config.survivorCount !== survivorCount) invalid(`la ronda ${roundId} requiere ${survivorCount} sobrevivientes`);
  const nodeIds = new Set(graph.nodos.map(node => node.id));
  const entityIds = new Set<string>();
  function spawn(value: unknown, fields: string[], name: string) {
    const item = record(value, fields, name);
    const id = text(item.id, `${name}.id`);
    const nodeId = text(item.nodeId, `${name}.nodeId`);
    if (entityIds.has(id)) invalid(`ID de entidad duplicado: ${id}`);
    if (!nodeIds.has(nodeId)) invalid(`nodo desconocido en ${name}: ${nodeId}`);
    entityIds.add(id);
    return { item, id, nodeId };
  }
  const survivorSpawns = list(config.survivorSpawns, "survivorSpawns").map((value, index) => {
    const { id, nodeId } = spawn(value, ["id", "nodeId"], `survivorSpawns[${index}]`);
    return { id, nodeId };
  });
  if (survivorSpawns.length !== survivorCount) invalid("survivorSpawns no coincide con survivorCount");
  const types: ZombieType[] = ["caminante", "corredor", "horda", "dormido"];
  const zombieSpawns = list(config.zombieSpawns, "zombieSpawns").map((value, index) => {
    const { item, id, nodeId } = spawn(value, ["id", "tipo", "nodeId"], `zombieSpawns[${index}]`);
    if (!types.includes(item.tipo as ZombieType)) invalid(`tipo zombie desconocido: ${String(item.tipo)}`);
    return { id, nodeId, tipo: item.tipo as ZombieType };
  });
  for (const type of types) {
    const required = type === "caminante" || roundId === 3 || (roundId === 2 && type !== "dormido");
    const count = zombieSpawns.filter(zombie => zombie.tipo === type).length;
    if ((required && count === 0) || (!required && count !== 0)) invalid(`composición de ${type} incompatible con ronda ${roundId}`);
  }
  const forbiddenNodes = new Set([
    ...graph.refugios.map(shelter => shelter.nodoId),
    ...zombieSpawns.map(zombie => zombie.nodeId),
  ]);
  const hordeNodes = new Set(zombieSpawns.filter(zombie => zombie.tipo === "horda").map(zombie => zombie.nodeId));
  for (const edge of graph.aristas) {
    if (hordeNodes.has(edge.origen)) forbiddenNodes.add(edge.destino);
    if (hordeNodes.has(edge.destino)) forbiddenNodes.add(edge.origen);
  }
  for (const survivor of survivorSpawns) if (forbiddenNodes.has(survivor.nodeId)) {
    invalid(`sobreviviente ${survivor.id} inicia en zombie, zona de horda o refugio`);
  }
  const eventIds = new Set<string>();
  const segments = new Set<string>();
  const edges = new Map(graph.aristas.map(edge => [edge.id, edge]));
  const eventPlan = list(config.eventPlan, "eventPlan").map((value, index) => {
    const item = record(value, ["eventId", "edgeId", "effectiveTurnId", "reason"], `eventPlan[${index}]`);
    const eventId = text(item.eventId, "eventId");
    const edgeId = text(item.edgeId, "edgeId");
    if (eventIds.has(eventId)) invalid(`eventId duplicado: ${eventId}`);
    const edge = edges.get(edgeId);
    if (!edge) invalid(`arista de evento desconocida: ${edgeId}`);
    if (segments.has(edge.segmentoId)) invalid(`eventos repiten segmento: ${edge.segmentoId}`);
    if (!Number.isSafeInteger(item.effectiveTurnId) || (item.effectiveTurnId as number) < 1 ||
        (item.effectiveTurnId as number) > 150) invalid("effectiveTurnId debe estar entre 1 y 150");
    if (roundId === 1 || (roundId === 2 && (edge.tipo !== "puente" || item.reason !== "colapso-puente")) ||
        (roundId === 3 && (edge.tipo !== "calle" || item.reason !== "bloqueo-calle"))) {
      invalid(`evento incompatible con ronda ${roundId}`);
    }
    eventIds.add(eventId); segments.add(edge.segmentoId);
    return { eventId, edgeId, effectiveTurnId: item.effectiveTurnId as number,
      reason: item.reason as "colapso-puente" | "bloqueo-calle" };
  });
  const eventCount = roundId - 1;
  if (eventPlan.length !== eventCount) invalid(`la ronda ${roundId} requiere ${eventCount} eventos`);
  return { roundId, durationMs: 300_000, turnIntervalMs: 2_000, turnCount: 150,
    survivorCount, survivorSpawns, zombieSpawns, eventPlan };
}
