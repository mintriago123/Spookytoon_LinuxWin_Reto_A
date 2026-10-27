import type { MantaGraph, GraphEdge } from "../../contracts/types.ts";

// Índices compartidos por validación y motor; el consumidor no debe mutarlos.
export function buildAdjacency(graph: MantaGraph) {
  const nodeIndex = new Map(graph.nodos.map((node, index) => [node.id, index]));
  const edgeIndex = new Map(graph.aristas.map((edge, index) => [edge.id, index]));
  const outEdges: GraphEdge[][] = graph.nodos.map(() => []);
  const inEdges: GraphEdge[][] = graph.nodos.map(() => []);
  for (const edge of graph.aristas) {
    const from = nodeIndex.get(edge.origen);
    const to = nodeIndex.get(edge.destino);
    if (from === undefined || to === undefined) throw new Error(`Referencia inválida: ${edge.id}`);
    outEdges[from].push(edge);
    inEdges[to].push(edge);
  }
  return { nodeIndex, edgeIndex, outEdges, inEdges };
}
