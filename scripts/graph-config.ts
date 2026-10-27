import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Zone } from "../backend/src/contracts/types.ts";

export const ZONES: readonly Zone[] = ["Tarqui", "Los Esteros", "Barbasquillo", "Jocay"];
export const HIGHWAYS = ["motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link", "tertiary", "tertiary_link", "residential", "unclassified", "living_street", "service"] as const;
const HIGHWAY_SET = new Set<string>(HIGHWAYS);
export function isSupportedHighway(highway: string | undefined) { return HIGHWAY_SET.has(highway ?? ""); }
export type WayDirection = "both" | "forward" | "reverse";
export type DirectionMode = "vehicle" | "pedestrian";
export function directionForWay(tags: Record<string, string>, wayId: number, mode: DirectionMode = "vehicle"): WayDirection {
  if (mode === "pedestrian") return "both";
  if (["no", "false", "0"].includes(tags.oneway)) return "both";
  if (["yes", "true", "1"].includes(tags.oneway)) return "forward";
  if (tags.oneway === "-1") return "reverse";
  if (tags.oneway !== undefined) throw new Error(`oneway requiere revisión: way ${wayId} (${tags.oneway})`);
  return tags.junction === "roundabout" || tags.highway === "motorway" ? "forward" : "both";
}

export interface ShelterConfig {
  id: string;
  capacidad: number;
  nodoId?: string;
  zona?: Zone;
  acceso?: { lat: number; lng: number; descripcion?: string };
}

export interface GraphConfig {
  bbox: [number, number, number, number]; // south, west, north, east
  directionMode?: DirectionMode;
  zones: { name: Zone; polygon: [number, number][] }[]; // [lng, lat], anillo cerrado
  refugios: ShelterConfig[];
  shelterSnapLimitM?: number;
  targetGraphNodes?: number;
  compactIntersections?: boolean;
  selectedNodeIds?: string[];
}

export interface ResolvedShelter {
  id: string;
  nodoId: string;
  capacidad: number;
  zona: Zone | null;
  access: { lat: number; lng: number; descripcion?: string } | null;
  snapped: { lat: number; lng: number } | null;
  snapDistanceM: number | null;
}

export interface OSMElement {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  tags?: Record<string, string>;
}

export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = Math.PI / 180;
  const h = Math.sin((b.lat - a.lat) * rad / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lng - a.lng) * rad / 2) ** 2;
  return 6_371_000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}

export function pointInPolygon(lng: number, lat: number, polygon: [number, number][]) {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [x, y] = polygon[i]; const [a, b] = polygon[j];
    if (Math.abs((lat - y) * (a - x) - (lng - x) * (b - y)) < 1e-12 &&
      lng >= Math.min(x, a) && lng <= Math.max(x, a) && lat >= Math.min(y, b) && lat <= Math.max(y, b)) return true;
    if ((y > lat) !== (b > lat) && lng < (a - x) * (lat - y) / (b - y) + x) hit = !hit;
  }
  return hit;
}

export function parseConfig(value: unknown): GraphConfig {
  if (!value || typeof value !== "object") throw new Error("Configuración del grafo ausente");
  const config = value as GraphConfig;
  const bbox = config.bbox;
  if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every(Number.isFinite) ||
    bbox[0] >= bbox[2] || bbox[1] >= bbox[3] || bbox[0] < -90 || bbox[2] > 90 || bbox[1] < -180 || bbox[3] > 180) {
    throw new Error("Configurar bbox revisado [sur, oeste, norte, este]");
  }
  return config;
}
export function validateReview(config: GraphConfig) {
  if (!Array.isArray(config.zones) || config.zones.length !== 4 ||
      new Set(config.zones.map(z => z.name)).size !== 4) throw new Error("Configurar polígonos de las cuatro zonas");
  if (config.directionMode !== undefined && !["vehicle", "pedestrian"].includes(config.directionMode)) {
    throw new Error("directionMode debe ser vehicle o pedestrian");
  }
  for (const zone of config.zones) {
    const p = zone.polygon;
    if (!ZONES.includes(zone.name) || !Array.isArray(p) || p.length < 4 ||
      !p.every(c => Array.isArray(c) && c.length === 2 && c.every(Number.isFinite) && Math.abs(c[0]) <= 180 && Math.abs(c[1]) <= 90) ||
      p[0][0] !== p.at(-1)![0] || p[0][1] !== p.at(-1)![1]) throw new Error(`Polígono inválido: ${zone.name}`);
  }
  if (!Array.isArray(config.refugios) || config.refugios.length !== 4) throw new Error("Configurar exactamente cuatro refugios");
  const ids = new Set<string>();
  const zones = new Set<Zone>();
  for (const shelter of config.refugios) {
    if (!shelter || typeof shelter.id !== "string" || !shelter.id || !Number.isSafeInteger(shelter.capacidad) || shelter.capacidad <= 0) {
      throw new Error("Cada refugio requiere id y capacidad positiva");
    }
    if (ids.has(shelter.id)) throw new Error(`ID de refugio duplicado: ${shelter.id}`);
    ids.add(shelter.id);
    if (shelter.nodoId !== undefined && (typeof shelter.nodoId !== "string" || !/^osm-node-\d+$/.test(shelter.nodoId))) {
      throw new Error(`nodoId inválido para refugio ${shelter.id}`);
    }
    if (shelter.zona !== undefined) {
      if (!ZONES.includes(shelter.zona) || zones.has(shelter.zona)) throw new Error(`Zona inválida o duplicada para refugio ${shelter.id}`);
      zones.add(shelter.zona);
    }
    if (shelter.acceso !== undefined) {
      const { lat, lng } = shelter.acceso;
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 ||
        lat < config.bbox[0] || lat > config.bbox[2] || lng < config.bbox[1] || lng > config.bbox[3]) {
        throw new Error(`Coordenadas de acceso fuera del bbox para refugio ${shelter.id}`);
      }
      if (shelter.zona === undefined || !config.zones.some(z => z.name === shelter.zona && pointInPolygon(lng, lat, z.polygon))) {
        throw new Error(`El acceso de ${shelter.id} debe quedar dentro del polígono de su zona`);
      }
    } else if (shelter.nodoId === undefined) {
      throw new Error(`Refugio ${shelter.id}: indicar acceso con coordenadas o nodoId OSM`);
    }
  }
  if (zones.size > 0 && (zones.size !== 4 || ZONES.some(zone => !zones.has(zone)))) {
    throw new Error("Los cuatro refugios deben cubrir una zona distinta cada uno");
  }
  if (config.shelterSnapLimitM !== undefined && (!Number.isFinite(config.shelterSnapLimitM) || config.shelterSnapLimitM <= 0)) {
    throw new Error("shelterSnapLimitM debe ser positivo");
  }
  if (config.targetGraphNodes !== undefined && (!Number.isSafeInteger(config.targetGraphNodes) || config.targetGraphNodes < 250 || config.targetGraphNodes > 350)) {
    throw new Error("targetGraphNodes debe estar entre 250 y 350");
  }
  if (config.compactIntersections !== undefined && typeof config.compactIntersections !== "boolean") {
    throw new Error("compactIntersections debe ser booleano");
  }
  if (config.selectedNodeIds !== undefined && (!Array.isArray(config.selectedNodeIds) ||
    !config.selectedNodeIds.every(id => typeof id === "string" && /^osm-node-\d+$/.test(id)) ||
    new Set(config.selectedNodeIds).size !== config.selectedNodeIds.length)) throw new Error("selectedNodeIds inválidos o duplicados");
}

