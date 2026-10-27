import { createHash } from "node:crypto";
import type { GraphEdge, MantaGraph, RoadType } from "../backend/src/contracts/types.ts";
import { ROAD_FACTORS, validateGraph } from "../backend/src/modules/graph/validate-graph.ts";
import { distanceMeters, directionForWay, isMain, fail, readJson, writeJson, parseConfig, pointInPolygon, resolveShelterLinks, validateReview, isSupportedHighway } from "./graph-config.ts";
import type { GraphConfig } from "./graph-config.ts";

interface OsmNode { type: "node"; id: number; lat: number; lon: number }
interface OsmWay { type: "way"; id: number; nodes: number[]; tags: Record<string, string> }
export interface OsmData {
  osm3s: { timestamp_osm_base: string };
  elements: (OsmNode | OsmWay)[];
  selectedNodeIds?: string[];
  selection?: { targetNodes: number; coreNodes: number; selectedIntersections: number; method: string };
  remark?: string;
}

function distance(a: OsmNode, b: OsmNode) {
  const rad = Math.PI / 180;
  const h = Math.sin((b.lat - a.lat) * rad / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lon - a.lon) * rad / 2) ** 2;
  return Math.round(6_371_000 * 2 * Math.asin(Math.sqrt(Math.min(1, h))) * 1000) / 1000;
}
function zoneForNode(lng: number, lat: number, config: GraphConfig) {
  const matches = config.zones.filter(zone => pointInPolygon(lng, lat, zone.polygon));
  if (matches.length < 2) return matches[0]?.name;
  const anchors = new Map(config.refugios.filter(shelter => shelter.zona && shelter.acceso)
    .map(shelter => [shelter.zona!, shelter.acceso!]));
  if (matches.some(zone => !anchors.has(zone.name))) {
    throw new Error(`Zonas ambiguas en el límite para nodo (${lat}, ${lng})`);
  }
  return matches.sort((a, b) => distanceMeters(anchors.get(a.name)!, { lat, lng }) -
    distanceMeters(anchors.get(b.name)!, { lat, lng }) || a.name.localeCompare(b.name, "en"))[0].name;
}
function roadType(tags: Record<string, string>): RoadType {
  if (tags.bridge && !["no", "false", "0"].includes(tags.bridge)) return "puente";
  if (tags.service === "alley") return "callejon";
  if (/^(motorway|trunk|primary|secondary|tertiary)(_link)?$/.test(tags.highway)) return "avenida";
  return "calle";
}
export function normalize(osm: OsmData, config: GraphConfig): MantaGraph {
  parseConfig(config); validateReview(config);
  const resolvedShelters = resolveShelterLinks(osm, config);
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
  const selectedIds = config.selectedNodeIds ?? osm.selectedNodeIds;
  const selected = selectedIds ? new Set(selectedIds) : undefined;
  const [south, west, north, east] = config.bbox;
  const inScope = (node: OsmNode) => node.lat >= south && node.lat <= north && node.lon >= west && node.lon <= east &&
    config.zones.some(zone => pointInPolygon(node.lon, node.lat, zone.polygon));
  const assignments = new Map<number, MantaGraph["nodos"][number]>();
  const assign = (node: OsmNode) => {
    if (assignments.has(node.id)) return;
    if (node.lat < south || node.lat > north || node.lon < west || node.lon > east || (selected && !selected.has(`osm-node-${node.id}`))) return;
    const zona = zoneForNode(node.lon, node.lat, config);
    if (!zona) return;
    assignments.set(node.id, { id: `osm-node-${node.id}`, lat: node.lat, lng: node.lon, zona });
  };
  const edges: GraphEdge[] = [];
  const wayIds = new Set<number>();
  for (const way of ways.sort((a, b) => a.id - b.id)) {
    if (wayIds.has(way.id)) throw new Error(`Way OSM duplicado: ${way.id}`);
    wayIds.add(way.id);
    const tags = way.tags ?? {};
    if (!isSupportedHighway(tags.highway) || tags.area === "yes" || ["no", "private"].includes(tags.access)) continue;
    if (!Array.isArray(way.nodes) || way.nodes.length < 2) throw new Error(`Way inválido: ${way.id}`);
    // Las restricciones condicionales/reversibles deben resolverse en la revisión.
    if (Object.keys(tags).some(key =>
      (key.includes(":conditional") && !(config.directionMode === "pedestrian" && key.startsWith("oneway:"))) ||
      (key === "oneway:vehicle" && config.directionMode !== "pedestrian"))) throw new Error(`Restricción OSM requiere revisión: way ${way.id}`);
    const dir = directionForWay(tags, way.id, config.directionMode ?? "vehicle"); const tipo = roadType(tags);
    const pairs = new Map<string, number>();
    if (selected && config.compactIntersections) {
      let previous: { node: OsmNode; index: number } | null = null;
      for (let i = 0; i < way.nodes.length; i++) {
        const node = nodes.get(way.nodes[i]);
        if (!node) throw new Error(`Way ${way.id} referencia nodo ausente`);
        if (!selected.has(`osm-node-${node.id}`)) continue;
        assign(node);
        if (!assignments.has(node.id)) { previous = { node, index: i }; continue; }
        if (previous !== null && previous.node.id !== node.id) {
          const path = way.nodes.slice(previous.index, i + 1).map(id => nodes.get(id));
          if (path.length > 1 && path.every((point): point is OsmNode => !!point && inScope(point))) {
            const pair = [previous.node.id, node.id].sort((a, b) => a - b).join("-");
            const occurrence = (pairs.get(pair) ?? 0) + 1; pairs.set(pair, occurrence);
            const segmentoId = `osm-way-${way.id}-${pair}-${occurrence}`;
            const distancia_m = Math.round(path.slice(1).reduce((sum, point, index) => sum + distance(path[index], point), 0) * 1000) / 1000;
            if (distancia_m <= 0) throw new Error(`Segmento de longitud cero: ${segmentoId}`);
            const add = (from: number, to: number) => edges.push({
              id: `${segmentoId}-${from}-${to}`, segmentoId, origen: `osm-node-${from}`, destino: `osm-node-${to}`,
              distancia_m, tipo, factor_velocidad: ROAD_FACTORS[tipo],
            });
            if (dir !== "reverse") add(previous.node.id, node.id);
            if (dir !== "forward") add(node.id, previous.node.id);
          }
        }
        previous = { node, index: i };
      }
      continue;
    }
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
  const refugios: MantaGraph["refugios"] = resolvedShelters.map(({ id, nodoId, capacidad }) => ({ id, nodoId, capacidad }))
    .sort((a, b) => a.id.localeCompare(b.id, "en"));
  const nodeIds = new Set(nodos.map(node => node.id));
  for (const shelter of refugios) if (!nodeIds.has(shelter.nodoId)) {
    throw new Error(`El nodo vial resuelto de ${shelter.id} quedó fuera del grafo: ${shelter.nodoId}`);
  }
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
    for (const shelter of graph.refugios) console.log(`${shelter.id} -> ${shelter.nodoId}`);
  })().catch(fail);
}
