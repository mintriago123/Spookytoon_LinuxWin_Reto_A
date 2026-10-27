import { loadGraph } from "../backend/src/modules/graph/load-graph.ts";
import { buildAdjacency } from "../backend/src/modules/graph/adjacency.ts";
import { isMain, fail } from "./graph-config.ts";

function connectivity(graph: Awaited<ReturnType<typeof loadGraph>>["graph"]) {
  const { nodeIndex, outEdges, inEdges } = buildAdjacency(graph);
  const weakNeighbors = graph.nodos.map(() => new Set<number>());
  for (const edge of graph.aristas) {
    const from = nodeIndex.get(edge.origen)!;
    const to = nodeIndex.get(edge.destino)!;
    weakNeighbors[from].add(to);
    weakNeighbors[to].add(from);
  }
  const visited = new Set<number>();
  let weakComponents = 0;
  for (let start = 0; start < graph.nodos.length; start++) {
    if (visited.has(start)) continue;
    weakComponents++;
    const queue = [start]; visited.add(start);
    for (let i = 0; i < queue.length; i++) for (const next of weakNeighbors[queue[i]]) {
      if (!visited.has(next)) { visited.add(next); queue.push(next); }
    }
  }
  const finishOrder: number[] = []; const seenOut = new Set<number>();
  for (let start = 0; start < graph.nodos.length; start++) {
    if (seenOut.has(start)) continue;
    const stack: [number, boolean][] = [[start, false]];
    while (stack.length) {
      const [current, expanded] = stack.pop()!;
      if (expanded) { finishOrder.push(current); continue; }
      if (seenOut.has(current)) continue;
      seenOut.add(current); stack.push([current, true]);
      for (const edge of outEdges[current]) {
        const next = nodeIndex.get(edge.destino)!;
        if (!seenOut.has(next)) stack.push([next, false]);
      }
    }
  }
  const seenIn = new Set<number>(); let stronglyConnectedComponents = 0;
  for (let i = finishOrder.length - 1; i >= 0; i--) {
    const start = finishOrder[i];
    if (seenIn.has(start)) continue;
    stronglyConnectedComponents++;
    const queue = [start]; seenIn.add(start);
    for (let j = 0; j < queue.length; j++) for (const edge of inEdges[queue[j]]) {
      const previous = nodeIndex.get(edge.origen)!;
      if (!seenIn.has(previous)) { seenIn.add(previous); queue.push(previous); }
    }
  }
  const shelterReachability = Object.fromEntries(graph.refugios.map(shelter => {
    const start = nodeIndex.get(shelter.nodoId)!;
    const reachable = new Set<number>([start]);
    const queue = [start];
    for (let i = 0; i < queue.length; i++) for (const edge of outEdges[queue[i]]) {
      const next = nodeIndex.get(edge.destino)!;
      if (!reachable.has(next)) { reachable.add(next); queue.push(next); }
    }
    return [shelter.id, graph.refugios.filter(target => reachable.has(nodeIndex.get(target.nodoId)!)).map(target => target.id)];
  }));
  const shelterInbound = Object.fromEntries(graph.refugios.map(shelter => {
    const start = nodeIndex.get(shelter.nodoId)!;
    const reachable = new Set<number>([start]);
    const queue = [start];
    for (let i = 0; i < queue.length; i++) for (const edge of inEdges[queue[i]]) {
      const previous = nodeIndex.get(edge.origen)!;
      if (!reachable.has(previous)) { reachable.add(previous); queue.push(previous); }
    }
    return [shelter.id, {
      nodeCount: reachable.size,
      fromShelters: graph.refugios.filter(source => reachable.has(nodeIndex.get(source.nodoId)!)).map(source => source.id),
    }];
  }));
  const fullyDirectedShelterConnectivity = graph.refugios.every(shelter =>
    graph.refugios.every(target => shelterReachability[shelter.id].includes(target.id)));
  const everyNodeCanReachAllShelters = graph.refugios.every(shelter => shelterInbound[shelter.id].nodeCount === graph.nodos.length);
  return { weakComponents, stronglyConnectedComponents, shelterReachability, shelterInbound,
    fullyDirectedShelterConnectivity, everyNodeCanReachAllShelters };
}

if (isMain(import.meta.url)) {
  const path = process.argv[2];
  if (!path) fail(new Error("Uso: npm run graph:validate -- grafo.json"));
  else loadGraph(path).then(({ graph, sha256 }) => {
    const summary = connectivity(graph);
    console.log(JSON.stringify({
      graphVersion: graph.metadata.graphVersion, sha256,
      nodos: graph.nodos.length, aristas: graph.aristas.length, refugios: graph.refugios.length,
      capacidadTotal: graph.refugios.reduce((sum, shelter) => sum + shelter.capacidad, 0),
      weakComponents: summary.weakComponents,
      stronglyConnectedComponents: summary.stronglyConnectedComponents,
      stronglyConnected: summary.stronglyConnectedComponents === 1,
      everyNodeCanReachAllShelters: summary.everyNodeCanReachAllShelters,
      shelterReachability: summary.shelterReachability,
      shelterInbound: summary.shelterInbound,
      fullyDirectedShelterConnectivity: summary.fullyDirectedShelterConnectivity,
    }, null, 2));
  }).catch(fail);
}