export function resolveShelterLinks(osm: { elements?: OSMElement[] }, config: GraphConfig): ResolvedShelter[] {
  if (!Array.isArray(osm.elements)) throw new Error("Respuesta OSM sin elements para resolver refugios");
  const nodeById = new Map<number, OSMElement>();
  for (const element of osm.elements) if (element.type === "node" && Number.isSafeInteger(element.id) &&
    Number.isFinite(element.lat) && Number.isFinite(element.lon)) nodeById.set(element.id!, element);
  const streetNodeIds = new Set<number>();
  for (const element of osm.elements) {
    if (element.type !== "way" || !Array.isArray(element.nodes)) continue;
    const tags = element.tags ?? {};
    if (!HIGHWAY_SET.has(tags.highway ?? "") || tags.area === "yes" || ["no", "private"].includes(tags.access ?? "")) continue;
    for (const nodeId of element.nodes) streetNodeIds.add(nodeId);
  }
  const limit = config.shelterSnapLimitM ?? 750;
  return config.refugios.map(shelter => {
    if (shelter.nodoId) {
      const nodeId = Number(shelter.nodoId.slice("osm-node-".length));
      const node = nodeById.get(nodeId);
      if (!node || !streetNodeIds.has(nodeId)) throw new Error(`nodoId de ${shelter.id} no corresponde a un nodo vial OSM`);
      const access = shelter.acceso ? { ...shelter.acceso } : null;
      return {
        id: shelter.id, nodoId: shelter.nodoId, capacidad: shelter.capacidad, zona: shelter.zona ?? null, access,
        snapped: { lat: node.lat!, lng: node.lon! },
        snapDistanceM: access ? Math.round(distanceMeters(access, { lat: node.lat!, lng: node.lon! }) * 10) / 10 : null,
      };
    }
    if (!shelter.acceso || !shelter.zona) throw new Error(`Refugio ${shelter.id}: falta acceso o zona para resolver el nodo vial`);
    const zone = config.zones.find(item => item.name === shelter.zona);
    if (!zone) throw new Error(`No existe polígono para ${shelter.zona}`);
    const candidates = [...streetNodeIds].map(id => nodeById.get(id)).filter((node): node is OSMElement => !!node &&
      node.lat! >= config.bbox[0] && node.lat! <= config.bbox[2] && node.lon! >= config.bbox[1] && node.lon! <= config.bbox[3] &&
      pointInPolygon(node.lon!, node.lat!, zone.polygon));
    candidates.sort((a, b) => distanceMeters(shelter.acceso!, { lat: a.lat!, lng: a.lon! }) -
      distanceMeters(shelter.acceso!, { lat: b.lat!, lng: b.lon! }) || a.id! - b.id!);
    const nearest = candidates[0];
    if (!nearest) throw new Error(`No hay nodos viales OSM dentro de ${shelter.zona} para ${shelter.id}`);
    const snapDistanceM = Math.round(distanceMeters(shelter.acceso, { lat: nearest.lat!, lng: nearest.lon! }) * 10) / 10;
    if (snapDistanceM > limit) throw new Error(`El nodo vial más cercano a ${shelter.id} está a ${snapDistanceM} m (límite ${limit} m)`);
    return {
      id: shelter.id, nodoId: `osm-node-${nearest.id}`, capacidad: shelter.capacidad, zona: shelter.zona,
      access: { ...shelter.acceso }, snapped: { lat: nearest.lat!, lng: nearest.lon! }, snapDistanceM,
    };
  });
}
export async function readJson(path: string) { return JSON.parse(await readFile(path, "utf8")) as unknown; }
export async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + "\n");
}
export function isMain(url: string) { return !!process.argv[1] && url === pathToFileURL(resolve(process.argv[1])).href; }
export function fail(error: unknown) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
