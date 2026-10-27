import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { GraphShelter, Zone } from "../backend/src/contracts/types.ts";

export const ZONES: readonly Zone[] = ["Tarqui", "Los Esteros", "Barbasquillo", "Jocay"];
export interface GraphConfig {
  bbox: [number, number, number, number]; // south, west, north, east
  zones: { name: Zone; polygon: [number, number][] }[]; // [lng, lat], anillo cerrado
  refugios: GraphShelter[];
  selectedNodeIds?: string[];
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
  for (const zone of config.zones) {
    const p = zone.polygon;
    if (!ZONES.includes(zone.name) || !Array.isArray(p) || p.length < 4 ||
      !p.every(c => Array.isArray(c) && c.length === 2 && c.every(Number.isFinite) && Math.abs(c[0]) <= 180 && Math.abs(c[1]) <= 90) ||
      p[0][0] !== p.at(-1)![0] || p[0][1] !== p.at(-1)![1]) throw new Error(`Polígono inválido: ${zone.name}`);
  }
  if (!Array.isArray(config.refugios) || config.refugios.length !== 4 || config.refugios.some(s =>
    !s || typeof s.id !== "string" || !s.id || typeof s.nodoId !== "string" || !/^osm-node-\d+$/.test(s.nodoId) || !Number.isSafeInteger(s.capacidad) || s.capacidad <= 0)) {
    throw new Error("Configurar cuatro refugios con nodo OSM revisado y capacidad positiva");
  }
  if (config.selectedNodeIds !== undefined && (!Array.isArray(config.selectedNodeIds) ||
    !config.selectedNodeIds.every(id => typeof id === "string" && /^osm-node-\d+$/.test(id)) ||
    new Set(config.selectedNodeIds).size !== config.selectedNodeIds.length)) throw new Error("selectedNodeIds inválidos o duplicados");
}
export async function readJson(path: string) { return JSON.parse(await readFile(path, "utf8")) as unknown; }
export async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + "\n");
}
export function isMain(url: string) { return !!process.argv[1] && url === pathToFileURL(resolve(process.argv[1])).href; }
export function fail(error: unknown) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
