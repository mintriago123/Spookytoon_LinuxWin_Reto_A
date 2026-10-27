import { createHash } from "node:crypto";
import { isMain, fail, readJson, writeJson, parseConfig } from "./graph-config.ts";

export const HIGHWAYS = ["motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link", "tertiary", "tertiary_link", "residential", "unclassified", "living_street", "service"];
export function buildQuery(bbox: [number, number, number, number]) {
  return `[out:json][timeout:90];way["highway"~"^(${HIGHWAYS.join("|")})$"]["area"!="yes"]["access"!~"^(no|private)$"](${bbox.join(",")});out body;>;out skel qt;`;
}
export async function extract(configPath: string, output: string, endpoint = "https://overpass-api.de/api/interpreter") {
  if (new URL(endpoint).protocol !== "https:") throw new Error("Overpass requiere HTTPS");
  const { bbox } = parseConfig(await readJson(configPath));
  const query = buildQuery(bbox);
  const response = await fetch(endpoint, {
    method: "POST", body: new URLSearchParams({ data: query }),
    signal: AbortSignal.timeout(120_000), headers: { "User-Agent": "Spookytoon-Manta-Graph/1.0" },
  });
  if (!response.ok) throw new Error(`Overpass HTTP ${response.status}`);
  const osm = await response.json() as { elements?: unknown[]; remark?: string; osm3s?: { timestamp_osm_base?: string } };
  if (osm.remark || !Array.isArray(osm.elements) || !osm.elements.length || !osm.osm3s?.timestamp_osm_base) {
    throw new Error(`Extracción incompleta: ${osm.remark ?? "sin elementos/fecha OSM"}`);
  }
  const bytes = JSON.stringify(osm, null, 2) + "\n";
  await writeJson(output, osm);
  await writeJson(`${output}.source.json`, {
    endpoint, query, bbox, extractedAt: new Date().toISOString(), osmBaseTimestamp: osm.osm3s.timestamp_osm_base,
    source: "OpenStreetMap", license: "ODbL-1.0", attribution: "© OpenStreetMap contributors — https://www.openstreetmap.org/copyright",
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
  console.log(`OSM guardado: ${output} (${osm.elements.length} elementos)`);
}
if (isMain(import.meta.url)) {
  const [, , config, output, endpoint] = process.argv;
  if (!config || !output) fail(new Error("Uso: npm run graph:extract -- config.json scripts/data/manta.osm.json [endpoint HTTPS]"));
  else extract(config, output, endpoint).catch(fail);
}
