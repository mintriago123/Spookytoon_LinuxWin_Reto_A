import type { MantaGraph, GraphNode } from "../contracts/types.ts";
import type { RoundConfig, RoundId } from "../modules/simulator/types.ts";
import { validateRoundConfig } from "../modules/simulator/round-validation.ts";

const ZONES = ["Tarqui", "Los Esteros", "Jocay", "Barbasquillo"] as const;
type ZoneName = (typeof ZONES)[number];

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function distanceSquared(a: GraphNode, b: GraphNode): number {
  const meanLatitude = ((a.lat + b.lat) / 2) * Math.PI / 180;
  const northSouth = (a.lat - b.lat) * 111_320;
  const eastWest = (a.lng - b.lng) * 111_320 * Math.cos(meanLatitude);
  return northSouth * northSouth + eastWest * eastWest;
}

/** Selección determinista por máxima distancia mínima para repartir entidades. */
function spread(nodes: GraphNode[], count: number, seeds: GraphNode[] = []): GraphNode[] {
  if (count > nodes.length) throw new Error(`No hay suficientes nodos para ubicar ${count} entidades`);
  const remaining = [...nodes].sort((a, b) => compare(a.id, b.id));
  const selected: GraphNode[] = [];
  while (selected.length < count) {
    const anchors = [...seeds, ...selected];
    let bestIndex = 0;
    let bestDistance = -1;
    for (let index = 0; index < remaining.length; index++) {
      const candidate = remaining[index];
      const minDistance = anchors.length
        ? Math.min(...anchors.map(anchor => distanceSquared(candidate, anchor)))
        : 0;
      if (minDistance > bestDistance) {
        bestIndex = index;
        bestDistance = minDistance;
      }
    }
    selected.push(remaining.splice(bestIndex, 1)[0]);
  }
  return selected;
}

function proportionalCounts(total: number, capacities: Map<ZoneName, number>): Map<ZoneName, number> {
  const sum = ZONES.reduce((value, zone) => value + (capacities.get(zone) ?? 0), 0);
  if (sum < total) throw new Error("El grafo no tiene suficientes nodos para los sobrevivientes");
  const counts = new Map<ZoneName, number>();
  const fractions: Array<{ zone: ZoneName; remainder: number }> = [];
  let assigned = 0;
  for (const zone of ZONES) {
    const exact = total * (capacities.get(zone) ?? 0) / sum;
    const base = Math.floor(exact);
    counts.set(zone, base);
    assigned += base;
    fractions.push({ zone, remainder: exact - base });
  }
  fractions.sort((a, b) => b.remainder - a.remainder || ZONES.indexOf(a.zone) - ZONES.indexOf(b.zone));
  for (let index = 0; assigned < total; index++, assigned++) {
    const zone = fractions[index % fractions.length].zone;
    counts.set(zone, (counts.get(zone) ?? 0) + 1);
  }
  return counts;
}

function survivorCounts(roundId: RoundId, capacities: Map<ZoneName, number>): Map<ZoneName, number> {
  const total = roundId === 1 ? 20 : roundId === 2 ? 80 : 200;
  if (roundId === 3) return proportionalCounts(total, capacities);
  const counts = new Map<ZoneName, number>(ZONES.map(zone => [zone, Math.floor(total / ZONES.length)]));
  for (let index = 0; index < total % ZONES.length; index++) {
    const zone = ZONES[index];
    counts.set(zone, counts.get(zone)! + 1);
  }
  return counts;
}

