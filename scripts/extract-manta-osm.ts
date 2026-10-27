import { createHash } from "node:crypto";
import { directionForWay, distanceMeters, isMain, fail, readJson, writeJson, parseConfig, pointInPolygon, resolveShelterLinks, validateReview, HIGHWAYS, isSupportedHighway } from "./graph-config.ts";

export { HIGHWAYS };
export function buildQuery(bbox: [number, number, number, number]) {
  return `[out:json][timeout:90];way["highway"~"^(${HIGHWAYS.join("|")})$"]["area"!="yes"]["access"!~"^(no|private)$"](${bbox.join(",")});out body;>;out skel qt;`;
}

interface OSMNode { type: "node"; id: number; lat: number; lon: number; timestamp?: string }
interface OSMWay { type: "way"; id: number; nodes: number[]; tags: Record<string, string>; timestamp?: string }
interface OSMExtract {
  osm3s: { timestamp_osm_base: string };
  timestampSource?: "overpass-base" | "latest-returned-element";
  elements: (OSMNode | OSMWay)[];
  selectedNodeIds?: string[];
  selection?: { targetNodes: number; coreNodes: number; selectedIntersections: number; method: string };
  remark?: string;
}

export function selectConnectedRoadNodes(osm: OSMExtract, config: ReturnType<typeof parseConfig>, shelters: ReturnType<typeof resolveShelterLinks>) {
  const target = config.targetGraphNodes;
  if (target === undefined) return undefined;
  const nodeById = new Map(osm.elements.filter((element): element is OSMNode => element.type === "node").map(node => [node.id, node]));
  const outgoing = new Map<number, Set<number>>(); const incoming = new Map<number, Set<number>>();
  const wayUses = new Map<number, Set<number>>(); const undirected = new Map<number, Set<number>>();
  const inScope = (id: number) => {
    const node = nodeById.get(id);
    return !!node && node.lat >= config.bbox[0] && node.lat <= config.bbox[2] && node.lon >= config.bbox[1] && node.lon <= config.bbox[3] &&
      config.zones.some(zone => pointInPolygon(node.lon, node.lat, zone.polygon));
  };
  const addArc = (from: number, to: number) => {
    if (!outgoing.has(from)) outgoing.set(from, new Set());
    if (!incoming.has(to)) incoming.set(to, new Set());
    outgoing.get(from)!.add(to); incoming.get(to)!.add(from);
    if (!undirected.has(from)) undirected.set(from, new Set());
    if (!undirected.has(to)) undirected.set(to, new Set());
    undirected.get(from)!.add(to); undirected.get(to)!.add(from);
  };
  const ways = osm.elements.filter((element): element is OSMWay => element.type === "way" &&
    isSupportedHighway(element.tags?.highway) && element.tags.area !== "yes" && !["no", "private"].includes(element.tags.access ?? ""))
    .sort((a, b) => a.id - b.id);
  for (const way of ways) {
    const direction = directionForWay(way.tags, way.id, config.directionMode ?? "vehicle");
    for (const nodeId of new Set(way.nodes.filter(inScope))) {
      if (!wayUses.has(nodeId)) wayUses.set(nodeId, new Set());
      wayUses.get(nodeId)!.add(way.id);
    }
    for (let i = 1; i < way.nodes.length; i++) {
      const from = way.nodes[i - 1]; const to = way.nodes[i];
      if (!inScope(from) || !inScope(to) || from === to) continue;
      if (direction !== "reverse") addArc(from, to);
      if (direction !== "forward") addArc(to, from);
    }
  }
  const isIntersection = (id: number) => (wayUses.get(id)?.size ?? 0) > 1 || (undirected.get(id)?.size ?? 0) >= 3;
  const shelterNodeIds = new Set(shelters.map(shelter => Number(shelter.nodoId.slice("osm-node-".length))));
  const isAnchor = (id: number) => isIntersection(id) || shelterNodeIds.has(id);
  let routeOutgoing = outgoing; let routeIncoming = incoming;
  if (config.compactIntersections) {
    routeOutgoing = new Map(); routeIncoming = new Map();
    const addRouteArc = (from: number, to: number) => {
      if (!routeOutgoing.has(from)) routeOutgoing.set(from, new Set());
      if (!routeIncoming.has(to)) routeIncoming.set(to, new Set());
      routeOutgoing.get(from)!.add(to); routeIncoming.get(to)!.add(from);
    };
    for (const way of ways) {
      const direction = directionForWay(way.tags, way.id, config.directionMode ?? "vehicle");
      let previousAnchor: { id: number; index: number } | null = null;
      for (let index = 0; index < way.nodes.length; index++) {
        const current = way.nodes[index];
        if (!isAnchor(current) || !inScope(current)) continue;
        if (previousAnchor !== null) {
          const pathNodes = way.nodes.slice(previousAnchor.index, index + 1);
          if (pathNodes.length > 1 && pathNodes.every(inScope)) {
            if (direction !== "reverse") addRouteArc(previousAnchor.id, current);
            if (direction !== "forward") addRouteArc(current, previousAnchor.id);
          }
        }
        previousAnchor = { id: current, index };
      }
    }
  }
  const pathBetween = (start: number, end: number) => {
    if (start === end) return [start];
    const queue = [start]; const previous = new Map<number, number | null>([[start, null]]);
    for (let index = 0; index < queue.length; index++) {
      const current = queue[index];
      if (current === end) break;
      for (const next of [...(routeOutgoing.get(current) ?? [])].sort((a, b) => a - b)) {
        if (!previous.has(next)) { previous.set(next, current); queue.push(next); }
      }
    }
    if (!previous.has(end)) return null;
    const path: number[] = [];
    for (let current: number | null = end; current !== null; current = previous.get(current) ?? null) path.push(current);
    return path.reverse();
  };
  const nodeId = (id: string) => Number(id.slice("osm-node-".length));
  const shelterNodes = shelters.map(shelter => nodeId(shelter.nodoId));
  const selected = new Set<number>();
  // Conservar cada camino dirigido alcanzable entre refugios, no solo un árbol
  // mínimo: cada refugio alcanzable debe seguir siendo destino tras el recorte.
  for (let from = 0; from < shelterNodes.length; from++) for (let to = 0; to < shelterNodes.length; to++) {
    if (from === to) continue;
    const path = pathBetween(shelterNodes[from], shelterNodes[to]);
    for (const id of path ?? []) selected.add(id);
  }
  // Preserve compact, local approach catchments (such as a refuge at the end of
  // a one-way road) instead of spending the remaining budget on distant nodes.
  const smallCatchmentLimit = Math.floor(target / 4);
  for (const shelterNode of shelterNodes) {
    const catchment = new Set<number>([shelterNode]); const queue = [shelterNode];
    for (let index = 0; index < queue.length; index++) for (const from of routeIncoming.get(queue[index]) ?? []) {
      if (!catchment.has(from)) { catchment.add(from); queue.push(from); }
    }
    if (catchment.size <= smallCatchmentLimit) for (const id of catchment) selected.add(id);
  }
  if (selected.size === 0) throw new Error("Los refugios no tienen caminos OSM conectados en este bbox");
  if (selected.size > target) throw new Error(`Las rutas reales que conectan los refugios requieren ${selected.size} nodos; el objetivo configurado es ${target}`);
  const coreNodes = selected.size;

  const anchorPoints = shelters.flatMap(shelter => shelter.access ? [shelter.access] : []);
  while (selected.size < target) {
    const frontier = new Map<number, number>();
    for (const to of selected) for (const from of routeIncoming.get(to) ?? []) if (!selected.has(from)) frontier.set(from, to);
    if (!frontier.size) throw new Error(`La red conectada solo permite ${selected.size} nodos; no alcanza el objetivo ${target}`);
    const next = [...frontier.keys()].sort((a, b) => {
      const intersectionOrder = Number(isIntersection(b)) - Number(isIntersection(a));
      if (intersectionOrder) return intersectionOrder;
      const na = nodeById.get(a)!; const nb = nodeById.get(b)!;
      const da = Math.min(...anchorPoints.map(anchor => distanceMeters(anchor, { lat: na.lat, lng: na.lon })));
      const db = Math.min(...anchorPoints.map(anchor => distanceMeters(anchor, { lat: nb.lat, lng: nb.lon })));
      return da - db || a - b;
    })[0];
    selected.add(next);
  }
  return {
    selectedNodeIds: [...selected].map(id => `osm-node-${id}`).sort((a, b) => a.localeCompare(b, "en")),
    summary: {
      targetNodes: target, coreNodes,
      selectedIntersections: [...selected].filter(isIntersection).length,
      method: "all reachable directed shelter paths, small refuge catchments, then incoming connected growth prioritized by intersections",
    },
  };
}

