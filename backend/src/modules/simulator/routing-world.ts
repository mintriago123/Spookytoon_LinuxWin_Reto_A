import type { MantaGraph } from "../../contracts/types.ts";
import type { RouteZombie, WorldSyncRequest } from "../../contracts/routing.ts";
import { validateWorldSyncRequest } from "../../contracts/routing-validation.ts";
import type { Immutable, WorldState } from "./types.ts";

export function hordeDangerNodes(graph: Immutable<MantaGraph>, zombies: Immutable<RouteZombie[]>): string[] {
  const hordes = new Set(zombies.filter(z => z.tipo === "horda" && z.estado === "activo").map(z => z.nodeId));
  const danger = new Set(hordes);
  for (const edge of graph.aristas) {
    if (hordes.has(edge.origen)) danger.add(edge.destino);
    if (hordes.has(edge.destino)) danger.add(edge.origen);
  }
  return [...danger].sort();
}

/** Agregado dirigido de radio 2 del SPEC §4.1; no expone IDs ni objetos dormidos. */
export function dormantUncertaintyNodes(graph: Immutable<MantaGraph>, zombies: Immutable<RouteZombie[]>): string[] {
  const adjacency = new Map(graph.nodos.map(node => [node.id, [] as string[]]));
  for (const edge of graph.aristas) adjacency.get(edge.origen)!.push(edge.destino);
  const result = new Set<string>();
  for (const zombie of zombies) {
    if (zombie.tipo !== "dormido" || zombie.estado !== "dormido") continue;
    const visited = new Set([zombie.nodeId]);
    let frontier = [zombie.nodeId];
    for (let depth = 0; depth < 2; depth++) {
      const next: string[] = [];
      for (const node of frontier) for (const neighbor of adjacency.get(node) ?? []) {
        if (!visited.has(neighbor)) { visited.add(neighbor); next.push(neighbor); }
      }
      frontier = next;
    }
    for (const node of visited) result.add(node);
  }
  return [...result].sort();
}

/** Proyección explícita y validación del contrato público, nunca de WorldState entero. */
export function buildWorldSyncRequest(world: Immutable<WorldState>, turnId: number): WorldSyncRequest {
  return validateWorldSyncRequest({
    gameId: world.gameId, turnId, baseWorldVersion: world.routing.confirmed?.worldVersion ?? 0,
    survivors: structuredClone(world.survivors),
    zombies: structuredClone(world.zombies.filter(z => z.tipo !== "dormido" || z.estado === "activo")),
    shelters: structuredClone(world.shelters), blockedEdges: structuredClone(world.blockedEdges),
    zombieTraversals: structuredClone(world.lastZombieTraversals),
    dormantUncertaintyNodeIds: dormantUncertaintyNodes(world.graph, world.zombies),
    cameraObservations: structuredClone(world.cameraObservations.filter(observation => observation.expiresAfterTurnId > turnId)),
  }, world.graph as MantaGraph);
}