function roadEvents(graph: MantaGraph, roadType: "puente" | "calle", count: number, roundId: RoundId) {
  const bySegment = new Map<string, MantaGraph["aristas"][number]>();
  for (const edge of graph.aristas) {
    if (edge.tipo === roadType && !bySegment.has(edge.segmentoId)) bySegment.set(edge.segmentoId, edge);
  }
  const edges = [...bySegment.values()].sort((a, b) => compare(a.segmentoId, b.segmentoId));
  if (edges.length < count) throw new Error(`El grafo no contiene ${count} segmentos de tipo ${roadType}`);
  return edges.slice(0, count).map((edge, index) => ({
    eventId: `R${roundId}-EVENT-${String(index + 1).padStart(2, "0")}`,
    edgeId: edge.id,
    effectiveTurnId: roundId === 2 ? 75 : index === 0 ? 60 : 105,
    reason: roadType === "puente" ? "colapso-puente" as const : "bloqueo-calle" as const,
  }));
}

function buildRound(graph: MantaGraph, roundId: RoundId): RoundConfig {
  const shelterNodeIds = new Set(graph.refugios.map(shelter => shelter.nodoId));
  const neighbors = new Map<string, Set<string>>(graph.nodos.map(node => [node.id, new Set()]));
  for (const edge of graph.aristas) {
    neighbors.get(edge.origen)?.add(edge.destino);
    neighbors.get(edge.destino)?.add(edge.origen);
  }
  // Primero se reservan ubicaciones zombie; los spawns vivos excluyen toda zona letal de horda.
  const compositions: Record<RoundId, Array<["caminante" | "corredor" | "horda" | "dormido", number]>> = {
    1: [["caminante", 8]],
    2: [["horda", 2], ["caminante", 12], ["corredor", 4]],
    3: [["horda", 2], ["caminante", 16], ["corredor", 6], ["dormido", 4]],
  };
  const occupied = new Set(shelterNodeIds);
  const hordeDanger = new Set<string>();
  const shelterNodes = graph.nodos.filter(node => shelterNodeIds.has(node.id));
  const zombieSpawns: RoundConfig["zombieSpawns"] = [];
  for (const [type, count] of compositions[roundId]) {
    const candidates = graph.nodos.filter(node => !occupied.has(node.id));
    const selected = spread(candidates, count, shelterNodes);
    for (const node of selected) {
      zombieSpawns.push({ id: `R${roundId}-Z-${String(zombieSpawns.length + 1).padStart(3, "0")}`,
        tipo: type, nodeId: node.id });
      occupied.add(node.id);
      if (type === "horda") {
        hordeDanger.add(node.id);
        for (const neighbor of neighbors.get(node.id) ?? []) hordeDanger.add(neighbor);
      }
    }
  }

  const nodesByZone = new Map<ZoneName, GraphNode[]>(ZONES.map(zone => [zone,
    graph.nodos.filter(node => node.zona === zone && !occupied.has(node.id) && !hordeDanger.has(node.id))]));
  const capacities = new Map<ZoneName, number>(ZONES.map(zone => [zone, nodesByZone.get(zone)!.length]));
  const allocations = survivorCounts(roundId, capacities);
  const survivorNodes = ZONES.flatMap(zone => spread(nodesByZone.get(zone)!, allocations.get(zone) ?? 0));
  const survivorSpawns = survivorNodes.map((node, index) => ({
    id: `R${roundId}-S-${String(index + 1).padStart(3, "0")}`, nodeId: node.id,
  }));

  const eventPlan = roundId === 1 ? [] : roadEvents(graph, roundId === 2 ? "puente" : "calle",
    roundId - 1, roundId);
  const config: RoundConfig = { roundId, durationMs: 300_000, turnIntervalMs: 2_000,
    turnCount: 150, survivorCount: roundId === 1 ? 20 : roundId === 2 ? 80 : 200,
    survivorSpawns, zombieSpawns, eventPlan };
  validateRoundConfig(config, graph);
  return config;
}

/** Presets reproducibles usando solo nodos, refugios y aristas del grafo cargado. */
export function createRoundPresets(graph: MantaGraph): Record<RoundId, RoundConfig> {
  return { 1: buildRound(graph, 1), 2: buildRound(graph, 2), 3: buildRound(graph, 3) };
}
