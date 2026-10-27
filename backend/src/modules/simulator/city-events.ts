import type { MantaGraph } from "../../contracts/types.ts";
import type { RouteBlockedEdge } from "../../contracts/routing.ts";
import type { Immutable, ScheduledCityEvent } from "./types.ts";

/** Prepara eventos del turno sobre copias. El coordinador compromete el resultado. */
export function applyCityEvents(input: {
  turnId: number;
  graph: Immutable<MantaGraph>;
  events: Immutable<ScheduledCityEvent[]>;
  blockedEdges: Immutable<RouteBlockedEdge[]>;
}): { events: ScheduledCityEvent[]; blockedEdges: RouteBlockedEdge[] } {
  if (!Number.isSafeInteger(input.turnId) || input.turnId < 1 || input.turnId > 150) {
    throw new Error("Turno de eventos fuera de 1..150");
  }
  const edges = new Map(input.graph.aristas.map(edge => [edge.id, edge]));
  const events = input.events.map(event => ({ ...event }));
  const blocks = input.blockedEdges.map(block => ({ ...block, edgeIds: [...block.edgeIds] }));
  const ids = new Set<string>();
  const touched = new Set<string>();
  for (const event of events) {
    if (ids.has(event.eventId)) throw new Error(`eventId duplicado: ${event.eventId}`);
    ids.add(event.eventId);
    if (!Number.isSafeInteger(event.effectiveTurnId) || event.effectiveTurnId < 1 || event.effectiveTurnId > 150 ||
        !edges.has(event.edgeId) || !["bloquear-segmento", "desbloquear-segmento"].includes(event.tipo)) {
      throw new Error(`Evento inválido: ${event.eventId}`);
    }
    if (event.aplicado) continue;
    if (event.effectiveTurnId < input.turnId) throw new Error(`Evento efectivo sin aplicar: ${event.eventId}`);
    if (event.effectiveTurnId !== input.turnId) continue;
    const segment = edges.get(event.edgeId)!.segmentoId;
    if (touched.has(segment)) throw new Error(`Varios eventos del mismo turno afectan el segmento ${segment}`);
    touched.add(segment);
  }
  if (new Set(blocks.map(block => block.segmentoId)).size !== blocks.length) {
    throw new Error("Bloqueos repiten segmentoId");
  }
  for (const event of events) {
    if (event.aplicado || event.effectiveTurnId !== input.turnId) continue;
    const segmentoId = edges.get(event.edgeId)!.segmentoId;
    const index = blocks.findIndex(block => block.segmentoId === segmentoId);
    const previous = blocks[index];
    if (event.tipo === "bloquear-segmento") {
      const block: RouteBlockedEdge = {
        segmentoId,
        edgeIds: input.graph.aristas.filter(edge => edge.segmentoId === segmentoId).map(edge => edge.id).sort(),
        motivo: event.motivo, origen: event.origen,
        bloqueadaDesdeTurno: input.turnId, desbloqueadaEnTurno: null,
      };
      // Un bloqueo que ya está vigente conserva su inicio; el evento queda registrado.
      if (!previous) blocks.push(block);
      else if (previous.desbloqueadaEnTurno !== null && previous.desbloqueadaEnTurno <= input.turnId) blocks[index] = block;
    } else if (previous && (previous.desbloqueadaEnTurno === null || previous.desbloqueadaEnTurno > input.turnId)) {
      if (previous.bloqueadaDesdeTurno >= input.turnId) throw new Error("Intervalo de desbloqueo inválido");
      previous.desbloqueadaEnTurno = input.turnId;
    }
    event.aplicado = true;
  }
  return { events, blockedEdges: blocks };
}