function decodeXml(value: string) {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_whole, entity: string) => {
    if (entity.startsWith("#x")) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as Record<string, string>)[entity.toLowerCase()];
  });
}

function xmlAttributes(value: string) {
  return Object.fromEntries([...value.matchAll(/([\w:.-]+)="([^"]*)"/g)].map(match => [match[1], decodeXml(match[2])]));
}

function parseOsmMapXml(xml: string): OSMExtract {
  const nodes = new Map<number, OSMNode>();
  const ways: OSMWay[] = [];
  const timestamps: string[] = [];
  for (const match of xml.matchAll(/<node\b([^>]*)>/g)) {
    const attributes = xmlAttributes(match[1]);
    const id = Number(attributes.id); const lat = Number(attributes.lat); const lon = Number(attributes.lon);
    if (!Number.isSafeInteger(id) || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const timestamp = attributes.timestamp;
    nodes.set(id, { type: "node", id, lat, lon, ...(timestamp ? { timestamp } : {}) });
    if (timestamp) timestamps.push(timestamp);
  }
  for (const match of xml.matchAll(/<way\b([^>]*)>([\s\S]*?)<\/way>/g)) {
    const attributes = xmlAttributes(match[1]);
    const id = Number(attributes.id);
    if (!Number.isSafeInteger(id)) continue;
    const body = match[2];
    const tags = Object.fromEntries([...body.matchAll(/<tag\b([^>]*)\/>/g)].map(tag => {
      const pair = xmlAttributes(tag[1]); return [pair.k, pair.v];
    }).filter(([key, value]) => key !== undefined && value !== undefined));
    if (!HIGHWAYS.includes(tags.highway as typeof HIGHWAYS[number]) || tags.area === "yes" || ["no", "private"].includes(tags.access)) continue;
    const refs = [...body.matchAll(/<nd\b([^>]*)\/>/g)].map(nd => Number(xmlAttributes(nd[1]).ref));
    if (refs.length < 2 || refs.some(ref => !Number.isSafeInteger(ref))) continue;
    const timestamp = attributes.timestamp;
    ways.push({ type: "way", id, nodes: refs, tags, ...(timestamp ? { timestamp } : {}) });
    if (timestamp) timestamps.push(timestamp);
  }
  const neededNodes = new Set(ways.flatMap(way => way.nodes));
  const relevantNodes = [...nodes.values()].filter(node => neededNodes.has(node.id));
  for (const way of ways) for (const nodeId of way.nodes) if (!nodes.has(nodeId)) {
    throw new Error(`OSM API no devolvió el nodo ${nodeId} referenciado por way ${way.id}`);
  }
  const timestamp = timestamps.sort().at(-1) ?? new Date().toISOString();
  return {
    osm3s: { timestamp_osm_base: timestamp },
    timestampSource: "latest-returned-element",
    elements: [...relevantNodes.sort((a, b) => a.id - b.id), ...ways.sort((a, b) => a.id - b.id)],
  };
}

function splitBbox(bbox: [number, number, number, number]) {
  const [south, west, north, east] = bbox;
  const midLat = (south + north) / 2; const midLng = (west + east) / 2;
  return [
    [south, west, midLat, midLng], [south, midLng, midLat, east],
    [midLat, west, north, midLng], [midLat, midLng, north, east],
  ] as [number, number, number, number][];
}

async function fetchOsmMap(endpoint: string, bbox: [number, number, number, number]) {
  const pending = splitBbox(bbox);
  const tiles: [number, number, number, number][] = [];
  const responses: string[] = [];
  while (pending.length) {
    const tile = pending.shift()!;
    const [south, west, north, east] = tile;
    const url = new URL(endpoint);
    url.searchParams.set("bbox", `${west},${south},${east},${north}`);
    const response = await fetch(url, {
      signal: AbortSignal.timeout(120_000), headers: { "User-Agent": "Spookytoon-Manta-Graph/1.0" },
    });
    const body = await response.text();
    if (!response.ok) {
      if (response.status === 400 && /too many nodes/i.test(body) && tiles.length + pending.length < 256) {
        pending.unshift(...splitBbox(tile));
        continue;
      }
      throw new Error(`OSM map HTTP ${response.status}: ${body.slice(0, 300)}`);
    }
    tiles.push(tile); responses.push(body);
    if (pending.length) await new Promise(resolve => setTimeout(resolve, 500));
  }
  const nodeById = new Map<number, OSMNode>(); const wayById = new Map<number, OSMWay>();
  for (const xml of responses) {
    const parsed = parseOsmMapXml(xml);
    for (const element of parsed.elements) {
      if (element.type === "node") nodeById.set(element.id, element);
      else wayById.set(element.id, element);
    }
  }
  const timestamps = [...nodeById.values(), ...wayById.values()].flatMap(element => element.timestamp ? [element.timestamp] : []).sort();
  return {
    osm: {
      osm3s: { timestamp_osm_base: timestamps.at(-1) ?? new Date().toISOString() },
      timestampSource: "latest-returned-element",
      elements: [
        ...[...nodeById.values()].sort((a, b) => a.id - b.id),
        ...[...wayById.values()].sort((a, b) => a.id - b.id),
      ],
    } satisfies OSMExtract,
    tiles,
  };
}

export async function extract(configPath: string, output: string, endpoint = "https://overpass-api.de/api/interpreter") {
  if (new URL(endpoint).protocol !== "https:") throw new Error("La extracción OSM requiere HTTPS");
  const config = parseConfig(await readJson(configPath));
  const { bbox } = config;
  const osmMapApi = new URL(endpoint).pathname.endsWith("/api/0.6/map");
  const query = osmMapApi ? "OSM API 0.6 map, tiled by bbox; filtered to routable highway ways" : buildQuery(bbox);
  const mapExtract = osmMapApi ? await fetchOsmMap(endpoint, bbox) : undefined;
  const osm: OSMExtract = mapExtract?.osm ?? await (async (): Promise<OSMExtract> => {
    const response = await fetch(endpoint, {
      method: "POST", body: new URLSearchParams({ data: query }),
      signal: AbortSignal.timeout(120_000), headers: { "User-Agent": "Spookytoon-Manta-Graph/1.0" },
    });
    if (!response.ok) throw new Error(`Overpass HTTP ${response.status}`);
    return await response.json() as OSMExtract;
  })();
  if (osm.remark || !Array.isArray(osm.elements) || !osm.elements.length || !osm.osm3s?.timestamp_osm_base) {
    throw new Error(`Extracción incompleta: ${osm.remark ?? "sin elementos/fecha OSM"}`);
  }
  const shelterSnaps = (config.refugios ?? []).length ? (() => {
    validateReview(config);
    return resolveShelterLinks(osm as { elements?: import("./graph-config.ts").OSMElement[] }, config);
  })() : [];
  const selection = config.targetGraphNodes !== undefined
    ? selectConnectedRoadNodes(osm, config, shelterSnaps)
    : config.selectedNodeIds ? { selectedNodeIds: config.selectedNodeIds, summary: undefined } : undefined;
  if (selection) {
    osm.selectedNodeIds = selection.selectedNodeIds;
    if (selection.summary) osm.selection = selection.summary;
  }
  const bytes = JSON.stringify(osm, null, 2) + "\n";
  await writeJson(output, osm);
  await writeJson(`${output}.source.json`, {
    endpoint, query, bbox, directionMode: config.directionMode ?? "vehicle",
    extractedAt: new Date().toISOString(), osmBaseTimestamp: osm.osm3s.timestamp_osm_base,
    osmTimestampSource: osm.timestampSource ?? "overpass-base",
    extractionMode: osmMapApi ? "OSM map API tiled" : "Overpass API",
    ...(mapExtract ? { tiles: mapExtract.tiles.map(([south, west, north, east]) => ({ south, west, north, east })) } : {}),
    ...(osm.selection ? { selection: osm.selection } : {}),
    source: "OpenStreetMap", license: "ODbL-1.0", attribution: "© OpenStreetMap contributors — https://www.openstreetmap.org/copyright",
    sha256: createHash("sha256").update(bytes).digest("hex"), shelterSnaps,
  });
  console.log(`OSM guardado: ${output} (${osm.elements.length} elementos)`);
  if (osm.selection) console.log(`Selección conectada: ${osm.selection.targetNodes} nodos OSM (${osm.selection.selectedIntersections} intersecciones; ${osm.selection.coreNodes} en rutas entre refugios)`);
  for (const shelter of shelterSnaps) {
    console.log(`${shelter.id}: ${shelter.nodoId} (${shelter.snapDistanceM} m; ${shelter.snapped?.lat}, ${shelter.snapped?.lng})`);
  }
}
if (isMain(import.meta.url)) {
  const [, , config, output, endpoint] = process.argv;
  if (!config || !output) fail(new Error("Uso: npm run graph:extract -- config.json scripts/data/manta.osm.json [endpoint HTTPS]"));
  else extract(config, output, endpoint).catch(fail);
}
