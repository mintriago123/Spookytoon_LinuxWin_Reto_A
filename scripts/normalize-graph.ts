import { createHash } from "node:crypto";
import type { GraphEdge, MantaGraph, RoadType } from "../backend/src/contracts/types.ts";
import { ROAD_FACTORS, validateGraph } from "../backend/src/modules/graph/validate-graph.ts";
import { HIGHWAYS } from "./extract-manta-osm.ts";
import { isMain, fail, readJson, writeJson, parseConfig, validateReview } from "./graph-config.ts";
import type { GraphConfig } from "./graph-config.ts";

interface OsmNode { type: "node"; id: number; lat: number; lon: number }
interface OsmWay { type: "way"; id: number; nodes: number[]; tags: Record<string, string> }
export interface OsmData { osm3s: { timestamp_osm_base: string }; elements: (OsmNode | OsmWay)[]; remark?: string }

function inside(lng: number, lat: number, polygon: [number, number][]) {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [x, y] = polygon[i]; const [a, b] = polygon[j];
    // Borde pertenece al polígono; bordes compartidos requieren revisión explícita.
    if (Math.abs((lat - y) * (a - x) - (lng - x) * (b - y)) < 1e-12 &&
      lng >= Math.min(x, a) && lng <= Math.max(x, a) && lat >= Math.min(y, b) && lat <= Math.max(y, b)) return true;
    if ((y > lat) !== (b > lat) && lng < (a - x) * (lat - y) / (b - y) + x) hit = !hit;
  }
  return hit;
}
function distance(a: OsmNode, b: OsmNode) {
  const rad = Math.PI / 180;
  const h = Math.sin((b.lat - a.lat) * rad / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lon - a.lon) * rad / 2) ** 2;
  return Math.round(6_371_000 * 2 * Math.asin(Math.sqrt(Math.min(1, h))) * 1000) / 1000;
}
function roadType(tags: Record<string, string>): RoadType {
  if (tags.bridge && !["no", "false", "0"].includes(tags.bridge)) return "puente";
  if (tags.service === "alley") return "callejon";
  if (/^(motorway|trunk|primary|secondary|tertiary)(_link)?$/.test(tags.highway)) return "avenida";
  return "calle";
}
function direction(tags: Record<string, string>, wayId: number): "both" | "forward" | "reverse" {
  if (["no", "false", "0"].includes(tags.oneway)) return "both";
  if (["yes", "true", "1"].includes(tags.oneway)) return "forward";
  if (tags.oneway === "-1") return "reverse";
  if (tags.oneway !== undefined) throw new Error(`oneway requiere revisión: way ${wayId} (${tags.oneway})`);
  return tags.junction === "roundabout" || tags.highway === "motorway" ? "forward" : "both";
}
export function normalize(osm: OsmData, config: GraphConfig): MantaGraph {
  parseConfig(config); validateReview(config);
  const timestamp = osm.osm3s?.timestamp_osm_base;
  if (osm.remark || !Array.isArray(osm.elements) || !timestamp || !Number.isFinite(Date.parse(timestamp))) throw new Error("Respuesta OSM incompleta o sin fecha válida");
  const nodes = new Map<number, OsmNode>();
  const ways: OsmWay[] = [];
  for (const element of osm.elements) {
    if (!Number.isSafeInteger(element.id) || element.id <= 0) throw new Error("ID OSM inválido");
    if (element.type === "node") {
      if (!Number.isFinite(element.lat) || !Number.isFinite(element.lon) || Math.abs(element.lat) > 90 || Math.abs(element.lon) > 180 || nodes.has(element.id)) throw new Error(`Nodo OSM inválido/duplicado: ${element.id}`);
      nodes.set(element.id, element);
    } else if (element.type === "way") ways.push(element);
  }
  const selected = config.selectedNodeIds ? new Set(config.selectedNodeIds) : undefined;
  const [south, west, north, east] = config.bbox;
  const assignments = new Map<number, MantaGraph["nodos"][number]>();
  const assign = (node: OsmNode) => {
    if (assignments.has(node.id)) return;
    if (node.lat < south || node.lat > north || node.lon < west || node.lon > east || (selected && !selected.has(`osm-node-${node.id}`))) return;
    const zones = config.zones.filter(z => inside(node.lon, node.lat, z.polygon));
    if (zones.length === 0) return;
    if (zones.length > 1) throw new Error(`Zonas ambiguas: osm-node-${node.id}`);
    assignments.set(node.id, { id: `osm-node-${node.id}`, lat: node.lat, lng: node.lon, zona: zones[0].name });
  };
  const edges: GraphEdge[] = [];
  const wayIds = new Set<number>();
  for (const way of ways.sort((a, b) => a.id - b.id)) {
    if (wayIds.has(way.id)) throw new Error(`Way OSM duplicado: ${way.id}`);
    wayIds.add(way.id);
    const tags = way.tags ?? {};
    if (!HIGHWAYS.includes(tags.highway) || tags.area === "yes" || ["no", "private"].includes(tags.access)) continue;
    if (!Array.isArray(way.nodes) || way.nodes.length < 2) throw new Error(`Way inválido: ${way.id}`);
    // Las restricciones condicionales/reversibles deben resolverse en la revisión.
    if (Object.keys(tags).some(key => key.includes(":conditional") || key === "oneway:vehicle")) throw new Error(`Restricción OSM requiere revisión: way ${way.id}`);
    const dir = direction(tags, way.id); const tipo = roadType(tags);
    const pairs = new Map<string, number>();
    for (let i = 1; i < way.nodes.length; i++) {
      const a = nodes.get(way.nodes[i - 1]); const b = nodes.get(way.nodes[i]);
      if (!a || !b) throw new Error(`Way ${way.id} referencia nodo ausente`);
      assign(a); assign(b);
      if (!assignments.has(a.id) || !assignments.has(b.id) || a.id === b.id) continue;
      const pair = [a.id, b.id].sort((x, y) => x - y).join("-");
      const occurrence = (pairs.get(pair) ?? 0) + 1; pairs.set(pair, occurrence);
      const segmentoId = `osm-way-${way.id}-${pair}-${occurrence}`;
      const distancia_m = distance(a, b);
      if (distancia_m <= 0) throw new Error(`Segmento de longitud cero: ${segmentoId}`);
      const add = (from: number, to: number) => edges.push({
        id: `${segmentoId}-${from}-${to}`, segmentoId, origen: `osm-node-${from}`, destino: `osm-node-${to}`,
        distancia_m, tipo, factor_velocidad: ROAD_FACTORS[tipo],
      });
      if (dir !== "reverse") add(a.id, b.id);
      if (dir !== "forward") add(b.id, a.id);
    }
  }
  if (selected) for (const id of selected) {
    if (![...assignments.values()].some(n => n.id === id)) throw new Error(`Nodo seleccionado fuera de la extracción/zonas: ${id}`);
  }
  const nodos = [...assignments.values()].sort((a, b) => a.id.localeCompare(b.id, "en"));
  const aristas = edges.sort((a, b) => a.id.localeCompare(b.id, "en"));
  const refugios = [...config.refugios].sort((a, b) => a.id.localeCompare(b.id, "en"));
  const contentHash = createHash("sha256").update(JSON.stringify({ nodos, aristas, refugios })).digest("hex").slice(0, 16);
  const graph: MantaGraph = {
    schemaVersion: "1.0.0",
    metadata: { ciudad: "Manta", graphVersion: `manta-osm-${timestamp.slice(0, 10)}-${contentHash}`, generatedAt: timestamp,
      source: "OpenStreetMap", osmAttribution: "© OpenStreetMap contributors — ODbL 1.0 — https://www.openstreetmap.org/copyright" },
    nodos, aristas, refugios,
  };
  validateGraph(graph);
  return graph;
}
if (isMain(import.meta.url)) {
  const [, , input, config, output] = process.argv;
  if (!input || !config || !output) fail(new Error("Uso: npm run graph:normalize -- osm.json config.json scripts/data/grafo_manta.json"));
  else (async () => {
    const graph = normalize(await readJson(input) as OsmData, parseConfig(await readJson(config)));
    await writeJson(output, graph);
    console.log(`${graph.metadata.graphVersion}: ${graph.nodos.length} nodos, ${graph.aristas.length} aristas`);
  })().catch(fail);
}
