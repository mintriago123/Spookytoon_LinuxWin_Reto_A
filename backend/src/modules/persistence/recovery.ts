import type { MantaGraph } from "../../contracts/types.ts";
import { createWorldState } from "../simulator/world-state.ts";
import { buildWorldSyncRequest } from "../simulator/routing-world.ts";
import type { WorldState } from "../simulator/types.ts";
import type { StoredGame } from "./adapter.ts";

/** Valida identidad del artefacto, escenario, entidades y cupos antes de exponer la recuperación. */
export function recoverWorld(game: StoredGame, graph: MantaGraph): WorldState {
  if (game.graphVersion !== graph.metadata.graphVersion || game.status !== "paused" ||
      !Number.isSafeInteger(game.turnId) || game.turnId < 0 || game.turnId >= 150 ||
      !Number.isSafeInteger(game.worldVersion) || game.worldVersion < game.turnId || game.rngSeed !== game.randomState.seed) {
    throw new Error("Checkpoint incompatible con el backend");
  }
  const initial = createWorldState({ gameId: game.gameId, graph, roundConfig: game.roundConfig,
    randomState: game.randomState, initialMetrics: game.metrics, updatedAt: game.updatedAt });
  const sameIds = (a: readonly { id: string }[], b: readonly { id: string }[]) =>
    a.length === b.length && new Set(b.map(x => x.id)).size === a.length && a.every(x => b.some(y => y.id === x.id));
  if (!sameIds(initial.survivors, game.survivors) || !sameIds(initial.zombies, game.zombies)) throw new Error("Entidades del checkpoint no coinciden con el escenario");
  const nodes = new Set(graph.nodos.map(n => n.id));
  if (game.zombies.some(z => !nodes.has(z.nodeId) || !["activo", "dormido"].includes(z.estado) ||
      (z.estado === "dormido" && z.tipo !== "dormido") || initial.zombies.find(x => x.id === z.id)?.tipo !== z.tipo)) throw new Error("Zombie recuperado inválido");
  const eventIds = new Set<string>();
  if (game.pendingCityEvents.some(e => eventIds.has(e.eventId) || !eventIds.add(e.eventId) ||
      !graph.aristas.some(edge => edge.id === e.edgeId) || !Number.isSafeInteger(e.effectiveTurnId) ||
      e.effectiveTurnId < 1 || e.effectiveTurnId > 150 || !["bloquear-segmento", "desbloquear-segmento"].includes(e.tipo) ||
      (e.effectiveTurnId <= game.turnId && !e.aplicado))) throw new Error("Eventos recuperados inválidos");
  const { graphVersion: _graphVersion, ...dynamic } = game;
  const world: WorldState = { ...initial, ...dynamic, graph, activeTurn: null, activeTurnId: null,
    routing: { confirmed: null, uncertain: false, attemptedRequest: null } };
  buildWorldSyncRequest(world, Math.max(1, world.turnId));
  return world;
}
