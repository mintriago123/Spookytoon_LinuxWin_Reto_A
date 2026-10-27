import type { GraphEdge, MantaGraph } from "../../contracts/types.ts";
import type { RouteBlockedEdge, RouteSurvivor, RouteZombie } from "../../contracts/routing.ts";
import type { Immutable, RandomCursor, RandomState, ZombieTraversal } from "./types.ts";
import { randomIndex, validateRandomState } from "./random.ts";

type Edge = Immutable<GraphEdge>;
type Adjacency = Map<string, Edge[]>;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

function openAdjacency(graph: Immutable<MantaGraph>, blockedEdges: Immutable<RouteBlockedEdge[]>, turnId: number): Adjacency {
  const blocked = new Set(blockedEdges.filter(block => block.bloqueadaDesdeTurno <= turnId &&
    (block.desbloqueadaEnTurno === null || turnId < block.desbloqueadaEnTurno)).flatMap(block => [...block.edgeIds]));
  const adjacency: Adjacency = new Map(graph.nodos.map(node => [node.id, []]));
  for (const edge of graph.aristas) if (!blocked.has(edge.id)) adjacency.get(edge.origen)!.push(edge);
  for (const edges of adjacency.values()) edges.sort((a, b) => compare(a.id, b.id));
  return adjacency;
}

/** BFS dirigido, orden de edgeId: para cada destino retiene el primer camino mínimo. */
function reachable(adjacency: Adjacency, from: string, maxDepth: number) {
  const visited = new Map<string, { depth: number; firstEdge: Edge | null }>([[from, { depth: 0, firstEdge: null }]]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const current = visited.get(queue[i])!;
    if (current.depth === maxDepth) continue;
    for (const edge of adjacency.get(queue[i]) ?? []) {
      if (visited.has(edge.destino)) continue;
      visited.set(edge.destino, { depth: current.depth + 1, firstEdge: current.firstEdge ?? edge });
      queue.push(edge.destino);
    }
  }
  return visited;
}

function validTurn(turnId: number) {
  if (!Number.isSafeInteger(turnId) || turnId < 1 || turnId > 150) throw new Error("Turno zombie fuera de 1..150");
}

function awaken(zombies: Immutable<RouteZombie[]>, survivors: Immutable<RouteSurvivor[]>,
  adjacency: Adjacency, turnId: number, phase: "before-zombie-move" | "after-survivor-move"): RouteZombie[] {
  const livingNodes = new Set(survivors.filter(survivor => survivor.estado === "vivo").map(survivor => survivor.nodeId));
  return zombies.map(zombie => {
    if (zombie.tipo !== "dormido" || zombie.estado !== "dormido") return { ...zombie };
    const near = [...reachable(adjacency, zombie.nodeId, 2).keys()].some(node => livingNodes.has(node));
    return near ? { ...zombie, estado: "activo", despertadoEnTurno: turnId,
      siguienteMovimientoTurno: phase === "before-zombie-move" ? turnId : turnId + 1 } : { ...zombie };
  });
}

export function awakenDormantZombies(input: {
  turnId: number;
  phase: "before-zombie-move" | "after-survivor-move";
  graph: Immutable<MantaGraph>;
  zombies: Immutable<RouteZombie[]>;
  survivors: Immutable<RouteSurvivor[]>;
  blockedEdges: Immutable<RouteBlockedEdge[]>;
}): RouteZombie[] {
  validTurn(input.turnId);
  return awaken(input.zombies, input.survivors,
    openAdjacency(input.graph, input.blockedEdges, input.turnId), input.turnId, input.phase);
}

/** Intenciones contra la misma vista de vivos y cierres. No publica ni sincroniza.
 * Conserva los pasos completos conforme al contrato compartido RouteZombieTraversal.
 */
export function moveZombies(input: {
  turnId: number;
  graph: Immutable<MantaGraph>;
  zombies: Immutable<RouteZombie[]>;
  survivors: Immutable<RouteSurvivor[]>;
  blockedEdges: Immutable<RouteBlockedEdge[]>;
  randomState: Immutable<RandomState>;
}): { zombies: RouteZombie[]; traversals: ZombieTraversal[]; randomCursors: RandomCursor[] } {
  validTurn(input.turnId);
  validateRandomState(input.randomState);
  const adjacency = openAdjacency(input.graph, input.blockedEdges, input.turnId);
  const awake = awaken(input.zombies, input.survivors, adjacency, input.turnId, "before-zombie-move");
  const living = input.survivors.filter(survivor => survivor.estado === "vivo")
    .toSorted((a, b) => compare(a.id, b.id));
  const traversals: ZombieTraversal[] = [];
  const randomCursors: RandomCursor[] = [];
  const zombies = awake.map(zombie => {
    if (zombie.estado !== "activo" || zombie.tipo === "horda") return zombie;
    const runner = zombie.tipo === "corredor";
    if (!runner && zombie.siguienteMovimientoTurno === null) throw new Error(`Zombie activo sin cadencia: ${zombie.id}`);
    if (!runner && input.turnId < zombie.siguienteMovimientoTurno!) return zombie;
    let nodeId = zombie.nodeId;
    let drawIndex = 0;
    for (let stepIndex = 1; stepIndex <= (runner ? 2 : 1); stepIndex++) {
      const exits = adjacency.get(nodeId) ?? [];
      if (exits.length === 0) break;
      let chosen: Edge | null = null;
      if (runner) {
        const paths = reachable(adjacency, nodeId, 3);
        let bestDepth = Infinity;
        for (const survivor of living) {
          const path = paths.get(survivor.nodeId);
          if (path && path.depth < bestDepth) { bestDepth = path.depth; chosen = path.firstEdge; }
        }
        // Al alcanzar a un vivo no abandona su nodo en el segundo paso.
        if (bestDepth === 0) break;
      }
      if (chosen === null) {
        const cursor = { zombieId: zombie.id, turnId: input.turnId, drawIndex: drawIndex++ };
        chosen = exits[randomIndex(input.randomState, cursor, exits.length)];
      }
      traversals.push({ zombieId: zombie.id, fromNodeId: nodeId, toNodeId: chosen.destino,
        edgeId: chosen.id, stepIndex: stepIndex as 1 | 2 });
      nodeId = chosen.destino;
    }
    randomCursors.push({ zombieId: zombie.id, turnId: input.turnId, drawIndex });
    return { ...zombie, nodeId, siguienteMovimientoTurno: input.turnId + (runner ? 1 : 2) };
  });
  // Orden público interno reproducible aunque cambie el orden de entrada de zombies.
  traversals.sort((a, b) => compare(a.zombieId, b.zombieId) || a.stepIndex - b.stepIndex);
  randomCursors.sort((a, b) => compare(a.zombieId, b.zombieId));
  return { zombies, traversals, randomCursors };
}
