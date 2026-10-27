import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { MantaGraph, RoadType } from "../../contracts/types.ts";
import { buildAdjacency } from "./adjacency.ts";

const ajv = new Ajv2020({ allErrors: true });
// CommonJS export de ajv-formats con resolución NodeNext.
const formats = addFormats as unknown as (instance: Ajv2020) => void;
formats(ajv);
const schema = JSON.parse(readFileSync(new URL("../../contracts/graph.schema.json", import.meta.url), "utf8"));
const checkSchema = ajv.compile<MantaGraph>(schema);
export const ROAD_FACTORS: Readonly<Record<RoadType, number>> = Object.freeze({
  avenida: 1, calle: 0.8, callejon: 0.55, puente: 0.9,
});

export function validateGraph(value: unknown): asserts value is MantaGraph {
  if (!checkSchema(value)) throw new Error(`Grafo inválido: ${ajv.errorsText(checkSchema.errors, { separator: "; " })}`);
  const errors: string[] = [];
  for (const [name, items] of [["nodo", value.nodos], ["arista", value.aristas], ["refugio", value.refugios]] as const) {
    const seen = new Set<string>();
    for (const item of items) {
      if (seen.has(item.id)) errors.push(`ID de ${name} duplicado: ${item.id}`);
      seen.add(item.id);
    }
  }
  const nodes = new Set(value.nodos.map(n => n.id));
  const shelters = new Set<string>();
  for (const shelter of value.refugios) {
    if (!nodes.has(shelter.nodoId)) errors.push(`Refugio sin nodo: ${shelter.id}`);
    if (shelters.has(shelter.nodoId)) errors.push(`Refugios en mismo nodo: ${shelter.nodoId}`);
    shelters.add(shelter.nodoId);
  }
  if (new Set(value.nodos.map(n => n.zona)).size !== 4) errors.push("Se requieren las cuatro zonas");
  const segments = new Map<string, { pair: string; type: RoadType; distance: number; directions: Set<string> }>();
  for (const edge of value.aristas) {
    if (!nodes.has(edge.origen) || !nodes.has(edge.destino)) errors.push(`Referencia inválida: ${edge.id}`);
    if (edge.origen === edge.destino) errors.push(`Auto-bucle: ${edge.id}`);
    if (edge.factor_velocidad !== ROAD_FACTORS[edge.tipo]) errors.push(`Factor incoherente: ${edge.id}`);
    const pair = JSON.stringify([edge.origen, edge.destino].sort());
    const direction = JSON.stringify([edge.origen, edge.destino]);
    const segment = segments.get(edge.segmentoId);
    if (segment) {
      if (segment.pair !== pair || segment.type !== edge.tipo || segment.distance !== edge.distancia_m || segment.directions.has(direction)) {
        errors.push(`Segmento incoherente: ${edge.segmentoId}`);
      }
      segment.directions.add(direction);
    } else segments.set(edge.segmentoId, { pair, type: edge.tipo, distance: edge.distancia_m, directions: new Set([direction]) });
  }
  if (errors.length) throw new Error(errors.join("; "));
  // Alcanzabilidad dirigida inversa: todo nodo debe poder llegar a algún refugio.
  const { nodeIndex, inEdges } = buildAdjacency(value);
  const reachable = new Set(shelters);
  const queue = [...reachable];
  for (let i = 0; i < queue.length; i++) {
    for (const edge of inEdges[nodeIndex.get(queue[i])!]) {
      if (!reachable.has(edge.origen)) { reachable.add(edge.origen); queue.push(edge.origen); }
    }
  }
  const unreachable = value.nodos.filter(n => !reachable.has(n.id));
  if (unreachable.length) throw new Error(`Nodos sin camino dirigido a refugio (${unreachable.length}): ${unreachable.slice(0, 10).map(n => n.id).join(", ")}`);
}
